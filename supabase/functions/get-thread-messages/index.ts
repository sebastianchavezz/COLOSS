/**
 * get-thread-messages Edge Function
 *
 * Retrieves paginated messages for a chat thread.
 * Access is restricted to the thread's participant OR an organizer (owner/admin/support).
 *
 * Flow:
 * 1. Authenticate user (required)
 * 2. Parse query params: thread_id, limit, offset
 * 3. Fetch thread and verify it exists
 * 4. Determine access (participant or organizer)
 * 5. Query messages with pagination
 * 6. Mark thread as read if viewer is an organizer
 * 7. Return messages with thread metadata and pagination info
 *
 * Security: JWT required. Participant-only or organizer-only access per thread.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { authenticateUser } from '../_shared/auth.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

// Pagination bounds
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const DEFAULT_OFFSET = 0

// Organizer roles that grant thread access
const ORGANIZER_ROLES = ['owner', 'admin', 'support']

serve(async (req: Request) => {
    // Handle CORS preflight
    const corsResponse = handleCors(req)
    if (corsResponse) return corsResponse

    const logger = createLogger('get-thread-messages')
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
        // 2. PARSE QUERY PARAMS
        // ===========================================================
        const url = new URL(req.url)
        const threadId = url.searchParams.get('thread_id')

        if (!threadId) {
            return errorResponse('Missing thread_id query parameter', 'MISSING_THREAD_ID', 400)
        }

        // Parse and clamp limit
        const rawLimit = parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10)
        const limit = isNaN(rawLimit) ? DEFAULT_LIMIT : Math.min(Math.max(rawLimit, 1), MAX_LIMIT)

        // Parse offset (non-negative integer)
        const rawOffset = parseInt(url.searchParams.get('offset') || String(DEFAULT_OFFSET), 10)
        const offset = isNaN(rawOffset) || rawOffset < 0 ? DEFAULT_OFFSET : rawOffset

        logger.info('Params parsed', { threadId, limit, offset })

        // ===========================================================
        // 3. GET SERVICE CLIENT & FETCH THREAD
        // ===========================================================
        const supabaseAdmin = getServiceClient()

        const { data: thread, error: threadError } = await supabaseAdmin
            .from('chat_threads')
            .select('id, org_id, event_id, participant_id, status')
            .eq('id', threadId)
            .single()

        if (threadError || !thread) {
            logger.warn('Thread not found', { threadId })
            return errorResponse('Thread not found', 'NOT_FOUND', 404)
        }

        logger.info('Thread fetched', { threadId: thread.id, orgId: thread.org_id })

        // ===========================================================
        // 4. DETERMINE ACCESS
        //    - Is user the owning participant?
        //    - OR is user an organizer for this org?
        // ===========================================================
        let isOrganizer = false

        // Check participant ownership
        const { data: participant } = await supabaseAdmin
            .from('participants')
            .select('id, user_id')
            .eq('id', thread.participant_id)
            .eq('user_id', user.id)
            .single()

        if (!participant) {
            // Not the participant — check organizer access
            const { data: membership } = await supabaseAdmin
                .from('org_members')
                .select('role')
                .eq('org_id', thread.org_id)
                .eq('user_id', user.id)
                .single()

            if (!membership || !ORGANIZER_ROLES.includes(membership.role)) {
                logger.warn('Access denied', { userId: user.id, threadId: thread.id })
                return errorResponse(
                    'You do not have access to this thread',
                    'FORBIDDEN',
                    403
                )
            }

            isOrganizer = true
            logger.info('Access granted as organizer', { role: membership.role })
        } else {
            logger.info('Access granted as participant', { participantId: participant.id })
        }

        // ===========================================================
        // 5. QUERY MESSAGES (paginated, ascending by created_at)
        // ===========================================================
        const { data: messages, error: messagesError } = await supabaseAdmin
            .from('chat_messages')
            .select('id, thread_id, sender_type, sender_user_id, content, is_flagged, created_at')
            .eq('thread_id', threadId)
            .order('created_at', { ascending: true })
            .limit(limit)
            .range(offset, offset + limit - 1)

        if (messagesError) {
            logger.error('Failed to fetch messages', messagesError)
            return errorResponse('Failed to fetch messages', 'QUERY_ERROR', 500)
        }

        // ===========================================================
        // 6. COUNT TOTAL MESSAGES IN THREAD
        // ===========================================================
        const { data: countResult, error: countError } = await supabaseAdmin
            .from('chat_messages')
            .select('count')
            .eq('thread_id', threadId)
            .single()

        if (countError) {
            logger.error('Failed to count messages', countError)
            return errorResponse('Failed to count messages', 'QUERY_ERROR', 500)
        }

        // Supabase count returns as { count: number } when using .select('count')
        const totalMessages = (countResult as { count: number })?.count ?? 0

        // ===========================================================
        // 7. MARK THREAD AS READ (organizer only)
        //    Uses RPC to handle the upsert on chat_thread_reads atomically
        // ===========================================================
        if (isOrganizer) {
            const { error: markReadError } = await supabaseAdmin.rpc(
                'mark_chat_thread_read',
                { thread_id: threadId, reader_user_id: user.id }
            )

            if (markReadError) {
                // Non-fatal: log but do not fail the request
                logger.warn('Failed to mark thread as read', markReadError)
            } else {
                logger.info('Thread marked as read', { threadId, userId: user.id })
            }
        }

        // ===========================================================
        // 8. RETURN RESPONSE
        // ===========================================================
        return jsonResponse({
            messages: messages || [],
            thread: {
                id: thread.id,
                status: thread.status,
                participant_id: thread.participant_id,
            },
            total_messages: totalMessages,
            limit,
            offset,
        })

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Unexpected error', message)
        const isDev = Deno.env.get('ENVIRONMENT') !== 'production'
        return errorResponse('Internal server error', 'UNEXPECTED_ERROR', 500, isDev ? message : undefined)
    }
})
