/**
 * check-in-ticket Edge Function
 *
 * Allows org members to check in tickets at an event.
 * Uses RPC for atomic check-in logic with audit logging.
 *
 * Flow:
 * 1. Authenticate user
 * 2. Parse raw ticket token and event ID
 * 3. Verify user is org member with correct role (owner/admin/support)
 * 4. Check ticket availability (Sprint 10 enforcement)
 * 5. Call RPC to perform check-in
 *
 * Security: Only org members with owner/admin/support roles can check-in
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { authenticateUser, isOrgMember } from '../_shared/auth.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

interface CheckInRequest {
    raw_token: string
    event_id: string
}

serve(async (req: Request) => {
    // Handle CORS preflight
    const corsResponse = handleCors(req)
    if (corsResponse) return corsResponse

    const logger = createLogger('check-in-ticket')
    logger.info('Function invoked')

    try {
        // 1. AUTHENTICATE
        const { user, client, error: authError } = await authenticateUser(req)
        if (authError) {
            return errorResponse('Unauthorized', authError, 401)
        }

        logger.info('User authenticated', user!.id)

        // 2. PARSE INPUT
        let body: Partial<CheckInRequest>
        try {
            body = await req.json()
        } catch {
            return errorResponse('Invalid JSON', 'INVALID_JSON', 400)
        }

        const { raw_token, event_id } = body

        if (!raw_token || !event_id) {
            return errorResponse('Missing raw_token or event_id', 'MISSING_FIELDS', 400)
        }

        // 3. AUTHORIZATION CHECK (Org Member & Role)
        const supabaseAdmin = getServiceClient()

        // Fetch Event -> Org
        const { data: eventData, error: eventError } = await supabaseAdmin
            .from('events')
            .select('org_id')
            .eq('id', event_id)
            .single()

        if (eventError || !eventData) {
            logger.error('Event not found', eventError)
            return errorResponse('Event not found', 'EVENT_NOT_FOUND', 404)
        }

        // Check membership with role
        const { data: membership } = await supabaseAdmin
            .from('org_members')
            .select('role')
            .eq('org_id', eventData.org_id)
            .eq('user_id', user!.id)
            .single()

        if (!membership) {
            logger.warn('User is not an org member')
            return errorResponse('Not an org member', 'FORBIDDEN', 403)
        }

        // Role Check: owner/admin/support ONLY
        const allowedRoles = ['owner', 'admin', 'support']
        if (!allowedRoles.includes(membership.role)) {
            logger.warn('Insufficient permissions', { role: membership.role })
            return errorResponse(
                'Insufficient permissions (finance cannot check-in)',
                'INSUFFICIENT_PERMISSIONS',
                403
            )
        }

        logger.info('Authorization check passed', { role: membership.role })

        // 4. ENFORCE TICKET DELIVERY (Sprint 10)
        // Check-in blocked if tickets are not yet available
        const { data: ticketsAvailable, error: availError } = await supabaseAdmin
            .rpc('are_tickets_available', { _event_id: event_id })

        if (availError) {
            logger.error('Availability check failed', availError)
            return errorResponse('Availability check failed', 'AVAILABILITY_CHECK_FAILED', 500)
        }

        if (!ticketsAvailable) {
            logger.warn('Tickets not yet available for check-in')
            return errorResponse(
                'Tickets not yet available for check-in',
                'TICKET_NOT_YET_AVAILABLE',
                403
            )
        }

        // 5. CALL RPC PERFORM_CHECKIN
        // Use client (user context) so auth.uid() works in RPC
        const { data: rpcData, error: rpcError } = await client!
            .rpc('perform_checkin', {
                ticket_raw_token: raw_token,
                event_id: event_id
            })

        if (rpcError) {
            logger.error('RPC failed', rpcError)
            return errorResponse('Check-in failed', 'CHECKIN_FAILED', 500, rpcError.message)
        }

        // 6. HANDLE RPC RESPONSE
        if (rpcData.error) {
            // Map RPC errors to HTTP status codes
            let status = 400
            if (rpcData.code === 'INVALID_TICKET') status = 404
            if (rpcData.code === 'UNAUTHORIZED') status = 401

            logger.warn('RPC returned error', rpcData)
            return jsonResponse(rpcData, status)
        }

        // Success (checked_in or already_checked_in)
        logger.info('Check-in successful', { code: rpcData.code })
        return jsonResponse(rpcData, 200)

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Unexpected error', message)
        return errorResponse('Internal server error', 'UNEXPECTED_ERROR', 500, message)
    }
})
