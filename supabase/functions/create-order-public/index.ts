/**
 * create-order-public Edge Function
 *
 * Waterdichte public checkout — werkt voor zowel authenticated als guest users.
 *
 * Flow:
 * 1. Parse & validate input (event_id, items, email, purchaser_name)
 * 2. Resolve user_id from optional Bearer token
 * 3. Verify event is published + within sales window
 * 4. Atomic capacity pre-check via RPC (FOR UPDATE SKIP LOCKED)
 * 5. Server-side price calculation (never trust client prices)
 * 6. Derive org_id from event (never from client)
 * 7. Generate public_token → SHA-256 hash → store in order
 * 8. INSERT order + order_items
 * 9. If total == 0 (free): issue tickets immediately
 * 10. If total > 0: create Mollie payment → return checkout_url + public_token
 *
 * Security:
 * - Uses SERVICE_ROLE for all DB writes (bypasses RLS for creation)
 * - All inputs validated server-side
 * - Prices computed from DB, never from client
 * - Capacity checked atomically with row locking
 * - Public token hashed before storage (DB leak protection)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

const MOLLIE_API_URL = "https://api.mollie.com/v2/payments"

interface OrderItem {
    ticket_type_id: string
    quantity: number
}

interface CreateOrderPublicRequest {
    event_id: string
    items: OrderItem[]
    email: string
    purchaser_name?: string
    // Optional: Bearer token in Authorization header for authenticated users
}

/**
 * Generate a cryptographically secure random token (base64url)
 */
function generateToken(): string {
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    return btoa(String.fromCharCode(...array))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
}

/**
 * Hash a token using SHA-256 → hex string
 */
async function hashToken(token: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(token)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

serve(async (req: Request) => {
    // Handle CORS preflight
    const corsResponse = handleCors(req)
    if (corsResponse) return corsResponse

    const logger = createLogger('create-order-public')
    logger.info('Function invoked')

    try {
        // Only POST allowed
        if (req.method !== 'POST') {
            return errorResponse('Method not allowed', 'METHOD_NOT_ALLOWED', 405)
        }

        // =================================================================
        // 1. PARSE & VALIDATE INPUT
        // =================================================================
        let body: Partial<CreateOrderPublicRequest>
        try {
            body = await req.json()
        } catch {
            return errorResponse('Invalid JSON', 'INVALID_JSON', 400)
        }

        const { event_id, items, email, purchaser_name } = body

        if (!event_id) {
            return errorResponse('Missing event_id', 'MISSING_EVENT_ID', 400)
        }
        if (!items || !Array.isArray(items) || items.length === 0) {
            return errorResponse('Missing or empty items array', 'MISSING_ITEMS', 400)
        }
        if (!email || !email.includes('@')) {
            return errorResponse('Missing or invalid email', 'MISSING_EMAIL', 400)
        }

        // Validate items structure
        for (const item of items) {
            if (!item.ticket_type_id) {
                return errorResponse('Each item must have ticket_type_id', 'INVALID_ITEM', 400)
            }
            if (!Number.isInteger(item.quantity) || item.quantity < 1) {
                return errorResponse('Each item must have quantity >= 1', 'INVALID_QUANTITY', 400)
            }
        }

        // Limit items per request (anti-spam)
        if (items.length > 20) {
            return errorResponse('Too many items (max 20)', 'TOO_MANY_ITEMS', 400)
        }

        logger.info('Input validated', { event_id, itemCount: items.length, email })

        // =================================================================
        // 2. RESOLVE USER (optional — works for both guest and authenticated)
        // =================================================================
        const supabaseAdmin = getServiceClient()
        let userId: string | null = null

        const authHeader = req.headers.get('Authorization')
        if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
                // Try to resolve user from token
                const supabaseUrl = Deno.env.get('SUPABASE_URL')
                const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
                if (supabaseUrl && anonKey) {
                    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
                    const userClient = createClient(supabaseUrl, anonKey, {
                        global: { headers: { Authorization: authHeader } }
                    })
                    const { data: { user } } = await userClient.auth.getUser()
                    if (user) {
                        userId = user.id
                        logger.info('Authenticated user resolved', { userId })
                    }
                }
            } catch {
                // Non-fatal: proceed as guest
                logger.info('Auth token invalid or missing — proceeding as guest')
            }
        }

        // =================================================================
        // 3. VERIFY EVENT IS PUBLISHED + WITHIN SALES WINDOW
        // =================================================================
        const { data: event, error: eventError } = await supabaseAdmin
            .from('events')
            .select('id, name, org_id, status')
            .eq('id', event_id)
            .single()

        if (eventError || !event) {
            logger.warn('Event not found', { event_id })
            return errorResponse('Event not found', 'EVENT_NOT_FOUND', 404)
        }

        if (event.status !== 'published') {
            return errorResponse('Event is not available for purchase', 'EVENT_NOT_PUBLISHED', 403)
        }

        logger.info('Event verified', { name: event.name, org_id: event.org_id })

        // =================================================================
        // 4. ATOMIC CAPACITY + PRICE VALIDATION (via RPC)
        // =================================================================
        const itemsJsonb = items.map(item => ({
            ticket_type_id: item.ticket_type_id,
            quantity: item.quantity
        }))

        const { data: capacityResult, error: capacityError } = await supabaseAdmin
            .rpc('validate_checkout_capacity', {
                _event_id: event_id,
                _items: itemsJsonb
            })

        if (capacityError) {
            logger.error('Capacity validation RPC failed', capacityError)
            return errorResponse('Capacity validation failed', 'CAPACITY_CHECK_ERROR', 500, capacityError.message)
        }

        if (!capacityResult || !capacityResult.valid) {
            logger.warn('Capacity validation failed', capacityResult)
            return errorResponse(
                'Checkout validation failed',
                'VALIDATION_FAILED',
                409,
                capacityResult?.details || 'Capacity or sales window check failed'
            )
        }

        const serverPrice: number = parseFloat(capacityResult.total_price.toString())
        logger.info('Capacity & pricing validated', { total_price: serverPrice, items: capacityResult.details })

        // =================================================================
        // 5. GENERATE PUBLIC TOKEN
        // =================================================================
        const publicToken = generateToken()
        const publicTokenHash = await hashToken(publicToken)
        logger.info('Public token generated', { preview: publicToken.slice(0, 8) + '...' })

        // =================================================================
        // 6. CREATE ORDER
        // =================================================================
        const { data: order, error: orderError } = await supabaseAdmin
            .from('orders')
            .insert({
                event_id: event_id,
                org_id: event.org_id,  // Derived server-side from event
                user_id: userId,       // null for guests
                email: email,
                purchaser_name: purchaser_name || null,
                status: 'pending',
                subtotal_amount: serverPrice,
                total_amount: serverPrice,
                currency: 'EUR',
                public_token_hash: publicTokenHash,
                public_token_created_at: new Date().toISOString(),
            })
            .select('id, status, total_amount, created_at')
            .single()

        if (orderError || !order) {
            logger.error('Failed to create order', orderError)
            return errorResponse('Failed to create order', 'ORDER_CREATE_FAILED', 500, orderError?.message)
        }

        logger.info('Order created', { orderId: order.id, total: order.total_amount })

        // =================================================================
        // 7. CREATE ORDER ITEMS
        // =================================================================
        const orderItemsPayload = capacityResult.details.map((detail: any) => ({
            order_id: order.id,
            ticket_type_id: detail.ticket_type_id,
            quantity: detail.quantity,
            unit_price: parseFloat(detail.price.toString()),
            total_price: parseFloat(detail.line_total.toString()),
        }))

        const { error: itemsError } = await supabaseAdmin
            .from('order_items')
            .insert(orderItemsPayload)

        if (itemsError) {
            logger.error('Failed to create order items', itemsError)
            // Rollback: mark order as failed
            await supabaseAdmin
                .from('orders')
                .update({ status: 'failed' })
                .eq('id', order.id)

            return errorResponse('Failed to create order items', 'ITEMS_CREATE_FAILED', 500, itemsError.message)
        }

        logger.info('Order items created', { count: orderItemsPayload.length })

        // =================================================================
        // 8. AUDIT LOG
        // =================================================================
        await supabaseAdmin
            .from('audit_log')
            .insert({
                org_id: event.org_id,
                actor_user_id: userId,
                action: 'ORDER_CREATED',
                entity_type: 'order',
                entity_id: order.id,
                after_state: {
                    status: 'pending',
                    total_amount: serverPrice,
                    item_count: orderItemsPayload.length,
                    is_guest: !userId
                },
                metadata: { event_id, source: 'create-order-public' }
            })
            .catch(() => {
                // Non-fatal: audit log failure should not block the flow
                logger.warn('Audit log insert failed (non-fatal)')
            })

        // =================================================================
        // 9. BRANCHING: Free vs Paid
        // =================================================================
        if (serverPrice === 0) {
            // FREE ORDER: issue tickets immediately
            logger.info('Free order detected — issuing tickets immediately')

            // Mark order as paid (free = instant)
            await supabaseAdmin
                .from('orders')
                .update({ status: 'paid' })
                .eq('id', order.id)

            // Call issue-tickets function internally
            const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ??
                                   Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
            const supabaseUrl = Deno.env.get('SUPABASE_URL')!

            let issuedTickets: any[] = []
            try {
                const issueResponse = await fetch(`${supabaseUrl}/functions/v1/issue-tickets`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${serviceRoleKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ order_id: order.id })
                })

                if (issueResponse.ok) {
                    const issueData = await issueResponse.json()
                    issuedTickets = issueData.tickets || []
                    logger.info('Tickets issued for free order', { count: issuedTickets.length })
                } else {
                    logger.error('Failed to issue tickets for free order', await issueResponse.text())
                }
            } catch (issueErr) {
                logger.error('Issue tickets call failed', issueErr)
            }

            return jsonResponse({
                success: true,
                message: 'Order completed (free)',
                order: {
                    id: order.id,
                    status: 'paid',
                    total_amount: 0,
                    created_at: order.created_at,
                },
                public_token: publicToken,
                tickets: issuedTickets
            }, 200)

        } else {
            // PAID ORDER: create Mollie payment session
            logger.info('Paid order — creating Mollie payment', { amount: serverPrice })

            const mollieApiKey = Deno.env.get('MOLLIE_API_KEY')
            if (!mollieApiKey) {
                logger.error('Missing MOLLIE_API_KEY')
                return errorResponse('Payment provider not configured', 'MISSING_MOLLIE_KEY', 500)
            }

            const supabaseUrl = Deno.env.get('SUPABASE_URL')!
            const origin = req.headers.get('origin') || 'https://localhost:3000'

            // Format amount for Mollie: EUR value as string with 2 decimals
            const amountString = serverPrice.toFixed(2)

            const molliePayload = {
                amount: {
                    currency: 'EUR',
                    value: amountString,
                },
                description: `Bestelling ${order.id.slice(0, 8)}`,
                redirectUrl: `${origin}/checkout/success?token=${publicToken}`,
                webhookUrl: `${supabaseUrl}/functions/v1/mollie-webhook`,
                metadata: {
                    order_id: order.id,
                    org_id: event.org_id,
                    event_id: event_id,
                    user_id: userId,
                },
            }

            let mollieData: any
            try {
                const mollieResponse = await fetch(MOLLIE_API_URL, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${mollieApiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(molliePayload),
                })

                mollieData = await mollieResponse.json()

                if (!mollieResponse.ok) {
                    logger.error('Mollie API error', mollieData)
                    return errorResponse(
                        'Payment provider error',
                        'MOLLIE_ERROR',
                        502,
                        mollieData.detail || 'Mollie API returned an error'
                    )
                }
            } catch (mollieErr) {
                logger.error('Mollie API call failed', mollieErr)
                return errorResponse('Payment provider unreachable', 'MOLLIE_UNREACHABLE', 502)
            }

            logger.info('Mollie payment created', { mollieId: mollieData.id })

            // Store payment record
            const { error: paymentInsertError } = await supabaseAdmin
                .from('payments')
                .insert({
                    org_id: event.org_id,
                    order_id: order.id,
                    provider: 'mollie',
                    provider_payment_id: mollieData.id,
                    amount: Math.round(serverPrice * 100),  // Store in cents
                    currency: 'EUR',
                    status: mollieData.status || 'open',
                })

            if (paymentInsertError) {
                logger.error('Failed to store payment record', paymentInsertError)
                // Critical: payment created at Mollie but not in DB
                // Return success anyway — webhook will reconcile
            }

            // Audit log: payment created
            await supabaseAdmin
                .from('audit_log')
                .insert({
                    org_id: event.org_id,
                    actor_user_id: userId,
                    action: 'PAYMENT_CREATED',
                    entity_type: 'payment',
                    entity_id: order.id,
                    after_state: { provider_payment_id: mollieData.id, status: mollieData.status },
                    metadata: { order_id: order.id }
                })
                .catch(() => logger.warn('Audit log failed (non-fatal)'))

            return jsonResponse({
                success: true,
                message: 'Order created — redirect to payment',
                order: {
                    id: order.id,
                    status: 'pending',
                    total_amount: serverPrice,
                    created_at: order.created_at,
                },
                payment: {
                    provider: 'mollie',
                    payment_id: mollieData.id,
                },
                checkout_url: mollieData._links?.checkout?.href,
                public_token: publicToken
            }, 200)
        }

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Unexpected error', message)
        return errorResponse('Internal server error', 'UNEXPECTED_ERROR', 500, message)
    }
})
