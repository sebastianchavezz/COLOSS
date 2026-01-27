/**
 * create-order Edge Function
 *
 * Doel: Create een order met ticket items voor een event.
 *
 * Flow:
 * 1. Validatie: event bestaat, tickets zijn published
 * 2. Compute totaal op basis van ticket prijzen
 * 3. Create order + order_items in één transaction
 * 4. Als totaal == 0 (gratis): auto mark as paid + call issue-tickets
 * 5. Return order details
 *
 * Security: Authenticated users only (org members for now).
 * Later: public checkout with stricter validation.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { authenticateUser } from '../_shared/auth.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'
import type { OrderItemInput } from '../_shared/types.ts'

interface CreateOrderRequest {
    event_id: string
    items: OrderItemInput[]
    email: string
    invitation_code?: string
}

serve(async (req: Request) => {
    // Handle CORS preflight
    const corsResponse = handleCors(req)
    if (corsResponse) return corsResponse

    const logger = createLogger('create-order')
    logger.info('Function invoked')

    try {
        // ===========================================================
        // 1. AUTHENTICATE USER
        // ===========================================================
        const { user, error: authError } = await authenticateUser(req)
        if (authError) {
            return errorResponse('Unauthorized', authError, 401)
        }

        logger.info('Authenticated user', user!.id)

        // ===========================================================
        // 2. PARSE & VALIDATE INPUT
        // ===========================================================
        let body: Partial<CreateOrderRequest>
        try {
            body = await req.json()
        } catch {
            return errorResponse('Invalid JSON', 'INVALID_JSON', 400)
        }

        const { event_id, items, email, invitation_code } = body

        if (!event_id) {
            return errorResponse('Missing event_id', 'MISSING_EVENT_ID', 400)
        }
        if (!items || items.length === 0) {
            return errorResponse('Missing items', 'MISSING_ITEMS', 400)
        }
        if (!email) {
            return errorResponse('Missing email', 'MISSING_EMAIL', 400)
        }

        logger.info('Creating order', {
            event_id,
            itemCount: items.length,
            email,
            has_invitation_code: !!invitation_code
        })

        // ===========================================================
        // 3. GET SERVICE ROLE CLIENT
        // ===========================================================
        const supabaseAdmin = getServiceClient()

        // ===========================================================
        // 4. VERIFY EVENT EXISTS
        // ===========================================================
        const { data: event, error: eventError } = await supabaseAdmin
            .from('events')
            .select('id, name, status')
            .eq('id', event_id)
            .single()

        if (eventError || !event) {
            logger.error('Event not found', eventError)
            return errorResponse('Event not found', 'EVENT_NOT_FOUND', 404)
        }

        logger.info('Event validated', event.name)

        // ===========================================================
        // 5. FETCH AND VALIDATE TICKET TYPES
        // ===========================================================
        const ticketIds = items.map(item => item.ticket_type_id)
        const { data: tickets, error: ticketsError } = await supabaseAdmin
            .from('ticket_types')
            .select('id, name, price, status, event_id')
            .in('id', ticketIds)
            .eq('event_id', event_id)

        if (ticketsError || !tickets) {
            logger.error('Error fetching tickets', ticketsError)
            return errorResponse('Error fetching tickets', 'TICKETS_FETCH_ERROR', 500)
        }

        if (tickets.length !== ticketIds.length) {
            return errorResponse(
                'Some tickets not found',
                'TICKETS_NOT_FOUND',
                400,
                'Check ticket_type_ids'
            )
        }

        // Verify all tickets are published (for now; later relax for org members)
        const unpublished = tickets.filter(t => t.status !== 'published')
        if (unpublished.length > 0) {
            return errorResponse(
                'Some tickets not published',
                'TICKETS_NOT_PUBLISHED',
                400,
                unpublished.map(t => t.name)
            )
        }

        logger.info('Validated ticket types', tickets.length)

        // ===========================================================
        // 6. COMPUTE SUBTOTAL (before discounts)
        // ===========================================================
        let subtotalAmount = 0
        const orderItems = []

        for (const item of items) {
            const ticket = tickets.find(t => t.id === item.ticket_type_id)
            if (!ticket) continue // Should not happen (validated above)

            const unitPrice = parseFloat(ticket.price.toString())
            const totalPrice = unitPrice * item.quantity

            subtotalAmount += totalPrice

            orderItems.push({
                ticket_type_id: ticket.id,
                quantity: item.quantity,
                unit_price: unitPrice,
                total_price: totalPrice,
            })
        }

        logger.info('Subtotal amount calculated', `€${subtotalAmount.toFixed(2)}`)

        // ===========================================================
        // 7. CREATE ORDER (initial state, will be updated with pricing)
        // ===========================================================
        const { data: order, error: orderError } = await supabaseAdmin
            .from('orders')
            .insert({
                event_id,
                user_id: user!.id,
                email,
                status: 'pending', // Will be updated after pricing calculation
                subtotal_amount: subtotalAmount,
                total_amount: subtotalAmount, // Initial value, will be updated
                currency: 'EUR',
            })
            .select('id, status, total_amount, subtotal_amount, created_at')
            .single()

        if (orderError || !order) {
            logger.error('Error creating order', orderError)
            return errorResponse(
                'Failed to create order',
                'ORDER_CREATE_FAILED',
                500,
                orderError?.message
            )
        }

        logger.info('Order created (initial)', { id: order.id, subtotal: subtotalAmount })

        // ===========================================================
        // 8. CREATE ORDER ITEMS
        // ===========================================================
        const itemsWithOrderId = orderItems.map(item => ({
            ...item,
            order_id: order.id,
        }))

        const { error: itemsError } = await supabaseAdmin
            .from('order_items')
            .insert(itemsWithOrderId)

        if (itemsError) {
            logger.error('Error creating order items', itemsError)

            // Rollback order (soft approach: mark as failed)
            await supabaseAdmin
                .from('orders')
                .update({ status: 'failed' })
                .eq('id', order.id)

            return errorResponse(
                'Failed to create order items',
                'ORDER_ITEMS_CREATE_FAILED',
                500,
                itemsError.message
            )
        }

        logger.info('Created order items', orderItems.length)

        // ===========================================================
        // 9. CALCULATE PRICING WITH DISCOUNTS
        // ===========================================================
        const { data: pricingResult, error: pricingError } = await supabaseAdmin
            .rpc('calculate_order_pricing', {
                _order_id: order.id,
                _invitation_code: invitation_code || null
            })

        if (pricingError) {
            logger.error('Error calculating pricing', pricingError)
            // Don't fail the order, but warn
            logger.warn('Order created without discount application')
        }

        if (pricingResult && !pricingResult.success) {
            logger.warn('Pricing calculation failed', pricingResult)
            // If invitation code is invalid, return error
            if (invitation_code && pricingResult.error === 'INVALID_INVITATION_CODE') {
                // Rollback order
                await supabaseAdmin
                    .from('orders')
                    .update({ status: 'failed' })
                    .eq('id', order.id)

                return errorResponse(
                    'Invalid invitation code',
                    'INVALID_INVITATION_CODE',
                    400,
                    pricingResult.details
                )
            }
        }

        const finalAmount = pricingResult?.total_amount || subtotalAmount
        const discountAmount = pricingResult?.discount_amount || 0

        logger.info('Final pricing calculated', {
            subtotal: subtotalAmount,
            discount: discountAmount,
            total: finalAmount
        })

        // Update order status if free
        if (finalAmount === 0) {
            await supabaseAdmin
                .from('orders')
                .update({ status: 'paid' })
                .eq('id', order.id)
        }

        // ===========================================================
        // 10. IF FREE: ISSUE TICKETS IMMEDIATELY
        // ===========================================================
        let issuedTickets = null

        if (finalAmount === 0) {
            logger.info('Free order, issuing tickets immediately')

            // Get service role key for internal function call
            const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ??
                                   Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
            const supabaseUrl = Deno.env.get('SUPABASE_URL')!

            // Call issue-tickets function (internal)
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
                logger.info('Issued tickets', issuedTickets.length)
            } else {
                logger.error('Failed to issue tickets', await issueResponse.text())
                // Don't fail the order, can retry later
            }
        }

        // ===========================================================
        // 11. RETURN SUCCESS
        // ===========================================================
        return jsonResponse({
            message: 'Order created successfully',
            order: {
                id: order.id,
                status: finalAmount === 0 ? 'paid' : 'pending',
                subtotal_amount: subtotalAmount,
                discount_amount: discountAmount,
                total_amount: finalAmount,
                created_at: order.created_at,
            },
            pricing: pricingResult,
            items: orderItems,
            issued_tickets: issuedTickets,
        }, 200)

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Unexpected error', message)
        return errorResponse('Internal server error', 'UNEXPECTED_ERROR', 500, message)
    }
})
