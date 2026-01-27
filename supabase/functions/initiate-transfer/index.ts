/**
 * initiate-transfer Edge Function
 *
 * Allows a ticket owner to initiate a transfer to another user (by email).
 * Creates a pending transfer record that the recipient must accept.
 *
 * Flow:
 * 1. Authenticate user
 * 2. Validate ticket ownership
 * 3. Validate ticket can be transferred (status = valid)
 * 4. Create transfer record
 * 5. Send email notification to recipient (TODO)
 *
 * Security: Only ticket owner can initiate transfer
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { authenticateUser } from '../_shared/auth.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

interface InitiateTransferRequest {
    ticket_id: string
    to_email: string
}

serve(async (req: Request) => {
    // Handle CORS preflight
    const corsResponse = handleCors(req)
    if (corsResponse) return corsResponse

    const logger = createLogger('initiate-transfer')
    logger.info('Function invoked')

    try {
        // 1. AUTHENTICATE
        const { user, error: authError } = await authenticateUser(req)
        if (authError) {
            return errorResponse('Unauthorized', authError, 401)
        }

        logger.info('User authenticated', user!.id)

        // 2. PARSE INPUT
        let body: Partial<InitiateTransferRequest>
        try {
            body = await req.json()
        } catch {
            return errorResponse('Invalid JSON', 'INVALID_JSON', 400)
        }

        const { ticket_id, to_email } = body

        if (!ticket_id || !to_email) {
            return errorResponse('Missing ticket_id or to_email', 'MISSING_FIELDS', 400)
        }

        // 3. VALIDATE TICKET OWNERSHIP
        const supabaseAdmin = getServiceClient()

        const { data: ticket, error: ticketError } = await supabaseAdmin
            .from('tickets')
            .select(`
                id,
                barcode,
                status,
                ticket_type_id,
                registration_id,
                registrations!inner(
                    participant_id,
                    participants!inner(
                        user_id,
                        email
                    )
                )
            `)
            .eq('id', ticket_id)
            .single()

        if (ticketError || !ticket) {
            logger.error('Ticket not found', ticketError)
            return errorResponse('Ticket not found', 'TICKET_NOT_FOUND', 404)
        }

        // Check ownership
        const ownerUserId = (ticket.registrations as any).participants.user_id
        if (ownerUserId !== user!.id) {
            logger.warn('User does not own ticket', { userId: user!.id, ownerId: ownerUserId })
            return errorResponse('You do not own this ticket', 'FORBIDDEN', 403)
        }

        // Check if ticket can be transferred
        if (ticket.status !== 'valid') {
            return errorResponse(
                'Only valid tickets can be transferred',
                'INVALID_TICKET_STATUS',
                400
            )
        }

        logger.info('Ticket validated', { ticketId: ticket.id, status: ticket.status })

        // 4. GET EVENT AND ORG INFO
        const { data: ticketType } = await supabaseAdmin
            .from('ticket_types')
            .select('event_id, events!inner(org_id)')
            .eq('id', ticket.ticket_type_id)
            .single()

        if (!ticketType) {
            logger.error('Ticket type not found')
            return errorResponse('Ticket type not found', 'TICKET_TYPE_NOT_FOUND', 404)
        }

        const eventId = ticketType.event_id
        const orgId = (ticketType.events as any).org_id

        // 5. CREATE TRANSFER RECORD
        const { data: transfer, error: transferError } = await supabaseAdmin
            .from('ticket_transfers')
            .insert({
                org_id: orgId,
                event_id: eventId,
                ticket_id: ticket_id,
                from_user_id: user!.id,
                to_email: to_email.toLowerCase().trim(),
                status: 'pending',
                initiated_by_user_id: user!.id
            })
            .select()
            .single()

        if (transferError) {
            logger.error('Transfer creation failed', transferError)
            return errorResponse(transferError.message, 'TRANSFER_CREATION_FAILED', 500)
        }

        logger.info('Transfer created', transfer.id)

        // TODO: Send email notification to recipient

        return jsonResponse({
            success: true,
            transfer_id: transfer.id,
            message: `Transfer request sent to ${to_email}`
        }, 200)

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Unexpected error', message)
        return errorResponse('Internal server error', 'UNEXPECTED_ERROR', 500, message)
    }
})
