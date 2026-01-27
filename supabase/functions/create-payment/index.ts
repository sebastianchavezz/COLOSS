/**
 * create-payment Edge Function
 *
 * Creates a Mollie payment for an order (simplified version).
 * Similar to create-mollie-payment but with stricter ownership (user must own order).
 *
 * Flow:
 * 1. Authenticate user
 * 2. Validate order (exists, belongs to user, not paid, total > 0)
 * 3. Check for existing active payment (idempotency)
 * 4. Create Mollie payment
 * 5. Store payment record
 * 6. Return checkout URL
 *
 * Security: User must own the order (no org member fallback)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { authenticateUser } from '../_shared/auth.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

const MOLLIE_API_URL = "https://api.mollie.com/v2/payments"

interface CreatePaymentRequest {
    order_id: string
    redirect_url?: string
}

serve(async (req: Request) => {
    // Handle CORS preflight
    const corsResponse = handleCors(req)
    if (corsResponse) return corsResponse

    const logger = createLogger('create-payment')
    logger.info('Function invoked')

    try {
        // 1. AUTHENTICATE USER
        const { user, error: authError } = await authenticateUser(req)
        if (authError) {
            return errorResponse('Unauthorized', authError, 401)
        }

        logger.info('User authenticated', user!.id)

        // 2. PARSE INPUT
        let body: Partial<CreatePaymentRequest>
        try {
            body = await req.json()
        } catch {
            return errorResponse('Invalid JSON', 'INVALID_JSON', 400)
        }

        const { order_id, redirect_url } = body

        if (!order_id) {
            return errorResponse('Missing order_id', 'MISSING_ORDER_ID', 400)
        }

        // 3. VALIDATE ORDER
        const supabaseAdmin = getServiceClient()

        const { data: order, error: orderError } = await supabaseAdmin
            .from('orders')
            .select('id, org_id, event_id, total_amount, currency, status, user_id')
            .eq('id', order_id)
            .single()

        if (orderError || !order) {
            logger.error('Order not found', orderError)
            return errorResponse('Order not found', 'ORDER_NOT_FOUND', 404)
        }

        // Check ownership (strict - no org member fallback)
        if (order.user_id !== user!.id) {
            logger.warn('User does not own order')
            return errorResponse('Not authorized for this order', 'FORBIDDEN', 403)
        }

        if (order.status === 'paid') {
            return errorResponse('Order is already paid', 'ORDER_ALREADY_PAID', 409)
        }

        if (order.total_amount <= 0) {
            return errorResponse('Order is free, no payment needed', 'INVALID_AMOUNT', 400)
        }

        logger.info('Order validated', { orderId: order.id, amount: order.total_amount })

        // 4. CHECK EXISTING PAYMENT (Idempotency)
        const { data: existingPayment } = await supabaseAdmin
            .from('payments')
            .select('id, provider_payment_id, status')
            .eq('order_id', order_id)
            .in('status', ['open', 'pending'])
            .order('created_at', { ascending: false })
            .limit(1)
            .single()

        if (existingPayment) {
            logger.info('Existing payment found', existingPayment.provider_payment_id)

            // Fetch from Mollie to get checkout URL
            const mollieApiKey = Deno.env.get('MOLLIE_API_KEY')
            if (!mollieApiKey) {
                return errorResponse('Server misconfiguration', 'MISSING_MOLLIE_KEY', 500)
            }

            const mollieResponse = await fetch(`${MOLLIE_API_URL}/${existingPayment.provider_payment_id}`, {
                headers: { 'Authorization': `Bearer ${mollieApiKey}` }
            })

            if (mollieResponse.ok) {
                const mollieData = await mollieResponse.json()
                return jsonResponse({
                    checkout_url: mollieData._links?.checkout?.href,
                    payment_id: existingPayment.provider_payment_id
                }, 200)
            }
        }

        // 5. CREATE MOLLIE PAYMENT
        const mollieApiKey = Deno.env.get('MOLLIE_API_KEY')
        if (!mollieApiKey) {
            logger.error('Missing MOLLIE_API_KEY')
            return errorResponse('Server misconfiguration', 'MISSING_MOLLIE_KEY', 500)
        }

        const amountString = order.total_amount.toFixed(2)
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!

        const molliePayload = {
            amount: {
                currency: order.currency || 'EUR',
                value: amountString,
            },
            description: `Order ${order.id}`,
            redirectUrl: redirect_url || `${req.headers.get('origin')}/orders/${order.id}`,
            webhookUrl: `${supabaseUrl}/functions/v1/mollie-webhook`,
            metadata: {
                order_id: order.id,
                org_id: order.org_id
            },
        }

        logger.info('Creating Mollie payment', { amount: amountString })

        const mollieResponse = await fetch(MOLLIE_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${mollieApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(molliePayload),
        })

        const mollieData = await mollieResponse.json()

        if (!mollieResponse.ok) {
            logger.error('Mollie API error', mollieData)
            return errorResponse('Payment provider error', 'MOLLIE_ERROR', 502, mollieData)
        }

        logger.info('Mollie payment created', mollieData.id)

        // 6. STORE PAYMENT
        const { error: insertError } = await supabaseAdmin
            .from('payments')
            .insert({
                org_id: order.org_id,
                order_id: order.id,
                provider: 'mollie',
                provider_payment_id: mollieData.id,
                amount: order.total_amount,
                currency: order.currency || 'EUR',
                status: mollieData.status,
            })

        if (insertError) {
            logger.error('Failed to store payment', insertError)
            return errorResponse('Failed to record payment', 'PAYMENT_STORAGE_FAILED', 500)
        }

        logger.info('Payment stored')

        return jsonResponse({
            checkout_url: mollieData._links.checkout.href,
            payment_id: mollieData.id
        }, 200)

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Unexpected error', message)
        return errorResponse('Internal server error', 'UNEXPECTED_ERROR', 500, message)
    }
})
