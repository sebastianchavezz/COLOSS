/**
 * issue-tickets Edge Function
 *
 * Doel: Genereer ticket instances voor een betaalde order.
 *
 * Flow:
 * 1. Verificatie: order bestaat en status = 'paid'
 * 2. Idempotent: als tickets al uitgegeven, return bestaande
 * 3. Voor elk order_item met ticket_type_id:
 *    - Genereer {quantity} ticket_instances met unieke QR codes
 * 4. Return lijst van ticket IDs
 *
 * Security: JWT verification enabled, support for both user JWT and service role.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { authenticateUser } from '../_shared/auth.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

serve(async (req: Request) => {
    // Handle CORS preflight
    const corsResponse = handleCors(req)
    if (corsResponse) return corsResponse

    const logger = createLogger('issue-tickets')
    logger.info('Invoked')

    try {
        // ===========================================================
        // 1. VERIFY AUTH (supports both user JWT and service role)
        // ===========================================================
        const authHeader = req.headers.get('Authorization')
        if (!authHeader) {
            return errorResponse('Unauthorized', 'NO_AUTH_HEADER', 401)
        }

        // Get service role key for comparison
        const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
        const isServiceRole = authHeader === `Bearer ${serviceRoleKey}`
        let user = null

        if (!isServiceRole) {
            const { user: authUser, error: authError } = await authenticateUser(req)
            if (authError || !authUser) {
                return errorResponse('Unauthorized', authError || 'INVALID_TOKEN', 401)
            }
            user = authUser
            logger.info('Authenticated user', { userId: user.id })
        } else {
            logger.info('Authenticated as Service Role')
        }

        // ===========================================================
        // 2. PARSE INPUT
        // ===========================================================
        let body: { order_id?: string }
        try {
            body = await req.json()
        } catch {
            return errorResponse('Invalid JSON', 'INVALID_JSON', 400)
        }

        const { order_id } = body
        if (!order_id) {
            return errorResponse('Missing order_id', 'MISSING_ORDER_ID', 400)
        }

        logger.info('Order ID received', { orderId: order_id })

        // ===========================================================
        // 3. GET SERVICE ROLE CLIENT (for privileged operations)
        // ===========================================================
        const supabaseAdmin = getServiceClient()

        // ===========================================================
        // 4. FETCH ORDER
        // ===========================================================
        const { data: order, error: orderError } = await supabaseAdmin
            .from('orders')
            .select('id, event_id, status, user_id, email')
            .eq('id', order_id)
            .single()

        if (orderError || !order) {
            logger.error('Order not found', orderError)
            return errorResponse('Order not found', 'ORDER_NOT_FOUND', 404)
        }

        logger.info('Order status', { status: order.status })

        // ===========================================================
        // 5. VERIFY ORDER STATUS
        // ===========================================================
        if (order.status !== 'paid') {
            return errorResponse(
                'Order not paid',
                'ORDER_NOT_PAID',
                400,
                `Order status is ${order.status}, must be 'paid'`
            )
        }

        // ===========================================================
        // 6. CHECK IF TICKETS ALREADY ISSUED (IDEMPOTENT)
        // ===========================================================
        const { data: existingTickets, error: existingError } = await supabaseAdmin
            .from('ticket_instances')
            .select('id, qr_code, ticket_type_id')
            .eq('order_id', order_id)

        if (existingError) {
            logger.error('Error checking existing tickets', existingError)
            return errorResponse('Database error', 'DB_ERROR', 500)
        }

        if (existingTickets && existingTickets.length > 0) {
            logger.info('Tickets already issued', { count: existingTickets.length })
            return jsonResponse({
                message: 'Tickets already issued',
                tickets: existingTickets,
                count: existingTickets.length
            }, 200)
        }

        // ===========================================================
        // 7. FETCH ORDER ITEMS
        // ===========================================================
        const { data: orderItems, error: itemsError } = await supabaseAdmin
            .from('order_items')
            .select('id, ticket_type_id, quantity, unit_price')
            .eq('order_id', order_id)

        if (itemsError || !orderItems || orderItems.length === 0) {
            logger.error('No order items found', itemsError)
            return errorResponse('No items in order', 'NO_ORDER_ITEMS', 400)
        }

        logger.info('Order items found', { count: orderItems.length })

        // ===========================================================
        // 8. GENERATE TICKET INSTANCES (IDEMPOTENT)
        // ===========================================================
        const ticketsToCreate: any[] = []

        for (const item of orderItems) {
            if (!item.ticket_type_id) {
                logger.info('Skipping non-ticket item', { itemId: item.id })
                continue
            }

            for (let i = 0; i < item.quantity; i++) {
                // Generate secure token
                const array = new Uint8Array(32)
                crypto.getRandomValues(array)
                const rawToken = btoa(String.fromCharCode(...array))
                    .replace(/\+/g, '-')
                    .replace(/\//g, '_')
                    .replace(/=+$/, '')

                // Hash token
                const encoder = new TextEncoder()
                const data = encoder.encode(rawToken)
                const hashBuffer = await crypto.subtle.digest('SHA-256', data)
                const hashArray = Array.from(new Uint8Array(hashBuffer))
                const tokenHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

                ticketsToCreate.push({
                    event_id: order.event_id,
                    ticket_type_id: item.ticket_type_id,
                    order_id: order.id,
                    order_item_id: item.id, // For idempotency
                    sequence_no: i + 1, // 1-indexed sequence
                    owner_user_id: order.user_id || null,
                    token_hash: tokenHash,
                    qr_code: rawToken.slice(0, 12), // Store preview
                    status: 'issued',
                    _rawToken: rawToken // Temporary property
                })
            }
        }

        logger.info('Creating ticket instances', { count: ticketsToCreate.length })

        // Prepare payload (remove _rawToken)
        const payload = ticketsToCreate.map(({ _rawToken, ...rest }) => rest)

        // Use insert with on_conflict to handle idempotency
        const { data: createdTickets, error: createError } = await supabaseAdmin
            .from('ticket_instances')
            .upsert(payload, {
                onConflict: 'order_item_id,sequence_no',
                ignoreDuplicates: true
            })
            .select('id, qr_code, ticket_type_id, status')

        if (createError) {
            logger.error('Error creating tickets', createError)
            return errorResponse(
                'Failed to create tickets',
                'TICKET_CREATE_FAILED',
                500,
                createError.message
            )
        }

        // Merge raw tokens back into response
        const ticketsWithTokens = createdTickets?.map((ticket, index) => ({
            ...ticket,
            token: ticketsToCreate[index]._rawToken
        }))

        logger.info('Tickets created successfully', { count: createdTickets?.length })

        if ((!ticketsWithTokens || ticketsWithTokens.length === 0) && orderItems.length > 0) {
            logger.warn('No tickets created despite order items found')
            return jsonResponse({
                message: 'No tickets created (Debug)',
                tickets: [],
                count: 0,
                debug: {
                    order_id,
                    items_found: orderItems.length,
                    items: orderItems
                }
            }, 200)
        }

        return jsonResponse({
            success: true,
            message: 'Tickets issued successfully',
            tickets: ticketsWithTokens,
            count: ticketsWithTokens?.length || 0
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
