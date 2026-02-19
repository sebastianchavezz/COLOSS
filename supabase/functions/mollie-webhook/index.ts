/**
 * mollie-webhook Edge Function
 *
 * Processes Mollie payment, refund, AND subscription webhook notifications.
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
 * 3.5. If payment has subscriptionId → route to subscription handler
 * 4. Idempotency check via payment_events
 * 5. Call appropriate RPC
 * 6. Mark event as processed
 * 7. Return 200 OK
 *
 * @see https://docs.mollie.com/reference/webhooks
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { handleCors, corsHeaders } from '../_shared/cors.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'
import {
    getCustomerMandate,
    createMollieSubscription,
} from '../_shared/mollie.ts'

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
    // Handle CORS preflight
    const corsResponse = handleCors(req)
    if (corsResponse) return corsResponse

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
            return new Response('OK', { status: 200, headers: corsHeaders })
        }

        if (!molliePaymentId) {
            logger.warn('Missing payment id in webhook payload')
            // Return 200 per Mollie best practice (no info leakage)
            return new Response('OK', { status: 200, headers: corsHeaders })
        }

        const idStr = String(molliePaymentId)
        logger.info('Processing webhook', { id: idStr })

        // 2. SETUP
        const supabaseAdmin = getServiceClient()

        const mollieApiKey = Deno.env.get('MOLLIE_API_KEY')
        if (!mollieApiKey) {
            logger.error('Missing MOLLIE_API_KEY environment variable')
            // Return 500 so Mollie retries when we fix config
            return new Response('Server Configuration Error', { status: 500, headers: corsHeaders })
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
                return new Response('OK', { status: 200, headers: corsHeaders })
            }

            if (!mollieResponse.ok) {
                logger.error('Mollie API error', {
                    status: mollieResponse.status,
                    paymentId: idStr
                })
                // Return 502 so Mollie retries
                return new Response('Mollie API Error', { status: 502, headers: corsHeaders })
            }

            molliePayment = await mollieResponse.json()
        } catch (fetchErr) {
            if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
                logger.error('Mollie API timeout', { paymentId: idStr })
            } else {
                logger.error('Mollie API fetch exception', fetchErr)
            }
            // Return 502 so Mollie retries
            return new Response('Mollie API Unreachable', { status: 502, headers: corsHeaders })
        }

        const { status, metadata } = molliePayment

        // ========== SUBSCRIPTION PAYMENT DETECTION ==========
        // Mollie adds subscriptionId to payments created by a subscription.
        // Also detect first payments for subscription setup via metadata.
        const mollieSubscriptionId = molliePayment.subscriptionId
        const isSubscriptionSetup = metadata?.subscription_setup === 'true'

        if (mollieSubscriptionId || isSubscriptionSetup) {
            logger.info('Subscription payment detected', {
                paymentId: idStr,
                subscriptionId: mollieSubscriptionId,
                isSetup: isSubscriptionSetup,
                status,
            })
            return await handleSubscriptionPaymentWebhook(
                idStr, molliePayment, mollieSubscriptionId, supabaseAdmin, mollieApiKey, logger, startTime
            )
        }

        const orderId = metadata?.order_id

        if (!orderId) {
            logger.warn('No order_id in payment metadata', { paymentId: idStr, status })
            // Return 200 to stop retries (this payment has no order association in our system)
            return new Response('OK', { status: 200, headers: corsHeaders })
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
                return new Response('OK', { status: 200, headers: corsHeaders })
            }
            // Other DB error → return 500 so Mollie retries
            logger.error('DB Error inserting payment_event', {
                error: eventError.message,
                code: eventError.code,
                eventKey
            })
            return new Response('Database Error', { status: 500, headers: corsHeaders })
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
            return new Response('Transaction Failed', { status: 500, headers: corsHeaders })
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

        return new Response('OK', { status: 200, headers: corsHeaders })

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        const duration = Date.now() - startTime
        logger.error('Unexpected error in webhook', { error: message, durationMs: duration })
        // Return 500 so Mollie retries
        return new Response('Internal Server Error', { status: 500, headers: corsHeaders })
    }
})

/**
 * Handle subscription-related payment webhook from Mollie
 *
 * Two scenarios:
 * 1. First payment (subscription_setup): mandate is being established
 *    - When paid: fetch mandate, create Mollie subscription, activate our subscription
 * 2. Recurring payment: Mollie auto-charged via subscription
 *    - When paid: call handle_subscription_payment RPC
 *    - When failed: call handle_subscription_failure RPC
 */
async function handleSubscriptionPaymentWebhook(
    paymentId: string,
    molliePayment: any,
    mollieSubscriptionId: string | undefined,
    supabaseAdmin: any,
    mollieApiKey: string,
    logger: any,
    startTime: number
): Promise<Response> {
    const { status, metadata } = molliePayment
    const orderId = metadata?.order_id
    const isSubscriptionSetup = metadata?.subscription_setup === 'true'

    // Idempotency check
    const eventKey = `sub:${paymentId}:${status}`
    const { error: eventError } = await supabaseAdmin
        .from('payment_events')
        .insert({
            provider: 'mollie',
            provider_event_id: eventKey,
            provider_payment_id: paymentId,
            event_type: `subscription_payment.${status}`,
            payload: molliePayment,
            processed_at: null,
        })

    if (eventError) {
        if (eventError.code === '23505') {
            logger.info('Subscription event already processed (idempotent)', { eventKey })
            return new Response('OK', { status: 200, headers: corsHeaders })
        }
        logger.error('DB Error inserting subscription payment_event', {
            error: eventError.message,
            code: eventError.code,
            eventKey,
        })
        return new Response('Database Error', { status: 500, headers: corsHeaders })
    }

    if (isSubscriptionSetup) {
        // ========== FIRST PAYMENT (subscription setup) ==========
        return await handleFirstPayment(
            paymentId, molliePayment, supabaseAdmin, mollieApiKey, logger, startTime, eventKey
        )
    } else if (mollieSubscriptionId) {
        // ========== RECURRING PAYMENT ==========
        return await handleRecurringPayment(
            paymentId, molliePayment, mollieSubscriptionId, supabaseAdmin, logger, startTime, eventKey
        )
    }

    logger.warn('Subscription payment but no setup flag or subscriptionId', { paymentId })
    return new Response('OK', { status: 200, headers: corsHeaders })
}

/**
 * Handle the FIRST payment for a subscription setup.
 * When paid: mandate established → create Mollie subscription → activate our subscription.
 */
async function handleFirstPayment(
    paymentId: string,
    molliePayment: any,
    supabaseAdmin: any,
    mollieApiKey: string,
    logger: any,
    startTime: number,
    eventKey: string
): Promise<Response> {
    const { status, metadata } = molliePayment
    const orderId = metadata?.order_id
    const ticketTypeId = metadata?.ticket_type_id

    if (status === 'paid') {
        logger.info('First subscription payment PAID — setting up recurring', { paymentId, orderId })

        // 1. Update order to paid
        if (orderId) {
            const { data: webhookResult, error: rpcError } = await supabaseAdmin.rpc('handle_payment_webhook', {
                _order_id: orderId,
                _payment_id: paymentId,
                _status: status,
                _amount: parseFloat(molliePayment.amount?.value || '0'),
                _currency: molliePayment.amount?.currency || 'EUR'
            })

            if (rpcError) {
                logger.error('RPC handle_payment_webhook failed for subscription setup', {
                    error: rpcError.message,
                    orderId,
                })
            } else {
                logger.info('Order updated to paid for subscription setup', { orderId, result: webhookResult })
            }
        }

        // 2. Find our subscription by first_order_id
        const { data: subscription, error: subError } = await supabaseAdmin
            .from('subscriptions')
            .select('*')
            .eq('first_order_id', orderId)
            .single()

        if (subError || !subscription) {
            logger.error('Subscription not found for first payment', { orderId, error: subError })
            // Mark processed and return 200 — manual fix needed
            await markProcessed(supabaseAdmin, eventKey)
            return new Response('OK', { status: 200, headers: corsHeaders })
        }

        // 3. Get or verify mandate
        const mandate = await getCustomerMandate(subscription.mollie_customer_id)
        if (mandate) {
            logger.info('Mandate found', {
                mandateId: mandate.id,
                status: mandate.status,
                method: mandate.method,
            })

            // Update mollie_customers with mandate info
            await supabaseAdmin
                .from('mollie_customers')
                .update({
                    mollie_mandate_id: mandate.id,
                    mandate_status: mandate.status,
                })
                .eq('mollie_customer_id', subscription.mollie_customer_id)
        } else {
            logger.warn('No mandate found after first payment — may still be pending', {
                customerId: subscription.mollie_customer_id,
            })
        }

        // 4. Create Mollie subscription for recurring charges
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        try {
            const mollieSubResult = await createMollieSubscription({
                customerId: subscription.mollie_customer_id,
                amount: {
                    currency: subscription.currency || 'EUR',
                    value: parseFloat(subscription.amount).toFixed(2),
                },
                interval: subscription.billing_interval,
                description: `Abonnement ${subscription.id.slice(0, 8)}`,
                times: subscription.billing_cycle_count || undefined,
                webhookUrl: `${supabaseUrl}/functions/v1/mollie-webhook`,
                metadata: {
                    subscription_id: subscription.id,
                    event_id: subscription.event_id,
                    org_id: subscription.org_id,
                },
            })

            logger.info('Mollie subscription created', {
                mollieSubscriptionId: mollieSubResult.id,
                status: mollieSubResult.status,
            })

            // 5. Activate our subscription
            // Use Mollie's nextPaymentDate as authoritative period end
            // (avoids hardcoded day approximations that drift from calendar math)
            const now = new Date()
            const mollieNextPayment = mollieSubResult.nextPaymentDate  // ISO date from Mollie
            const periodEnd = mollieNextPayment
                ? new Date(mollieNextPayment + 'T00:00:00Z')
                : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)  // Fallback only

            await supabaseAdmin
                .from('subscriptions')
                .update({
                    mollie_subscription_id: mollieSubResult.id,
                    status: 'active',
                    started_at: now.toISOString(),
                    current_period_start: now.toISOString(),
                    current_period_end: periodEnd.toISOString(),
                    next_payment_date: mollieNextPayment || periodEnd.toISOString().split('T')[0],
                    cycles_completed: 1,
                    ends_at: subscription.billing_cycle_count
                        ? mollieSubResult.times
                            ? null  // Mollie handles termination for fixed-term
                            : null
                        : null,
                })
                .eq('id', subscription.id)

            // 6. Issue first ticket instance
            const { error: ticketError } = await supabaseAdmin
                .from('ticket_instances')
                .insert({
                    event_id: subscription.event_id,
                    ticket_type_id: subscription.ticket_type_id,
                    order_id: orderId,
                    owner_user_id: subscription.user_id,
                    qr_code: 'sub_' + crypto.randomUUID(),
                    status: 'issued',
                })

            if (ticketError) {
                logger.error('Failed to issue first subscription ticket', ticketError)
            } else {
                logger.info('First subscription ticket issued')
            }

            // 7. Record first subscription payment
            await supabaseAdmin
                .from('subscription_payments')
                .insert({
                    subscription_id: subscription.id,
                    order_id: orderId,
                    mollie_payment_id: paymentId,
                    status: 'paid',
                    amount: parseFloat(subscription.amount),
                    currency: subscription.currency || 'EUR',
                    period_start: now.toISOString(),
                    period_end: periodEnd.toISOString(),
                    cycle_number: 1,
                })

            logger.info('Subscription activated successfully', {
                subscriptionId: subscription.id,
                mollieSubscriptionId: mollieSubResult.id,
            })

        } catch (mollieErr) {
            logger.error('Failed to create Mollie subscription', mollieErr)
            // Update subscription to reflect failure — mandate may not be ready yet
            await supabaseAdmin
                .from('subscriptions')
                .update({ status: 'suspended' })
                .eq('id', subscription.id)
        }

    } else if (status === 'failed' || status === 'expired' || status === 'canceled') {
        logger.info('First subscription payment FAILED', { paymentId, status })

        // Update order if exists
        if (orderId) {
            await supabaseAdmin.rpc('handle_payment_webhook', {
                _order_id: orderId,
                _payment_id: paymentId,
                _status: status,
                _amount: parseFloat(molliePayment.amount?.value || '0'),
                _currency: molliePayment.amount?.currency || 'EUR',
            })
        }

        // Cancel the pending subscription
        const { data: sub } = await supabaseAdmin
            .from('subscriptions')
            .select('id')
            .eq('first_order_id', orderId)
            .single()

        if (sub) {
            await supabaseAdmin
                .from('subscriptions')
                .update({
                    status: 'cancelled',
                    cancelled_at: new Date().toISOString(),
                    cancel_reason: `First payment ${status}`,
                })
                .eq('id', sub.id)
        }
    }

    // Mark event as processed
    await markProcessed(supabaseAdmin, eventKey)

    const duration = Date.now() - startTime
    logger.info('Subscription first payment webhook completed', { paymentId, status, durationMs: duration })
    return new Response('OK', { status: 200, headers: corsHeaders })
}

/**
 * Handle a RECURRING payment from a Mollie subscription.
 */
async function handleRecurringPayment(
    paymentId: string,
    molliePayment: any,
    mollieSubscriptionId: string,
    supabaseAdmin: any,
    logger: any,
    startTime: number,
    eventKey: string
): Promise<Response> {
    const { status } = molliePayment

    // Find our subscription by mollie_subscription_id
    const { data: subscription, error: subError } = await supabaseAdmin
        .from('subscriptions')
        .select('*')
        .eq('mollie_subscription_id', mollieSubscriptionId)
        .single()

    if (subError || !subscription) {
        logger.error('Subscription not found for recurring payment', {
            mollieSubscriptionId,
            paymentId,
        })
        await markProcessed(supabaseAdmin, eventKey)
        return new Response('OK', { status: 200, headers: corsHeaders })
    }

    if (status === 'paid') {
        logger.info('Recurring subscription payment PAID', {
            paymentId,
            subscriptionId: subscription.id,
        })

        // Call RPC to handle subscription payment (creates order, issues ticket, etc.)
        const { data: result, error: rpcError } = await supabaseAdmin.rpc('handle_subscription_payment', {
            _subscription_id: subscription.id,
            _mollie_payment_id: paymentId,
            _amount: parseFloat(molliePayment.amount?.value || '0'),
            _currency: molliePayment.amount?.currency || 'EUR',
        })

        if (rpcError) {
            logger.error('RPC handle_subscription_payment failed', {
                error: rpcError.message,
                subscriptionId: subscription.id,
            })
            return new Response('Transaction Failed', { status: 500, headers: corsHeaders })
        }

        logger.info('Subscription payment processed', { result })

    } else if (status === 'failed' || status === 'expired') {
        logger.info('Recurring subscription payment FAILED', {
            paymentId,
            subscriptionId: subscription.id,
            status,
        })

        // Call RPC to handle failure
        const { error: failError } = await supabaseAdmin.rpc('handle_subscription_failure', {
            _subscription_id: subscription.id,
            _mollie_payment_id: paymentId,
            _failure_reason: `Payment ${status}`,
        })

        if (failError) {
            logger.error('RPC handle_subscription_failure failed', {
                error: failError.message,
                subscriptionId: subscription.id,
            })
        }
    }

    // Mark event as processed
    await markProcessed(supabaseAdmin, eventKey)

    const duration = Date.now() - startTime
    logger.info('Recurring subscription webhook completed', {
        paymentId,
        mollieSubscriptionId,
        status,
        durationMs: duration,
    })
    return new Response('OK', { status: 200, headers: corsHeaders })
}

/**
 * Mark a payment_event as processed
 */
async function markProcessed(supabaseAdmin: any, eventKey: string): Promise<void> {
    await supabaseAdmin
        .from('payment_events')
        .update({ processed_at: new Date().toISOString() })
        .eq('provider', 'mollie')
        .eq('provider_event_id', eventKey)
}

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
            return new Response('OK', { status: 200, headers: corsHeaders })
        }

        if (!refundResponse.ok) {
            logger.error('Mollie refund fetch failed', {
                status: refundResponse.status,
                refundId: mollieRefundId
            })
            return new Response('Mollie API Error', { status: 502, headers: corsHeaders })
        }

        mollieRefund = await refundResponse.json()
    } catch (fetchErr) {
        if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
            logger.error('Mollie API timeout for refund', { refundId: mollieRefundId })
        } else {
            logger.error('Mollie refund fetch exception', fetchErr)
        }
        return new Response('Mollie API Unreachable', { status: 502, headers: corsHeaders })
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
            return new Response('OK', { status: 200, headers: corsHeaders })
        }
        logger.error('DB Error inserting refund event', {
            error: eventError.message,
            code: eventError.code,
            eventKey
        })
        return new Response('Database Error', { status: 500, headers: corsHeaders })
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
        return new Response('Transaction Failed', { status: 500, headers: corsHeaders })
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

    return new Response('OK', { status: 200, headers: corsHeaders })
}
