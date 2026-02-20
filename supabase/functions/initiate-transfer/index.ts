/**
 * initiate-transfer Edge Function (V2 - Rewritten for ticket_instances schema)
 *
 * Allows a ticket owner to initiate a transfer to another user (by email).
 * Creates a pending transfer record that the recipient must accept.
 *
 * Flow:
 * 1. Authenticate user
 * 2. Validate ticket_instance ownership (owner_user_id)
 * 3. Validate ticket can be transferred (status = 'issued')
 * 4. Find from_participant_id for the user
 * 5. Generate transfer token + SHA-256 hash
 * 6. Create transfer record with all required fields
 * 7. Send email notifications (non-fatal)
 *
 * Security:
 * - Only ticket owner can initiate transfer
 * - Transfer token is one-time use (stored as SHA-256 hash)
 * - Unique partial index prevents duplicate pending transfers per ticket
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { authenticateUser } from '../_shared/auth.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

interface InitiateTransferRequest {
    ticket_instance_id: string
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

        const { ticket_instance_id, to_email } = body

        if (!ticket_instance_id || !to_email) {
            return errorResponse('Missing ticket_instance_id or to_email', 'MISSING_FIELDS', 400)
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(to_email)) {
            return errorResponse('Invalid email address', 'INVALID_EMAIL', 400)
        }

        const supabaseAdmin = getServiceClient()

        // 3. VALIDATE TICKET INSTANCE OWNERSHIP
        const { data: ticket, error: ticketError } = await supabaseAdmin
            .from('ticket_instances')
            .select('id, event_id, ticket_type_id, order_id, owner_user_id, status')
            .eq('id', ticket_instance_id)
            .single()

        if (ticketError || !ticket) {
            logger.error('Ticket instance not found', ticketError)
            return errorResponse('Ticket not found', 'TICKET_NOT_FOUND', 404)
        }

        // Check ownership
        if (ticket.owner_user_id !== user!.id) {
            logger.warn('User does not own ticket', { userId: user!.id, ownerId: ticket.owner_user_id })
            return errorResponse('You do not own this ticket', 'FORBIDDEN', 403)
        }

        // Check if ticket can be transferred (must be 'issued')
        if (ticket.status !== 'issued') {
            return errorResponse(
                `Only issued tickets can be transferred. Current status: ${ticket.status}`,
                'INVALID_TICKET_STATUS',
                400
            )
        }

        // Check no duplicate pending transfer exists
        const { data: existingTransfer } = await supabaseAdmin
            .from('ticket_transfers')
            .select('id')
            .eq('ticket_id', ticket_instance_id)
            .eq('status', 'pending')
            .maybeSingle()

        if (existingTransfer) {
            return errorResponse(
                'A pending transfer already exists for this ticket',
                'TRANSFER_ALREADY_PENDING',
                409
            )
        }

        logger.info('Ticket validated', { ticketId: ticket.id, status: ticket.status })

        // 4. GET EVENT AND ORG INFO
        const { data: event } = await supabaseAdmin
            .from('events')
            .select('id, org_id')
            .eq('id', ticket.event_id)
            .single()

        if (!event) {
            logger.error('Event not found')
            return errorResponse('Event not found', 'EVENT_NOT_FOUND', 404)
        }

        // 5. FIND FROM_PARTICIPANT_ID
        // The user initiating transfer must have a participant record
        const { data: fromParticipant } = await supabaseAdmin
            .from('participants')
            .select('id')
            .eq('user_id', user!.id)
            .limit(1)
            .maybeSingle()

        if (!fromParticipant) {
            logger.error('No participant record for user')
            return errorResponse('No participant profile found', 'PARTICIPANT_NOT_FOUND', 400)
        }

        // 6. GENERATE TRANSFER TOKEN + HASH
        const transferToken = crypto.randomUUID()
        const tokenBytes = new TextEncoder().encode(transferToken)
        const hashBuffer = await crypto.subtle.digest('SHA-256', tokenBytes)
        const transferTokenHash = Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')

        // Expiry: 72 hours from now
        const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString()

        // 7. CREATE TRANSFER RECORD
        const { data: transfer, error: transferError } = await supabaseAdmin
            .from('ticket_transfers')
            .insert({
                ticket_instance_id: ticket_instance_id,
                from_participant_id: fromParticipant.id,
                to_email: to_email.toLowerCase().trim(),
                transfer_token_hash: transferTokenHash,
                status: 'pending',
                expires_at: expiresAt,
                org_id: event.org_id,
                event_id: event.id
            })
            .select('id')
            .single()

        if (transferError) {
            logger.error('Transfer creation failed', transferError)

            // Handle unique constraint violation (duplicate pending transfer)
            if (transferError.code === '23505') {
                return errorResponse(
                    'A pending transfer already exists for this ticket',
                    'TRANSFER_ALREADY_PENDING',
                    409
                )
            }

            return errorResponse(transferError.message, 'TRANSFER_CREATION_FAILED', 500)
        }

        logger.info('Transfer created', transfer.id)

        // 8. SEND EMAIL NOTIFICATIONS (non-fatal)
        let recipientEmailQueued = false
        let senderEmailQueued = false

        try {
            const { data: notifyResult } = await supabaseAdmin.rpc(
                'queue_transfer_notification_email',
                { _transfer_id: transfer.id }
            )
            recipientEmailQueued = !!notifyResult
            logger.info('Recipient notification queued', { emailId: notifyResult })
        } catch (emailError) {
            logger.warn('Failed to queue recipient notification', emailError)
        }

        try {
            const { data: initiatedResult } = await supabaseAdmin.rpc(
                'queue_transfer_initiated_email',
                { _transfer_id: transfer.id }
            )
            senderEmailQueued = !!initiatedResult
            logger.info('Sender confirmation queued', { emailId: initiatedResult })
        } catch (emailError) {
            logger.warn('Failed to queue sender confirmation', emailError)
        }

        // NB: transfer_token wordt NIET in de response teruggegeven.
        // Het token reist alleen via email naar de ontvanger.
        // Dit voorkomt dat de afzender zijn eigen transfer kan accepteren.
        return jsonResponse({
            success: true,
            transfer_id: transfer.id,
            expires_at: expiresAt,
            message: `Transfer request sent to ${to_email}`,
            emails: {
                recipient_notified: recipientEmailQueued,
                sender_confirmed: senderEmailQueued
            }
        }, 200)

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Unexpected error', message)
        return errorResponse('Internal server error', 'UNEXPECTED_ERROR', 500, message)
    }
})
