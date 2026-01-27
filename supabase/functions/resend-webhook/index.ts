/**
 * resend-webhook Edge Function
 *
 * Webhook handler for Resend email delivery events.
 * Updates email status based on delivery notifications (sent, delivered, bounced, complained).
 *
 * Features:
 * - Svix signature verification for security
 * - Idempotency via provider_event_id in email_outbox_events
 * - Bounce tracking in email_bounces table
 * - Auto-unsubscribe on complaints
 *
 * Security: Webhook signature verification via RESEND_WEBHOOK_SECRET
 * Expected events: email.sent, email.delivered, email.bounced, email.complained
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

// Resend webhook event types
type ResendEventType = 'email.sent' | 'email.delivered' | 'email.bounced' | 'email.complained'

interface ResendWebhookPayload {
    type: ResendEventType
    created_at: string
    data: {
        email_id: string       // Resend's message ID
        from: string
        to: string[]
        subject: string
        bounce?: {
            type: 'hard' | 'soft'
            message?: string
        }
    }
}

// Map Resend event types to our email_status enum
const EVENT_STATUS_MAP: Record<ResendEventType, string> = {
    'email.sent': 'sent',
    'email.delivered': 'delivered',
    'email.bounced': 'bounced',
    'email.complained': 'complained'
}

/**
 * Verify Svix webhook signature
 * Resend uses Svix for webhook delivery
 */
async function verifyWebhookSignature(
    payload: string,
    headers: Headers,
    secret: string
): Promise<boolean> {
    const svixId = headers.get('svix-id')
    const svixTimestamp = headers.get('svix-timestamp')
    const svixSignature = headers.get('svix-signature')

    if (!svixId || !svixTimestamp || !svixSignature) {
        return false
    }

    // Check timestamp is within 5 minutes
    const timestamp = parseInt(svixTimestamp, 10)
    const now = Math.floor(Date.now() / 1000)
    if (Math.abs(now - timestamp) > 300) {
        return false
    }

    // Compute expected signature
    // Format: "v1,{timestamp}.{payload}"
    const signedContent = `${svixId}.${svixTimestamp}.${payload}`

    // Extract the secret (remove "whsec_" prefix if present)
    const secretBytes = secret.startsWith('whsec_')
        ? Uint8Array.from(atob(secret.slice(6)), c => c.charCodeAt(0))
        : new TextEncoder().encode(secret)

    // Import key and sign
    const key = await crypto.subtle.importKey(
        'raw',
        secretBytes,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    )

    const signatureBytes = await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(signedContent)
    )

    // Convert to base64
    const expectedSignature = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)))

    // Svix signature header contains multiple signatures: "v1,{sig1} v1,{sig2}"
    // We need to check if any of them match
    const signatures = svixSignature.split(' ')
    for (const sig of signatures) {
        const [version, signature] = sig.split(',')
        if (version === 'v1' && signature === expectedSignature) {
            return true
        }
    }

    return false
}

serve(async (req: Request) => {
    const logger = createLogger('resend-webhook')
    logger.info('Webhook invoked')

    try {
        // 1. GET RAW PAYLOAD FOR SIGNATURE VERIFICATION
        const rawPayload = await req.text()

        // 2. VERIFY SIGNATURE
        const webhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET')
        if (!webhookSecret) {
            logger.error('Missing RESEND_WEBHOOK_SECRET')
            return new Response('Server configuration error', { status: 500 })
        }

        const isValid = await verifyWebhookSignature(rawPayload, req.headers, webhookSecret)
        if (!isValid) {
            logger.warn('Invalid webhook signature')
            return new Response('Invalid signature', { status: 401 })
        }

        // 3. PARSE PAYLOAD
        let payload: ResendWebhookPayload
        try {
            payload = JSON.parse(rawPayload)
        } catch {
            logger.warn('Invalid JSON payload')
            return new Response('Invalid JSON', { status: 400 })
        }

        const { type, created_at, data } = payload
        const providerMessageId = data.email_id
        const providerEventId = `${providerMessageId}:${type}:${created_at}`

        logger.info('Processing webhook', { type, providerMessageId })

        // 4. SETUP ADMIN CLIENT
        const supabaseAdmin = getServiceClient()

        // 5. IDEMPOTENCY CHECK
        // Try to insert the event - will fail if already processed
        const { error: idempotencyError } = await supabaseAdmin
            .from('email_outbox_events')
            .select('id')
            .eq('provider_event_id', providerEventId)
            .single()

        if (!idempotencyError) {
            // Event already exists - idempotent return
            logger.info('Event already processed (idempotent)', providerEventId)
            return new Response('OK', { status: 200 })
        }

        // 6. LOOKUP EMAIL BY PROVIDER MESSAGE ID
        const { data: email, error: lookupError } = await supabaseAdmin
            .from('email_outbox')
            .select('id, org_id, to_email, status')
            .eq('provider_message_id', providerMessageId)
            .single()

        if (lookupError || !email) {
            // Email not found - could be from another system, just acknowledge
            logger.warn('Email not found for provider_message_id', providerMessageId)
            return new Response('OK', { status: 200 })
        }

        // 7. DETERMINE NEW STATUS
        const newStatus = EVENT_STATUS_MAP[type]
        if (!newStatus) {
            logger.warn('Unknown event type', type)
            return new Response('OK', { status: 200 })
        }

        // 8. UPDATE EMAIL STATUS
        const updateData: Record<string, unknown> = {
            status: newStatus,
            updated_at: new Date().toISOString()
        }

        if (type === 'email.delivered') {
            updateData.delivered_at = new Date().toISOString()
        }

        const { error: updateError } = await supabaseAdmin
            .from('email_outbox')
            .update(updateData)
            .eq('id', email.id)

        if (updateError) {
            logger.error('Failed to update email status', updateError)
            return new Response('Database error', { status: 500 })
        }

        // 9. INSERT EVENT LOG
        await supabaseAdmin
            .from('email_outbox_events')
            .insert({
                email_id: email.id,
                event_type: type.replace('email.', ''),
                previous_status: email.status,
                new_status: newStatus,
                provider_event_id: providerEventId,
                provider_timestamp: created_at,
                raw_payload: payload
            })

        // 10. HANDLE BOUNCES
        if (type === 'email.bounced') {
            const bounceType = data.bounce?.type || 'hard'
            const errorMessage = data.bounce?.message || 'Email bounced'

            await supabaseAdmin
                .from('email_bounces')
                .insert({
                    email: email.to_email,
                    bounce_type: bounceType,
                    provider: 'resend',
                    provider_event_id: providerEventId,
                    provider_timestamp: created_at,
                    email_outbox_id: email.id,
                    error_message: errorMessage,
                    raw_payload: payload,
                    org_id: email.org_id
                })

            logger.info('Bounce recorded', { email: email.to_email, type: bounceType })
        }

        // 11. HANDLE COMPLAINTS (SPAM REPORTS)
        if (type === 'email.complained') {
            // Auto-unsubscribe user from all marketing emails
            const { error: unsubError } = await supabaseAdmin
                .from('email_unsubscribes')
                .upsert({
                    email: email.to_email,
                    org_id: email.org_id,
                    email_type: 'all',
                    source: 'user_request',
                    reason: 'Spam complaint received',
                    metadata: { provider_event_id: providerEventId }
                }, {
                    onConflict: 'email,COALESCE(org_id, \'00000000-0000-0000-0000-000000000000\'::uuid),email_type',
                    ignoreDuplicates: true
                })

            if (unsubError) {
                // Log but don't fail - unsubscribe is best effort
                logger.warn('Failed to auto-unsubscribe on complaint', unsubError)
            } else {
                logger.info('Auto-unsubscribed due to complaint', { email: email.to_email })
            }
        }

        logger.info('Webhook processed successfully', { emailId: email.id, newStatus })
        return new Response('OK', { status: 200 })

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Unexpected error', message)
        return new Response('Internal Server Error', { status: 500 })
    }
})
