/**
 * get-order-public Edge Function
 *
 * Lookup order by public token (no authentication required)
 *
 * Flow:
 * 1. Hash incoming token
 * 2. Lookup order by public_token_hash
 * 3. Return safe public data (no org internals)
 * 4. Include ticket instances if issued
 *
 * Security: Only returns minimal safe data, token must match hash
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

/**
 * Hash token using SHA-256
 */
async function hashToken(token: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(token)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
    return hashHex
}

serve(async (req: Request) => {
    // Handle CORS preflight
    const corsResponse = handleCors(req)
    if (corsResponse) return corsResponse

    const logger = createLogger('get-order-public')
    logger.info('Invoked')

    try {
        // ===========================================================
        // 1. PARSE INPUT
        // ===========================================================
        let body: { public_token?: string }

        try {
            body = await req.json()
        } catch {
            return errorResponse('Invalid JSON', 'INVALID_JSON', 400)
        }

        const { public_token } = body

        if (!public_token) {
            return errorResponse('Missing public_token', 'MISSING_TOKEN', 400)
        }

        logger.info('Token received', { preview: public_token.slice(0, 8) + '...' })

        // ===========================================================
        // 2. HASH TOKEN
        // ===========================================================
        const tokenHash = await hashToken(public_token)

        // ===========================================================
        // 3. GET SERVICE ROLE CLIENT
        // ===========================================================
        const supabaseAdmin = getServiceClient()

        // ===========================================================
        // 4. LOOKUP ORDER BY TOKEN HASH
        // ===========================================================
        const { data: order, error: orderError } = await supabaseAdmin
            .from('orders')
            .select(`
        id,
        event_id,
        email,
        purchaser_name,
        status,
        total_amount,
        currency,
        created_at,
        events!inner(
          id,
          slug,
          name,
          start_time,
          location_name
        )
      `)
            .eq('public_token_hash', tokenHash)
            .single()

        if (orderError || !order) {
            logger.error('Order not found', orderError)
            return errorResponse(
                'Order not found',
                'ORDER_NOT_FOUND',
                404,
                'Invalid or expired token'
            )
        }

        logger.info('Found order', { orderId: order.id })

        // ===========================================================
        // 5. FETCH ORDER ITEMS
        // ===========================================================
        const { data: orderItems, error: itemsError } = await supabaseAdmin
            .from('order_items')
            .select(`
        id,
        quantity,
        unit_price,
        total_price,
        ticket_types!inner(
          id,
          name,
          description
        )
      `)
            .eq('order_id', order.id)

        if (itemsError) {
            logger.error('Error fetching items', itemsError)
        }

        // ===========================================================
        // 6. FETCH TICKET INSTANCES (if order is paid)
        // ===========================================================
        let ticketInstances = null

        if (order.status === 'paid') {
            const { data: tickets, error: ticketsError } = await supabaseAdmin
                .from('ticket_instances')
                .select(`
          id,
          qr_code,
          status,
          ticket_types!inner(
            id,
            name
          )
        `)
                .eq('order_id', order.id)

            if (!ticketsError && tickets) {
                ticketInstances = tickets.map(t => ({
                    id: t.id,
                    qr_code: t.qr_code,
                    status: t.status,
                    ticket_name: t.ticket_types.name,
                }))
            }
        }

        // Enforce Ticket Delivery (Sprint 10)
        const { data: ticketsAvailable } = await supabaseAdmin
            .rpc('are_tickets_available', { _event_id: order.event_id })

        // ===========================================================
        // 7. RETURN PUBLIC-SAFE DATA
        // ===========================================================
        return jsonResponse({
            order: {
                id: order.id,
                email: order.email,
                purchaser_name: order.purchaser_name,
                status: order.status,
                total_amount: order.total_amount,
                currency: order.currency,
                created_at: order.created_at,
            },
            event: {
                slug: order.events.slug,
                name: order.events.name,
                start_time: order.events.start_time,
                location_name: order.events.location_name,
            },
            items: orderItems?.map(item => ({
                ticket_name: item.ticket_types.name,
                ticket_description: item.ticket_types.description,
                quantity: item.quantity,
                unit_price: item.unit_price,
                total_price: item.total_price,
            })) || [],
            tickets: ticketInstances?.map(t => ({
                ...t,
                // Mask QR code if tickets are not yet available
                qr_code: ticketsAvailable ? t.qr_code : null,
                _masked: !ticketsAvailable
            })),
            tickets_available: ticketsAvailable
        }, 200)

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Unexpected error', message)
        return errorResponse(
            'Internal server error',
            'UNEXPECTED_ERROR',
            500,
            message
        )
    }
})
