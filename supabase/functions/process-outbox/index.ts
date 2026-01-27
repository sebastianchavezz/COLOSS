/**
 * process-outbox Edge Function
 *
 * Cron job that processes the email outbox queue.
 * Runs every minute, picks up queued/soft_bounced emails and sends them via Resend.
 *
 * Features:
 * - Batch processing (100 emails per run)
 * - Exponential backoff for retries
 * - Status tracking via email_outbox_events
 * - Exactly-once delivery via status locking
 *
 * Security: System-only (cron), no external input
 * Environment: RESEND_API_KEY required
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

const RESEND_API_URL = "https://api.resend.com/emails"
const BATCH_SIZE = 100

// Retry configuration
const INITIAL_DELAY_MS = 60000      // 1 minute
const BACKOFF_MULTIPLIER = 2        // Exponential backoff
const MAX_ATTEMPTS = 3

interface ProcessOutboxResult {
    processed_count: number
    sent_count: number
    failed_count: number
    skipped_count: number
}

interface EmailRecord {
    id: string
    org_id: string
    from_name: string
    from_email: string
    reply_to: string | null
    to_email: string
    subject: string
    html_body: string
    text_body: string | null
    attempt_count: number
    max_attempts: number
}

serve(async (_req: Request) => {
    const logger = createLogger('process-outbox')
    logger.info('Cron job started')

    const result: ProcessOutboxResult = {
        processed_count: 0,
        sent_count: 0,
        failed_count: 0,
        skipped_count: 0
    }

    try {
        // 1. SETUP
        const supabaseAdmin = getServiceClient()
        const resendApiKey = Deno.env.get('RESEND_API_KEY')

        if (!resendApiKey) {
            logger.error('Missing RESEND_API_KEY')
            return new Response(JSON.stringify({ error: 'Missing RESEND_API_KEY' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            })
        }

        // 2. FETCH PENDING EMAILS
        // SELECT emails WHERE status IN ('queued', 'soft_bounced') AND next_attempt_at <= now()
        const { data: emails, error: fetchError } = await supabaseAdmin
            .from('email_outbox')
            .select('id, org_id, from_name, from_email, reply_to, to_email, subject, html_body, text_body, attempt_count, max_attempts')
            .in('status', ['queued', 'soft_bounced'])
            .or('next_attempt_at.is.null,next_attempt_at.lte.now()')
            .order('created_at', { ascending: true })
            .limit(BATCH_SIZE)

        if (fetchError) {
            logger.error('Failed to fetch emails', fetchError)
            return new Response(JSON.stringify({ error: 'Database error' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            })
        }

        if (!emails || emails.length === 0) {
            logger.info('No emails to process')
            return new Response(JSON.stringify(result), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            })
        }

        logger.info(`Found ${emails.length} emails to process`)

        // 3. PROCESS EACH EMAIL
        for (const email of emails as EmailRecord[]) {
            result.processed_count++

            try {
                // 3a. Lock the email by setting status to 'processing'
                const { error: lockError } = await supabaseAdmin
                    .from('email_outbox')
                    .update({
                        status: 'processing',
                        last_attempt_at: new Date().toISOString()
                    })
                    .eq('id', email.id)
                    .in('status', ['queued', 'soft_bounced']) // Ensure we only lock if still pending

                if (lockError) {
                    logger.warn(`Failed to lock email ${email.id}`, lockError)
                    result.skipped_count++
                    continue
                }

                // 3b. Send via Resend API
                const resendPayload: Record<string, unknown> = {
                    from: `${email.from_name} <${email.from_email}>`,
                    to: [email.to_email],
                    subject: email.subject,
                    html: email.html_body
                }

                if (email.text_body) {
                    resendPayload.text = email.text_body
                }

                if (email.reply_to) {
                    resendPayload.reply_to = email.reply_to
                }

                const resendResponse = await fetch(RESEND_API_URL, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${resendApiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(resendPayload)
                })

                const resendData = await resendResponse.json()

                if (resendResponse.ok && resendData.id) {
                    // 3c. SUCCESS: Update status to 'sent'
                    await supabaseAdmin
                        .from('email_outbox')
                        .update({
                            status: 'sent',
                            provider_message_id: resendData.id,
                            sent_at: new Date().toISOString(),
                            attempt_count: email.attempt_count + 1
                        })
                        .eq('id', email.id)

                    // Log event
                    await supabaseAdmin
                        .from('email_outbox_events')
                        .insert({
                            email_id: email.id,
                            event_type: 'sent',
                            previous_status: 'processing',
                            new_status: 'sent',
                            metadata: { provider_response: resendData }
                        })

                    logger.info(`Email sent successfully`, { emailId: email.id, providerMessageId: resendData.id })
                    result.sent_count++

                } else {
                    // 3d. FAILURE: Handle error with retry logic
                    const newAttemptCount = email.attempt_count + 1
                    const errorMessage = resendData.message || resendData.error || 'Unknown error'
                    const errorCode = String(resendResponse.status)

                    // Determine if this is a retryable error
                    const isRetryable = resendResponse.status >= 500 || resendResponse.status === 429
                    const hasMoreAttempts = newAttemptCount < email.max_attempts

                    let newStatus: string
                    let nextAttemptAt: string | null = null

                    if (isRetryable && hasMoreAttempts) {
                        // Soft bounce - schedule retry with exponential backoff
                        newStatus = 'soft_bounced'
                        const delayMs = INITIAL_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, newAttemptCount - 1)
                        nextAttemptAt = new Date(Date.now() + delayMs).toISOString()
                        logger.warn(`Email soft bounced, will retry`, { emailId: email.id, attempt: newAttemptCount, nextAttempt: nextAttemptAt })
                    } else {
                        // Permanent failure
                        newStatus = 'failed'
                        logger.error(`Email permanently failed`, { emailId: email.id, error: errorMessage })
                    }

                    await supabaseAdmin
                        .from('email_outbox')
                        .update({
                            status: newStatus,
                            attempt_count: newAttemptCount,
                            next_attempt_at: nextAttemptAt,
                            error_message: errorMessage,
                            error_code: errorCode
                        })
                        .eq('id', email.id)

                    // Log event
                    await supabaseAdmin
                        .from('email_outbox_events')
                        .insert({
                            email_id: email.id,
                            event_type: newStatus === 'soft_bounced' ? 'retry_scheduled' : 'failed',
                            previous_status: 'processing',
                            new_status: newStatus,
                            error_message: errorMessage,
                            error_code: errorCode,
                            metadata: { provider_response: resendData }
                        })

                    result.failed_count++
                }

            } catch (emailError: unknown) {
                // Unexpected error processing this email
                const message = emailError instanceof Error ? emailError.message : String(emailError)
                logger.error(`Unexpected error processing email ${email.id}`, message)

                // Revert to queued so it can be retried
                await supabaseAdmin
                    .from('email_outbox')
                    .update({
                        status: 'queued',
                        error_message: message
                    })
                    .eq('id', email.id)

                result.failed_count++
            }
        }

        logger.info('Cron job completed', result)
        return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        })

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Cron job failed', message)
        return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        })
    }
})
