/**
 * mollie-webhook Edge Function
 *
 * Processes Mollie payment AND refund webhook notifications.
 * Called by Mollie when a payment or refund status changes.
 *
 * Security:
 * - Webhook verified by re-fetching from Mollie API (not trusting payload)
 * - Idempotency via payment_events table (unique constraint on provider_event_id)
 * - Returns 200 for duplicates (stops Mollie retries)
 * - Returns 500 for transient errors (Mollie will retry)
 *
 * Flow:
 * 1. Parse webhook (form data with payment/refund ID)
 * 2. Detect type: payment (tr_xxx) or refund (re_xxx)
 * 3. Re-fetch from Mollie API (verification + authoritative status)
 * 4. Idempotency check via payment_events
 * 5. Call appropriate RPC
 * 6. Mark event as processed
 * 7. Return 200 OK
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

const MOLLIE_API_URL = "https://api.mollie.com/v2"

serve(async (req: Request) => {
    const logger = createLogger('mollie-webhook')
    logger.info('Webhook invoked')

    try {
        // 1. PARSE WEBHOOK
        // Mollie sends form-encoded data with 'id' field
        const formData = await req.formData()
        const molliePaymentId = formData.get('id')

        if (!molliePaymentId) {
            logger.warn('Missing payment id in webhook payload')
            return new Response('Missing id', { status: 400 })
        }

        logger.info('Processing webhook', { id: String(molliePaymentId) })

        // 2. SETUP ADMIN CLIENT
        const supabaseAdmin = getServiceClient()

        const mollieApiKey = Deno.env.get('MOLLIE_API_KEY')
        if (!mollieApiKey) {
            logger.error('Missing MOLLIE_API_KEY environment variable')
            return new Response('Server Error', { status: 500 })
        }

        // 2.5 DETECT TYPE: Payment (tr_xxx) or Refund (re_xxx)
        const idStr = String(molliePaymentId)
        const isRefund = idStr.startsWith('re_')

        if (isRefund) {
            // ========== REFUND WEBHOOK ==========
            return await handleRefundWebhook(idStr, mollieApiKey, supabaseAdmin, logger)
        }

        // ========== PAYMENT WEBHOOK ==========
        // 3. FETCH FROM MOLLIE (Webhook verification)
        // We never trust the webhook payload directly — always re-fetch from Mollie API.
        // This prevents spoofed webhooks and ensures we have the authoritative status.
        let molliePayment: any
        try {
            const mollieResponse = await fetch(`${MOLLIE_API_URL}/payments/${molliePaymentId}`, {
                headers: { 'Authorization': `Bearer ${mollieApiKey}` }
            })

            if (!mollieResponse.ok) {
                logger.error('Mollie API fetch failed', { status: mollieResponse.status, paymentId: String(molliePaymentId) })
                // Return 502 so Mollie retries
                return new Response('Mollie API Error', { status: 502 })
            }

            molliePayment = await mollieResponse.json()
        } catch (fetchErr) {
            logger.error('Mollie API fetch exception', fetchErr)
            return new Response('Mollie API Unreachable', { status: 502 })
        }

        const { status, metadata } = molliePayment
        const orderId = metadata?.order_id

        if (!orderId) {
            logger.warn('No order_id in payment metadata — cannot process', { paymentId: String(molliePaymentId) })
            // Return 200 to stop retries (this payment has no order association)
            return new Response('OK - no order_id', { status: 200 })
        }

        logger.info('Payment status from Mollie', {
            paymentId: String(molliePaymentId),
            status,
            orderId
        })

        // 4. IDEMPOTENCY CHECK (payment_events table)
        // Each unique (provider, provider_event_id) can only be processed once.
        // provider_event_id = "paymentId:status" ensures status changes are tracked separately.
        const eventKey = `${molliePaymentId}:${status}`

        const { error: eventError } = await supabaseAdmin
            .from('payment_events')
            .insert({
                provider: 'mollie',
                provider_event_id: eventKey,
                provider_payment_id: String(molliePaymentId),
                event_type: `payment.${status}`,
                payload: molliePayment,
                processed_at: null  // Will be set after successful processing
            })

        if (eventError) {
            // Unique constraint violation (23505) = already processed → safe to return 200
            if (eventError.code === '23505') {
                logger.info('Event already processed (idempotent)', { eventKey })
                return new Response('OK', { status: 200 })
            }
            // Other DB error → return 500 so Mollie retries
            logger.error('DB Error inserting payment_event', { error: eventError, eventKey })
            return new Response('Database Error', { status: 500 })
        }

        logger.info('Payment event recorded', { eventKey })

        // 5. CALL RPC: handle_payment_webhook
        // This is the atomic transaction that:
        // - Updates payment status
        // - Updates order status
        // - Issues ticket_instances (new model)
        // - Queues confirmation email via email_outbox
        // - Handles overbooked failsafe
        const { data: webhookResult, error: rpcError } = await supabaseAdmin.rpc('handle_payment_webhook', {
            _order_id: orderId,
            _payment_id: String(molliePaymentId),
            _status: status,
            _amount: parseFloat(molliePayment.amount?.value || '0'),
            _currency: molliePayment.amount?.currency || 'EUR'
        })

        if (rpcError) {
            logger.error('RPC handle_payment_webhook failed', {
                error: rpcError.message,
                orderId,
                status
            })
            // Return 500 so Mollie retries — the idempotency check will catch duplicates
            return new Response('Transaction Failed', { status: 500 })
        }

        logger.info('Webhook RPC result', webhookResult)

        // Handle overbooked scenario
        if (webhookResult?.overbooked) {
            logger.warn('OVERBOOKED DETECTED — order cancelled, refund required', {
                orderId,
                available: webhookResult.available,
                requested: webhookResult.requested,
                ticketType: webhookResult.ticket_type
            })
            // Still return 200 — the order is cancelled, refund must be handled externally
        }

        // Log success
        if (webhookResult?.paid) {
            logger.info('Order marked as PAID', {
                orderId,
                ticketsIssued: webhookResult.tickets_issued,
                emailQueued: webhookResult.email_queued
            })
        }

        // 6. MARK EVENT AS PROCESSED
        await supabaseAdmin
            .from('payment_events')
            .update({ processed_at: new Date().toISOString() })
            .eq('provider', 'mollie')
            .eq('provider_event_id', eventKey)

        logger.info('Webhook processed successfully', { eventKey, status })
        return new Response('OK', { status: 200 })

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Unexpected error in webhook', message)
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
    logger: any
): Promise<Response> {
    logger.info('Processing REFUND webhook', { refundId: mollieRefundId })

    // Fetch refund from Mollie
    let mollieRefund: any
    try {
        const refundResponse = await fetch(`${MOLLIE_API_URL}/refunds/${mollieRefundId}`, {
            headers: { 'Authorization': `Bearer ${mollieApiKey}` }
        })

        if (!refundResponse.ok) {
            logger.error('Mollie refund fetch failed', { status: refundResponse.status, refundId: mollieRefundId })
            return new Response('Mollie API Error', { status: 502 })
        }

        mollieRefund = await refundResponse.json()
    } catch (fetchErr) {
        logger.error('Mollie refund fetch exception', fetchErr)
        return new Response('Mollie API Unreachable', { status: 502 })
    }

    const { status } = mollieRefund
    logger.info('Refund status from Mollie', { refundId: mollieRefundId, status })

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
        logger.error('DB Error inserting refund event', { error: eventError, eventKey })
        return new Response('Database Error', { status: 500 })
    }

    // Call RPC to handle refund status update
    const { data: result, error: rpcError } = await supabaseAdmin.rpc('handle_refund_webhook', {
        _mollie_refund_id: mollieRefundId,
        _status: status,
        _refunded_at: status === 'refunded' ? new Date().toISOString() : null
    })

    if (rpcError) {
        logger.error('RPC handle_refund_webhook failed', { error: rpcError.message, refundId: mollieRefundId })
        return new Response('Transaction Failed', { status: 500 })
    }

    logger.info('Refund webhook processed', { result })

    // Mark event as processed
    await supabaseAdmin
        .from('payment_events')
        .update({ processed_at: new Date().toISOString() })
        .eq('provider', 'mollie')
        .eq('provider_event_id', eventKey)

    logger.info('Refund webhook completed', { refundId: mollieRefundId, status })
    return new Response('OK', { status: 200 })
}
