/**
 * mollie-webhook Edge Function
 *
 * Processes Mollie payment webhook notifications.
 * This function is called by Mollie when a payment status changes.
 *
 * Security: Webhook is verified by fetching payment from Mollie API.
 * Uses idempotency via payment_events table to prevent duplicate processing.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

const MOLLIE_API_URL = "https://api.mollie.com/v2/payments"

serve(async (req: Request) => {
    const logger = createLogger('mollie-webhook')
    logger.info('Webhook invoked')

    try {
        // 1. PARSE WEBHOOK
        const formData = await req.formData()
        const molliePaymentId = formData.get('id')

        if (!molliePaymentId) {
            logger.warn('Missing payment id in webhook')
            return new Response('Missing id', { status: 400 })
        }

        logger.info('Processing webhook', String(molliePaymentId))

        // 2. SETUP ADMIN CLIENT
        const supabaseAdmin = getServiceClient()

        // 3. FETCH FROM MOLLIE (Webhook verification)
        const mollieApiKey = Deno.env.get('MOLLIE_API_KEY')
        if (!mollieApiKey) {
            logger.error('Missing MOLLIE_API_KEY')
            return new Response('Server Error', { status: 500 })
        }

        const mollieResponse = await fetch(`${MOLLIE_API_URL}/${molliePaymentId}`, {
            headers: { 'Authorization': `Bearer ${mollieApiKey}` }
        })

        if (!mollieResponse.ok) {
            logger.error('Mollie fetch failed', { status: mollieResponse.status })
            return new Response('Mollie API Error', { status: 502 })
        }

        const molliePayment = await mollieResponse.json()
        const { status, metadata } = molliePayment
        const orderId = metadata?.order_id

        if (!orderId) {
            logger.warn('No order_id in payment metadata')
            return new Response('Invalid Metadata', { status: 200 }) // Stop retries
        }

        logger.info('Payment status', { paymentId: String(molliePaymentId), status, orderId })

        // 4. IDEMPOTENCY (Payment Events)
        // We store each unique event (paymentId:status) to prevent duplicate processing
        const eventKey = `${molliePaymentId}:${status}`
        const { error: eventError } = await supabaseAdmin
            .from('payment_events')
            .insert({
                provider: 'mollie',
                provider_event_id: eventKey,
                provider_payment_id: String(molliePaymentId),
                event_type: `payment.${status}`,
                payload: molliePayment,
                processed_at: null
            })

        if (eventError) {
            // Unique constraint violation = already processed
            if (eventError.code === '23505') {
                logger.info('Event already processed (idempotent)', eventKey)
                return new Response('OK', { status: 200 })
            }
            logger.error('DB Error inserting payment event', eventError)
            return new Response('Database Error', { status: 500 })
        }

        logger.info('Payment event recorded', eventKey)

        // 5. UPDATE DB VIA RPC
        // The RPC function handles order status updates, registration updates, and ticket issuance
        const { data: isPaid, error: rpcError } = await supabaseAdmin.rpc('handle_payment_webhook', {
            _order_id: orderId,
            _payment_id: String(molliePaymentId),
            _status: status,
            _amount: molliePayment.amount.value,
            _currency: molliePayment.amount.currency
        })

        if (rpcError) {
            logger.error('RPC Error', rpcError)
            return new Response('Transaction Failed', { status: 500 })
        }

        if (isPaid) {
            logger.info('Order marked as PAID', { orderId })
            // TODO: Trigger email sending asynchronously
        }

        // 6. MARK EVENT AS PROCESSED
        await supabaseAdmin
            .from('payment_events')
            .update({ processed_at: new Date().toISOString() })
            .eq('provider', 'mollie')
            .eq('provider_event_id', eventKey)

        logger.info('Webhook processed successfully')
        return new Response('OK', { status: 200 })

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Unexpected error', message)
        return new Response('Internal Server Error', { status: 500 })
    }
})
