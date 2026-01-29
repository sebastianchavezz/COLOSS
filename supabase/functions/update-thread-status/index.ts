/**
 * update-thread-status Edge Function
 *
 * Allows an organizer to change the status of a chat thread (open <-> closed).
 * Only users with owner/admin/support role on the thread's org may update.
 * The audit_chat_thread_status trigger fires automatically on status change.
 *
 * Flow:
 * 1. Authenticate user (required)
 * 2. Parse body: { thread_id, status }
 * 3. Validate status value
 * 4. Fetch thread and verify it exists
 * 5. Verify user is an organizer for the thread's org
 * 6. Update thread status and updated_at
 * 7. Return updated thread metadata
 *
 * Security: JWT required. Organizer-only access (owner/admin/support).
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { authenticateUser } from '../_shared/auth.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

// Valid thread status transitions
const VALID_STATUSES = ['open', 'closed']

// Organizer roles that can update thread status
const ORGANIZER_ROLES = ['owner', 'admin', 'support']

interface UpdateThreadStatusRequest {
    thread_id: string
    status: string
}

serve(async (req: Request) => {
    // Handle CORS preflight
    const corsResponse = handleCors(req)
    if (corsResponse) return corsResponse

    const logger = createLogger('update-thread-status')
    logger.info('Function invoked')

    try {
        // ===========================================================
        // 1. AUTHENTICATE USER
        // ===========================================================
        const { user, error: authError } = await authenticateUser(req)
        if (authError || !user) {
            return errorResponse('Unauthorized', authError || 'NO_USER', 401)
        }

        logger.info('User authenticated', { userId: user.id })

        // ===========================================================
        // 2. PARSE BODY
        // ===========================================================
        let body: Partial<UpdateThreadStatusRequest>
        try {
            body = await req.json()
        } catch {
            return errorResponse('Invalid JSON body', 'INVALID_JSON', 400)
        }

        const { thread_id, status } = body

        if (!thread_id) {
            return errorResponse('Missing thread_id', 'MISSING_THREAD_ID', 400)
        }

        if (!status) {
            return errorResponse('Missing status', 'MISSING_STATUS', 400)
        }

        // ===========================================================
        // 3. VALIDATE STATUS VALUE
        // ===========================================================
        if (!VALID_STATUSES.includes(status)) {
            return errorResponse(
                `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
                'INVALID_STATUS',
                400
            )
        }

        logger.info('Input validated', { threadId: thread_id, newStatus: status })

        // ===========================================================
        // 4. FETCH THREAD
        // ===========================================================
        const supabaseAdmin = getServiceClient()

        const { data: thread, error: threadError } = await supabaseAdmin
            .from('chat_threads')
            .select('id, org_id, status')
            .eq('id', thread_id)
            .single()

        if (threadError || !thread) {
            logger.warn('Thread not found', { threadId: thread_id })
            return errorResponse('Thread not found', 'NOT_FOUND', 404)
        }

        logger.info('Thread fetched', { threadId: thread.id, currentStatus: thread.status, orgId: thread.org_id })

        // ===========================================================
        // 5. VERIFY ORGANIZER ACCESS
        // ===========================================================
        const { data: membership } = await supabaseAdmin
            .from('org_members')
            .select('role')
            .eq('org_id', thread.org_id)
            .eq('user_id', user.id)
            .single()

        if (!membership || !ORGANIZER_ROLES.includes(membership.role)) {
            logger.warn('Organizer access denied', { userId: user.id, orgId: thread.org_id })
            return errorResponse(
                'Only organizers (owner/admin/support) can update thread status',
                'FORBIDDEN',
                403
            )
        }

        logger.info('Organizer access verified', { role: membership.role })

        // ===========================================================
        // 6. UPDATE THREAD STATUS
        //    The audit_chat_thread_status trigger fires automatically
        // ===========================================================
        const { data: updated, error: updateError } = await supabaseAdmin
            .from('chat_threads')
            .update({
                status: status,
                updated_at: new Date().toISOString(),
            })
            .eq('id', thread_id)
            .select('id, status, updated_at')
            .single()

        if (updateError || !updated) {
            logger.error('Failed to update thread status', updateError)
            return errorResponse('Failed to update thread', 'UPDATE_ERROR', 500)
        }

        logger.info('Thread status updated', { threadId: updated.id, newStatus: updated.status })

        // ===========================================================
        // 7. RETURN RESPONSE
        // ===========================================================
        return jsonResponse({
            thread_id: updated.id,
            new_status: updated.status,
            updated_at: updated.updated_at,
        })

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Unexpected error', message)
        const isDev = Deno.env.get('ENVIRONMENT') !== 'production'
        return errorResponse('Internal server error', 'UNEXPECTED_ERROR', 500, isDev ? message : undefined)
    }
})
