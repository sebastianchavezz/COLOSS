/**
 * mollie-webhook Edge Function
 *
 * Processes Mollie payment AND refund webhook notifications.
 * Called by Mollie when a payment or refund status changes.
 *
 * MOLLIE BEST PRACTICES IMPLEMENTED:
 * 1. Webhook verified by re-fetching from Mollie API (not trusting payload)
 * 2. Idempotency via payment_events table (unique constraint on provider_event_id)
 * 3. Returns 200 for unknown IDs (security: no information leakage)
 * 4. Returns 200 for duplicates (stops Mollie retries)
 * 5. Returns 500 for transient errors (Mollie will retry up to 10x over 26h)
 * 6. Timeout handling (Mollie times out after 15s)
 *
 * Flow:
 * 1. Parse webhook (form data with payment/refund ID)
 * 2. Detect type: payment (tr_xxx) or refund (re_xxx)
 * 3. Re-fetch from Mollie API with timeout (verification + authoritative status)
 * 4. Idempotency check via payment_events
 * 5. Call appropriate RPC
 * 6. Mark event as processed
 * 7. Return 200 OK
 *
 * @see https://docs.mollie.com/reference/webhooks
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

const MOLLIE_API_URL = "https://api.mollie.com/v2"
const MOLLIE_FETCH_TIMEOUT_MS = 10000  // 10 seconds (Mollie times out at 15s)

/**
 * Fetch with timeout using AbortController
 */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        })
        clearTimeout(timeoutId)
        return response
    } catch (error) {
        clearTimeout(timeoutId)
        throw error
    }
}

serve(async (req: Request) => {
    const startTime = Date.now()
    const logger = createLogger('mollie-webhook')
    logger.info('Webhook invoked', { method: req.method })

    try {
        // 1. PARSE WEBHOOK
        // Mollie sends form-encoded data with 'id' field
        let molliePaymentId: FormDataEntryValue | null

        try {
            const formData = await req.formData()
            molliePaymentId = formData.get('id')
        } catch (parseError) {
            logger.warn('Failed to parse form data', parseError)
            // Return 200 per Mollie best practice (no info leakage)
            return new Response('OK', { status: 200 })
        }

        if (!molliePaymentId) {
            logger.warn('Missing payment id in webhook payload')
            // Return 200 per Mollie best practice (no info leakage)
            return new Response('OK', { status: 200 })
        }

        const idStr = String(molliePaymentId)
        logger.info('Processing webhook', { id: idStr })

        // 2. SETUP
        const supabaseAdmin = getServiceClient()

        const mollieApiKey = Deno.env.get('MOLLIE_API_KEY')
        if (!mollieApiKey) {
            logger.error('Missing MOLLIE_API_KEY environment variable')
            // Return 500 so Mollie retries when we fix config
            return new Response('Server Configuration Error', { status: 500 })
        }

        // Log if we're in test mode
        const isTestMode = mollieApiKey.startsWith('test_')
        if (isTestMode) {
            logger.info('🧪 MOLLIE TEST MODE')
        }

        // 2.5 DETECT TYPE: Payment (tr_xxx) or Refund (re_xxx)
        const isRefund = idStr.startsWith('re_')

        if (isRefund) {
            // ========== REFUND WEBHOOK ==========
            return await handleRefundWebhook(idStr, mollieApiKey, supabaseAdmin, logger, startTime)
        }

        // ========== PAYMENT WEBHOOK ==========
        // 3. FETCH FROM MOLLIE (Webhook verification with timeout)
        // We never trust the webhook payload — always re-fetch from Mollie API.
        // This prevents spoofed webhooks and ensures we have the authoritative status.
        let molliePayment: any
        try {
            const mollieResponse = await fetchWithTimeout(
                `${MOLLIE_API_URL}/payments/${idStr}`,
                { headers: { 'Authorization': `Bearer ${mollieApiKey}` } },
                MOLLIE_FETCH_TIMEOUT_MS
            )

            // BEST PRACTICE: Return 200 for unknown IDs (security: no info leakage)
            if (mollieResponse.status === 404) {
                logger.warn('Payment not found at Mollie (returning 200)', { paymentId: idStr })
                return new Response('OK', { status: 200 })
            }

            if (!mollieResponse.ok) {
                logger.error('Mollie API error', {
                    status: mollieResponse.status,
                    paymentId: idStr
                })
                // Return 502 so Mollie retries
                return new Response('Mollie API Error', { status: 502 })
            }

            molliePayment = await mollieResponse.json()
        } catch (fetchErr) {
            if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
                logger.error('Mollie API timeout', { paymentId: idStr })
            } else {
                logger.error('Mollie API fetch exception', fetchErr)
            }
            // Return 502 so Mollie retries
            return new Response('Mollie API Unreachable', { status: 502 })
        }

        const { status, metadata } = molliePayment
        const orderId = metadata?.order_id

        if (!orderId) {
            logger.warn('No order_id in payment metadata', { paymentId: idStr, status })
            // Return 200 to stop retries (this payment has no order association in our system)
            return new Response('OK', { status: 200 })
        }

        logger.info('Payment status from Mollie', {
            paymentId: idStr,
            status,
            orderId,
            amount: molliePayment.amount?.value
        })

        // 4. IDEMPOTENCY CHECK (payment_events table)
        // Each unique (provider, provider_event_id) can only be processed once.
        // provider_event_id = "paymentId:status" ensures status changes are tracked separately.
        const eventKey = `${idStr}:${status}`

        const { error: eventError } = await supabaseAdmin
            .from('payment_events')
            .insert({
                provider: 'mollie',
                provider_event_id: eventKey,
                provider_payment_id: idStr,
                event_type: `payment.${status}`,
                payload: molliePayment,
                processed_at: null
            })

        if (eventError) {
            // Unique constraint violation (23505) = already processed
            if (eventError.code === '23505') {
                logger.info('Event already processed (idempotent)', { eventKey })
                return new Response('OK', { status: 200 })
            }
            // Other DB error → return 500 so Mollie retries
            logger.error('DB Error inserting payment_event', {
                error: eventError.message,
                code: eventError.code,
                eventKey
            })
            return new Response('Database Error', { status: 500 })
        }

        logger.info('Payment event recorded', { eventKey })

        // 5. CALL RPC: handle_payment_webhook
        const { data: webhookResult, error: rpcError } = await supabaseAdmin.rpc('handle_payment_webhook', {
            _order_id: orderId,
            _payment_id: idStr,
            _status: status,
            _amount: parseFloat(molliePayment.amount?.value || '0'),
            _currency: molliePayment.amount?.currency || 'EUR'
        })

        if (rpcError) {
            logger.error('RPC handle_payment_webhook failed', {
                error: rpcError.message,
                code: rpcError.code,
                orderId,
                status
            })
            // Return 500 so Mollie retries — idempotency check will catch duplicates
            return new Response('Transaction Failed', { status: 500 })
        }

        // Log result
        if (webhookResult?.overbooked) {
            logger.warn('⚠️ OVERBOOKED — order cancelled, refund required', {
                orderId,
                available: webhookResult.available,
                requested: webhookResult.requested,
                ticketType: webhookResult.ticket_type
            })
        } else if (webhookResult?.paid) {
            logger.info('✅ Order PAID', {
                orderId,
                ticketsIssued: webhookResult.tickets_issued,
                emailQueued: webhookResult.email_queued
            })
        } else if (webhookResult?.cancelled) {
            logger.info('❌ Order CANCELLED', { orderId, reason: webhookResult.reason })
        } else {
            logger.info('ℹ️ Webhook processed', { orderId, status, result: webhookResult })
        }

        // 6. MARK EVENT AS PROCESSED
        await supabaseAdmin
            .from('payment_events')
            .update({ processed_at: new Date().toISOString() })
            .eq('provider', 'mollie')
            .eq('provider_event_id', eventKey)

        const duration = Date.now() - startTime
        logger.info('Webhook completed', { eventKey, status, durationMs: duration })

        return new Response('OK', { status: 200 })

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        const duration = Date.now() - startTime
        logger.error('Unexpected error in webhook', { error: message, durationMs: duration })
        // Return 500 so Mollie retries
        return new Response('Internal Server Error', { status: 500 })
    }
})

/**
 * Handle refund webhook from Mollie
 */
async function handleRefundWebhook(
    mollieRefundId: string,
    mollieApiKey: string,
    supabaseAdmin: any,
    logger: any,
    startTime: number
): Promise<Response> {
    logger.info('Processing REFUND webhook', { refundId: mollieRefundId })

    // Fetch refund from Mollie with timeout
    let mollieRefund: any
    try {
        const refundResponse = await fetchWithTimeout(
            `${MOLLIE_API_URL}/refunds/${mollieRefundId}`,
            { headers: { 'Authorization': `Bearer ${mollieApiKey}` } },
            MOLLIE_FETCH_TIMEOUT_MS
        )

        // Return 200 for unknown IDs (security best practice)
        if (refundResponse.status === 404) {
            logger.warn('Refund not found at Mollie (returning 200)', { refundId: mollieRefundId })
            return new Response('OK', { status: 200 })
        }

        if (!refundResponse.ok) {
            logger.error('Mollie refund fetch failed', {
                status: refundResponse.status,
                refundId: mollieRefundId
            })
            return new Response('Mollie API Error', { status: 502 })
        }

        mollieRefund = await refundResponse.json()
    } catch (fetchErr) {
        if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
            logger.error('Mollie API timeout for refund', { refundId: mollieRefundId })
        } else {
            logger.error('Mollie refund fetch exception', fetchErr)
        }
        return new Response('Mollie API Unreachable', { status: 502 })
    }

    const { status } = mollieRefund
    logger.info('Refund status from Mollie', {
        refundId: mollieRefundId,
        status,
        amount: mollieRefund.amount?.value
    })

    // Idempotency check
    const eventKey = `refund:${mollieRefundId}:${status}`
    const { error: eventError } = await supabaseAdmin
        .from('payment_events')
        .insert({
            provider: 'mollie',
            provider_event_id: eventKey,
            provider_payment_id: mollieRefundId,
            event_type: `refund.${status}`,
            payload: mollieRefund,
            processed_at: null
        })

    if (eventError) {
        if (eventError.code === '23505') {
            logger.info('Refund event already processed (idempotent)', { eventKey })
            return new Response('OK', { status: 200 })
        }
        logger.error('DB Error inserting refund event', {
            error: eventError.message,
            code: eventError.code,
            eventKey
        })
        return new Response('Database Error', { status: 500 })
    }

    // Call RPC to handle refund status update
    const { data: result, error: rpcError } = await supabaseAdmin.rpc('handle_refund_webhook', {
        _mollie_refund_id: mollieRefundId,
        _status: status,
        _refunded_at: status === 'refunded' ? new Date().toISOString() : null
    })

    if (rpcError) {
        logger.error('RPC handle_refund_webhook failed', {
            error: rpcError.message,
            code: rpcError.code,
            refundId: mollieRefundId
        })
        return new Response('Transaction Failed', { status: 500 })
    }

    // Log result
    if (result?.success && status === 'refunded') {
        logger.info('✅ Refund COMPLETED', {
            refundId: mollieRefundId,
            ticketsVoided: result.tickets_voided
        })
    } else {
        logger.info('ℹ️ Refund webhook processed', { refundId: mollieRefundId, status, result })
    }

    // Mark event as processed
    await supabaseAdmin
        .from('payment_events')
        .update({ processed_at: new Date().toISOString() })
        .eq('provider', 'mollie')
        .eq('provider_event_id', eventKey)

    const duration = Date.now() - startTime
    logger.info('Refund webhook completed', {
        refundId: mollieRefundId,
        status,
        durationMs: duration
    })

    return new Response('OK', { status: 200 })
}
