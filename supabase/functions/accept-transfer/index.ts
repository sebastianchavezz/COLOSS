/**
 * accept-transfer Edge Function
 *
 * Allows a ticket recipient to accept a pending transfer.
 * Uses a secure transfer token to verify the transfer request.
 *
 * Flow:
 * 1. Authenticate user
 * 2. Validate transfer token (SHA-256 hash)
 * 3. Check transfer status (pending) and expiry
 * 4. Resolve or create recipient participant
 * 5. Call RPC to atomically complete transfer
 *
 * Security: Token-based verification with expiry
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { authenticateUser } from '../_shared/auth.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

interface AcceptRequest {
    transfer_token: string
}

serve(async (req: Request) => {
    // Handle CORS preflight
    const corsResponse = handleCors(req)
    if (corsResponse) return corsResponse

    const logger = createLogger('accept-transfer')
    logger.info('Function invoked')

    try {
        // 1. AUTHENTICATE
        const { user, error: authError } = await authenticateUser(req)
        if (authError) {
            return errorResponse('Unauthorized', authError, 401)
        }

        logger.info('User authenticated', user!.id)

        // 2. PARSE & VALIDATE INPUT
        let body: Partial<AcceptRequest>
        try {
            body = await req.json()
        } catch {
            return errorResponse('Invalid JSON', 'INVALID_JSON', 400)
        }

        const { transfer_token } = body

        if (!transfer_token) {
            return errorResponse('Missing transfer_token', 'MISSING_TOKEN', 400)
        }

        // 3. HASH THE TOKEN (SHA-256)
        const tokenBytes = new TextEncoder().encode(transfer_token)
        const hashBuffer = await crypto.subtle.digest('SHA-256', tokenBytes)
        const tokenHash = Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')

        logger.info('Token hashed')

        // 4. FIND TRANSFER BY TOKEN HASH
        const supabaseAdmin = getServiceClient()

        const { data: transfer, error: transferError } = await supabaseAdmin
            .from('ticket_transfers')
            .select('id, ticket_instance_id, from_participant_id, to_participant_id, to_email, status, expires_at')
            .eq('transfer_token_hash', tokenHash)
            .single()

        if (transferError || !transfer) {
            logger.warn('Invalid transfer token')
            return errorResponse('Invalid transfer token', 'INVALID_TOKEN', 404)
        }

        logger.info('Transfer found', transfer.id)

        // 5. VALIDATE TRANSFER STATUS (Idempotency)
        if (transfer.status !== 'pending') {
            logger.warn('Transfer already processed', { status: transfer.status })
            return jsonResponse({
                error: 'Transfer already processed',
                status: transfer.status
            }, 409)
        }

        // 6. CHECK EXPIRY
        if (new Date(transfer.expires_at) < new Date()) {
            logger.warn('Transfer expired')

            await supabaseAdmin
                .from('ticket_transfers')
                .update({ status: 'expired' })
                .eq('id', transfer.id)

            return errorResponse('Transfer expired', 'TRANSFER_EXPIRED', 410)
        }

        // 7. RESOLVE TO_PARTICIPANT_ID
        let toParticipantId = transfer.to_participant_id

        if (!toParticipantId) {
            // Create participant for new user
            logger.info('Creating new participant for recipient')

            const { data: newParticipant, error: participantError } = await supabaseAdmin
                .from('participants')
                .insert({
                    user_id: user!.id,
                    email: transfer.to_email,
                    first_name: transfer.to_email.split('@')[0],
                    last_name: 'User'
                })
                .select('id')
                .single()

            if (participantError) {
                logger.error('Failed to create participant', participantError)
                return errorResponse('Failed to create participant', 'PARTICIPANT_CREATION_FAILED', 500)
            }

            toParticipantId = newParticipant.id
            logger.info('Participant created', toParticipantId)
        } else {
            // Verify user owns the to_participant
            const { data: toParticipant } = await supabaseAdmin
                .from('participants')
                .select('user_id')
                .eq('id', toParticipantId)
                .single()

            if (!toParticipant || toParticipant.user_id !== user!.id) {
                logger.warn('Recipient mismatch')
                return errorResponse('Recipient mismatch', 'RECIPIENT_MISMATCH', 403)
            }

            logger.info('Participant verified', toParticipantId)
        }

        // 8. CALL ATOMIC RPC (handles ownership transfer + status update)
        logger.info('Completing transfer via RPC')

        const { data: rpcResult, error: rpcError } = await supabaseAdmin
            .rpc('complete_ticket_transfer', {
                _transfer_id: transfer.id,
                _ticket_instance_id: transfer.ticket_instance_id,
                _to_participant_id: toParticipantId,
                _to_user_id: user!.id
            })

        if (rpcError) {
            logger.error('RPC failed', rpcError)
            return errorResponse('Transfer failed', 'TRANSFER_FAILED', 500, rpcError.message)
        }

        // RPC may return error via jsonb
        if (rpcResult && rpcResult.error) {
            logger.warn('RPC returned error', rpcResult.error)
            return jsonResponse(rpcResult, 409)
        }

        logger.info('Transfer completed successfully')

        return jsonResponse({
            success: true,
            transfer_id: transfer.id,
            ticket_instance_id: transfer.ticket_instance_id
        }, 200)

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Unexpected error', message)
        return errorResponse('Internal server error', 'UNEXPECTED_ERROR', 500, message)
    }
})
