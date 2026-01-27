/**
 * create-mollie-payment Edge Function
 *
 * Creates a Mollie payment for an order
 *
 * Flow:
 * 1. Authenticate user
 * 2. Validate order (exists, belongs to user, not already paid, total > 0)
 * 3. Check for existing active payment (idempotency)
 * 4. Create Mollie payment
 * 5. Store payment record in DB
 * 6. Return checkout URL
 *
 * Security: User must own the order OR be org member
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { authenticateUser, isOrgMember } from '../_shared/auth.ts'
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

    const logger = createLogger('create-mollie-payment')
    logger.info('Function invoked')

    try {
        // =================================================================
        // 1. AUTHENTICATE USER
        // =================================================================
        const { user, error: authError } = await authenticateUser(req)
        if (authError) {
            return errorResponse('Unauthorized', authError, 401)
        }

        logger.info('User authenticated', user!.id)

        // =================================================================
        // 2. PARSE INPUT
        // =================================================================
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

        // =================================================================
        // 3. VALIDATE ORDER
        // =================================================================
        const supabaseAdmin = getServiceClient()

        const { data: order, error: orderError } = await supabaseAdmin
            .from('orders')
            .select('id, org_id, event_id, total_amount, currency, status, user_id, deleted_at')
            .eq('id', order_id)
            .single()

        if (orderError || !order || order.deleted_at !== null) {
            logger.error('Order not found', orderError)
            return errorResponse('Order not found', 'ORDER_NOT_FOUND', 404)
        }

        // Check ownership: user owns order OR user is org member
        const isOwner = order.user_id === user!.id
        const hasOrgAccess = isOwner || await isOrgMember(supabaseAdmin, order.org_id, user!.id)

        if (!hasOrgAccess) {
            return errorResponse('Not authorized for this order', 'FORBIDDEN', 403)
        }

        // Validate order status
        if (order.status === 'paid') {
            return errorResponse('Order is already paid', 'ORDER_ALREADY_PAID', 400)
        }

        if (order.total_amount <= 0) {
            return errorResponse('Order total must be greater than 0', 'INVALID_AMOUNT', 400)
        }

        logger.info('Order validated', { orderId: order.id, amount: order.total_amount })

        // =================================================================
        // 4. CHECK FOR EXISTING ACTIVE PAYMENT (IDEMPOTENCY)
        // =================================================================
        const { data: existingPayment } = await supabaseAdmin
            .from('payments')
            .select('id, provider_payment_id, status')
            .eq('order_id', order_id)
            .in('status', ['created', 'open', 'pending'])
            .order('created_at', { ascending: false })
            .limit(1)
            .single()

        if (existingPayment) {
            logger.info('Existing active payment found', existingPayment.provider_payment_id)

            // Fetch from Mollie to get latest checkout URL
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
                    checkoutUrl: mollieData._links?.checkout?.href,
                    paymentId: existingPayment.provider_payment_id,
                    existing: true
                }, 200)
            }
        }

        // =================================================================
        // 5. CREATE MOLLIE PAYMENT
        // =================================================================
        const mollieApiKey = Deno.env.get('MOLLIE_API_KEY')
        if (!mollieApiKey) {
            logger.error('Missing MOLLIE_API_KEY')
            return errorResponse('Server misconfiguration', 'MISSING_MOLLIE_KEY', 500)
        }

        // Format amount for Mollie (string, 2 decimals)
        const amountString = (order.total_amount / 100).toFixed(2)

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
                org_id: order.org_id,
                event_id: order.event_id,
                user_id: user!.id,
            },
        }

        logger.info('Creating Mollie payment', { amount: amountString, currency: order.currency })

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

        // =================================================================
        // 6. STORE PAYMENT RECORD
        // =================================================================
        const { data: payment, error: insertError } = await supabaseAdmin
            .from('payments')
            .insert({
                org_id: order.org_id,
                order_id: order.id,
                provider: 'mollie',
                provider_payment_id: mollieData.id,
                amount: order.total_amount,
                currency: order.currency || 'EUR',
                status: mollieData.status, // Usually 'open'
            })
            .select('id')
            .single()

        if (insertError) {
            logger.error('Failed to store payment', insertError)
            // Critical: Payment created at Mollie but not in DB
            // In production, you might want to cancel the Mollie payment or alert
            return errorResponse('Failed to record payment', 'PAYMENT_STORAGE_FAILED', 500)
        }

        // Log audit entry
        await supabaseAdmin
            .from('audit_log')
            .insert({
                org_id: order.org_id,
                actor_user_id: user!.id,
                action: 'PAYMENT_CREATED',
                entity_type: 'payment',
                entity_id: payment.id,
                after_state: { provider_payment_id: mollieData.id, status: mollieData.status },
                metadata: { order_id: order.id }
            })

        logger.info('Payment stored', payment.id)

        // =================================================================
        // 7. RETURN CHECKOUT URL
        // =================================================================
        return jsonResponse({
            checkoutUrl: mollieData._links.checkout.href,
            paymentId: mollieData.id
        }, 200)

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Unexpected error', message)
        return errorResponse('Internal server error', 'UNEXPECTED_ERROR', 500, message)
    }
})
