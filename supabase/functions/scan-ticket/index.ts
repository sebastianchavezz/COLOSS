/**
 * scan-ticket Edge Function
 *
 * Doel: Scan en valideer een ticket instance voor event toegang.
 *
 * Flow:
 * 1. Input: ticket_instance_id of qr_code
 * 2. Fetch ticket instance + order status
 * 3. Return validatie info:
 *    - valid: boolean (bestaat + status = issued)
 *    - paid: boolean (order.status = paid)
 *    - already_checked_in: boolean
 *    - ticket details
 * 4. Optioneel: check_in=true om atomically in te scannen
 *
 * Security: JWT verification, org members only voor check-in.
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

    const logger = createLogger('scan-ticket')
    logger.info('Invoked')

    try {
        // ===========================================================
        // 1. VERIFY AUTH
        // ===========================================================
        const { user, error: authError } = await authenticateUser(req)
        if (authError || !user) {
            return errorResponse('Unauthorized', authError || 'INVALID_TOKEN', 401)
        }

        logger.info('Authenticated user', { userId: user.id })

        // ===========================================================
        // 2. PARSE INPUT
        // ===========================================================
        let body: { ticket_instance_id?: string; qr_code?: string; check_in?: boolean }
        try {
            body = await req.json()
        } catch {
            return errorResponse('Invalid JSON', 'INVALID_JSON', 400)
        }

        const { ticket_instance_id, qr_code, check_in } = body

        if (!ticket_instance_id && !qr_code) {
            return errorResponse(
                'Missing ticket identifier',
                'MISSING_IDENTIFIER',
                400,
                'Provide either ticket_instance_id or qr_code'
            )
        }

        logger.info('Scanning', { ticket_instance_id, qr_code, check_in })

        // ===========================================================
        // 3. GET SERVICE ROLE CLIENT
        // ===========================================================
        const supabaseAdmin = getServiceClient()

        // ===========================================================
        // 4. FETCH TICKET INSTANCE WITH ORDER STATUS
        // ===========================================================
        let query = supabaseAdmin
            .from('ticket_instances_with_payment')
            .select('*')

        if (ticket_instance_id) {
            query = query.eq('id', ticket_instance_id)
        } else if (qr_code) {
            query = query.eq('qr_code', qr_code)
        }

        const { data: ticket, error: ticketError } = await query.maybeSingle()

        if (ticketError) {
            logger.error('Database error', ticketError)
            return errorResponse('Database error', 'DB_ERROR', 500)
        }

        if (!ticket) {
            logger.info('Ticket not found')
            return jsonResponse({
                valid: false,
                paid: false,
                already_checked_in: false,
                error: 'Ticket not found',
                code: 'TICKET_NOT_FOUND'
            }, 200) // Return 200 maar met valid=false voor betere UX
        }

        logger.info('Ticket found', {
            id: ticket.id,
            status: ticket.status,
            order_status: ticket.order_status
        })

        // ===========================================================
        // 5. VALIDATE TICKET
        // ===========================================================
        const isValid = ticket.status === 'issued' || ticket.status === 'checked_in'
        const isPaid = ticket.order_status === 'paid'
        const alreadyCheckedIn = ticket.status === 'checked_in'

        // ===========================================================
        // 6. OPTIONAL: CHECK IN
        // ===========================================================
        let checkInResult = null

        if (check_in && isValid && isPaid && !alreadyCheckedIn) {
            logger.info('Performing check-in...')

            // Verify user is org member of this event
            const { data: event } = await supabaseAdmin
                .from('events')
                .select('org_id')
                .eq('id', ticket.event_id)
                .single()

            if (!event) {
                return errorResponse('Event not found', 'EVENT_NOT_FOUND', 404)
            }

            // Check org membership
            const { data: membership } = await supabaseAdmin
                .from('org_members')
                .select('role')
                .eq('org_id', event.org_id)
                .eq('user_id', user.id)
                .single()

            if (!membership) {
                return errorResponse(
                    'Forbidden',
                    'NOT_ORG_MEMBER',
                    403,
                    'Only org members can check in tickets'
                )
            }

            // Perform atomic check-in
            const { data: updatedTicket, error: updateError } = await supabaseAdmin
                .from('ticket_instances')
                .update({
                    status: 'checked_in',
                    checked_in_at: new Date().toISOString(),
                    checked_in_by: user.id
                })
                .eq('id', ticket.id)
                .eq('status', 'issued') // Only update if still 'issued' (prevent double check-in race)
                .select('id, status, checked_in_at')
                .single()

            if (updateError || !updatedTicket) {
                logger.error('Check-in failed', updateError)
                checkInResult = { success: false, error: 'Check-in failed' }
            } else {
                logger.info('Checked in successfully')
                checkInResult = { success: true, checked_in_at: updatedTicket.checked_in_at }
            }
        }

        // ===========================================================
        // 7. RETURN VALIDATION RESULT
        // ===========================================================
        return jsonResponse({
            valid: isValid,
            paid: isPaid,
            already_checked_in: alreadyCheckedIn,
            ticket: {
                id: ticket.id,
                qr_code: ticket.qr_code,
                status: ticket.status,
                ticket_type_name: ticket.ticket_type_name,
                ticket_type_price: ticket.ticket_type_price,
                event_name: ticket.event_name,
                order_email: ticket.order_email,
                checked_in_at: ticket.checked_in_at,
            },
            check_in_result: checkInResult,
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
