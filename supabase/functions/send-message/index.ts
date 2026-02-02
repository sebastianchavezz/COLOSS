/**
 * send-message Edge Function
 *
 * Allows authenticated users to send messages within a chat thread.
 * ANY logged-in user can start a chat (pre-purchase questions allowed).
 * Organizers must reply to existing threads (thread_id required).
 *
 * Flow:
 * 1. Authenticate user (guests cannot message)
 * 2. Parse body: { thread_id?, event_id, content }
 * 3. Determine role: participant vs organizer
 * 4. If PARTICIPANT (or new user):
 *    a. Auto-create participant record if needed
 *    b. Get or create thread (tracks participant_has_access for organizer UI)
 *    c. Enforce content length and rate limits from messaging settings
 *    d. Verify thread is not closed
 *    e. Insert message (sender_type = 'participant')
 *    f. Flag content if it matches profanity placeholder
 * 5. If ORGANIZER:
 *    a. Require thread_id (organizers reply, they do not create)
 *    b. Verify thread belongs to their org
 *    c. Enforce content length from messaging settings
 *    d. Insert message (sender_type = 'organizer')
 * 6. Return { message_id, thread_id, created_at }
 *
 * Side Effects:
 *    - on_chat_message_inserted trigger auto-updates thread counters and status
 *
 * Security:
 *    - Uses SERVICE_ROLE for all DB operations (server-side trust boundary)
 *    - Rate limiting enforced for participants only
 *    - Profanity placeholder flags content for moderation review
 *
 * NOTE: S3 Upgrade - Open Chat Access
 *    - Removed ticket/registration requirement for chat
 *    - Any logged-in user can start a conversation
 *    - participant_has_access tracked for organizer context badge
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { authenticateUser } from '../_shared/auth.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

// Types for the request payload
interface SendMessageRequest {
    thread_id?: string
    event_id: string
    content: string
}

// Placeholder profanity word list for content flagging (moderation stub)
// In production this would be replaced with a proper content moderation service.
const FLAGGED_WORDS = [
    'spam', 'scam', 'hack', 'exploit'
]

/**
 * Check if content contains flagged words (case-insensitive placeholder).
 * Returns true if any flagged word is found as a whole word.
 */
function shouldFlagContent(content: string): boolean {
    const lowerContent = content.toLowerCase()
    return FLAGGED_WORDS.some((word) => {
        // Match as whole word with word boundary regex
        const pattern = new RegExp(`\\b${word}\\b`)
        return pattern.test(lowerContent)
    })
}

serve(async (req: Request) => {
    // Handle CORS preflight
    const corsResponse = handleCors(req)
    if (corsResponse) return corsResponse

    const logger = createLogger('send-message')
    logger.info('Function invoked')

    try {
        // Only POST allowed
        if (req.method !== 'POST') {
            return errorResponse('Method not allowed', 'METHOD_NOT_ALLOWED', 405)
        }

        // =================================================================
        // 1. AUTHENTICATE USER (required — guests cannot message)
        // =================================================================
        const { user, error: authError } = await authenticateUser(req)
        if (authError || !user) {
            logger.error('Authentication failed', { error: authError })
            return errorResponse('Unauthorized', authError || 'NO_USER', 401, { debug: authError })
        }

        logger.info('User authenticated', { userId: user.id })

        // =================================================================
        // 2. PARSE & VALIDATE INPUT
        // =================================================================
        let body: Partial<SendMessageRequest>
        try {
            body = await req.json()
        } catch {
            return errorResponse('Invalid JSON', 'INVALID_JSON', 400)
        }

        const { thread_id, event_id, content } = body

        // Content is always required and must not be empty/whitespace
        if (!content || content.trim().length === 0) {
            return errorResponse('Content is required and must not be empty', 'MISSING_CONTENT', 400)
        }

        logger.info('Input parsed', { hasThreadId: !!thread_id, hasEventId: !!event_id, contentLength: content.length })

        // =================================================================
        // 3. SETUP SERVICE CLIENT & DETERMINE ROLE
        // =================================================================
        const supabaseAdmin = getServiceClient()

        // Query participants to see if this user is a participant
        const { data: participant, error: participantError } = await supabaseAdmin
            .from('participants')
            .select('id, user_id, email, first_name, last_name')
            .eq('user_id', user.id)
            .single()

        if (participantError) {
            logger.debug('Participant lookup returned error (may not exist)', { error: participantError.message })
        }

        const isParticipant = !!participant

        // Check organizer role regardless of participant status.
        // A user can be BOTH participant and organizer (e.g. event creator who also registered).
        // Role resolution rules:
        //   - If user has thread_id AND is an organizer -> treat as organizer (reply to thread)
        //   - Otherwise if user is participant -> treat as participant (own thread)
        //   - Otherwise if user is organizer only -> treat as organizer
        let isOrganizer = false

        // We need an event_id or thread_id to resolve the org
        if (thread_id) {
            const { data: thread } = await supabaseAdmin
                .from('chat_threads')
                .select('org_id')
                .eq('id', thread_id)
                .single()

            if (thread) {
                const { data: orgMembership } = await supabaseAdmin
                    .from('org_members')
                    .select('role')
                    .eq('org_id', thread.org_id)
                    .eq('user_id', user.id)
                    .single()

                if (orgMembership && ['owner', 'admin', 'support'].includes(orgMembership.role)) {
                    isOrganizer = true
                }
            }
        } else if (event_id) {
            // Try resolving org from event_id
            const { data: event } = await supabaseAdmin
                .from('events')
                .select('org_id')
                .eq('id', event_id)
                .single()

            if (event) {
                const { data: orgMembership } = await supabaseAdmin
                    .from('org_members')
                    .select('role')
                    .eq('org_id', event.org_id)
                    .eq('user_id', user.id)
                    .single()

                if (orgMembership && ['owner', 'admin', 'support'].includes(orgMembership.role)) {
                    isOrganizer = true
                }
            }
        }

        // S3 UPGRADE: Auto-create participant if user is not participant and not organizer
        // This allows ANY logged-in user to start a chat (pre-purchase questions)
        let actualParticipant = participant
        let actualIsParticipant = isParticipant

        if (!isParticipant && !isOrganizer) {
            logger.info('User has no participant record, auto-creating', { userId: user.id })

            // Use RPC to get or create participant
            const { data: newParticipantId, error: createError } = await supabaseAdmin
                .rpc('get_or_create_participant_for_user', { _user_id: user.id })

            if (createError || !newParticipantId) {
                logger.error('Failed to auto-create participant', { error: createError?.message })
                return errorResponse('Failed to create participant record', 'PARTICIPANT_CREATE_ERROR', 500, createError?.message)
            }

            // Fetch the new participant record
            const { data: newParticipant } = await supabaseAdmin
                .from('participants')
                .select('id, user_id, email, first_name, last_name')
                .eq('id', newParticipantId)
                .single()

            if (newParticipant) {
                actualParticipant = newParticipant
                actualIsParticipant = true
                logger.info('Participant auto-created', { participantId: newParticipantId })
            } else {
                logger.error('Failed to fetch newly created participant')
                return errorResponse('Failed to fetch participant record', 'PARTICIPANT_FETCH_ERROR', 500)
            }
        }

        // Dual-role resolution:
        // If user is BOTH participant and organizer:
        //   - thread_id provided -> organizer path (replying to a specific thread)
        //   - no thread_id       -> participant path (continuing own thread)
        const effectiveIsParticipant = actualIsParticipant && !(isOrganizer && thread_id)
        const effectiveIsOrganizer = isOrganizer && (!actualIsParticipant || !!thread_id)

        logger.info('Role determined', { isParticipant: actualIsParticipant, isOrganizer, effectiveIsParticipant, effectiveIsOrganizer })

        // =================================================================
        // 4. PARTICIPANT FLOW
        // =================================================================
        if (effectiveIsParticipant) {
            // event_id is required for participant messaging
            if (!event_id) {
                return errorResponse('event_id is required for participant messages', 'MISSING_EVENT_ID', 400)
            }

            const participantId = actualParticipant!.id

            // 4a. Check participant event access (for tracking, NOT blocking)
            // S3 UPGRADE: We no longer block users without tickets - just track for organizer UI
            const { data: hasAccess } = await supabaseAdmin
                .rpc('check_participant_event_access', {
                    _event_id: event_id,
                    _participant_id: participantId
                })

            const participantHasAccess = !!hasAccess
            logger.info('Participant access status', { participantId, eventId: event_id, hasAccess: participantHasAccess })

            // 4b. Get or create thread
            const { data: resolvedThreadId, error: threadError } = await supabaseAdmin
                .rpc('get_or_create_chat_thread', {
                    _event_id: event_id,
                    _participant_id: participantId
                })

            if (threadError || !resolvedThreadId) {
                logger.error('Get or create thread RPC failed', { error: threadError?.message })
                return errorResponse('Failed to resolve chat thread', 'THREAD_RESOLVE_ERROR', 500, threadError?.message)
            }

            const activeThreadId = resolvedThreadId as string
            logger.info('Thread resolved', { threadId: activeThreadId })

            // 4c. Update thread with participant access status (for organizer UI badge)
            const { error: updateAccessError } = await supabaseAdmin
                .from('chat_threads')
                .update({ participant_has_access: participantHasAccess })
                .eq('id', activeThreadId)

            if (updateAccessError) {
                logger.warn('Failed to update participant_has_access', { error: updateAccessError.message })
            }

            // 4d. Get messaging settings for this event
            const { data: settings, error: settingsError } = await supabaseAdmin
                .rpc('get_messaging_settings', { _event_id: event_id })

            if (settingsError || !settings) {
                logger.error('Failed to get messaging settings', { error: settingsError?.message })
                return errorResponse('Failed to retrieve messaging settings', 'SETTINGS_ERROR', 500, settingsError?.message)
            }

            const maxMessageLength: number = settings.max_message_length || 2000
            const msgsPerMinute: number = settings.rate_limit?.msgs_per_minute || 5

            // 4d. Content length check
            if (content.length > maxMessageLength) {
                logger.warn('Content exceeds max length', { length: content.length, max: maxMessageLength })
                return errorResponse(
                    `Message too long. Maximum ${maxMessageLength} characters allowed.`,
                    'CONTENT_TOO_LONG',
                    400,
                    { current_length: content.length, max_length: maxMessageLength }
                )
            }

            // 4e. Rate limit check
            const { data: recentCount, error: rateError } = await supabaseAdmin
                .rpc('count_recent_participant_messages', {
                    _thread_id: activeThreadId,
                    _sender_user_id: user.id,
                    _window_seconds: 60
                })

            if (rateError) {
                logger.error('Rate limit check RPC failed', { error: rateError.message })
                return errorResponse('Rate limit check failed', 'RATE_CHECK_ERROR', 500, rateError.message)
            }

            if ((recentCount as number) >= msgsPerMinute) {
                logger.warn('Participant rate limited', { userId: user.id, recentCount, limit: msgsPerMinute })
                return errorResponse(
                    `Rate limited: maximum ${msgsPerMinute} messages per minute`,
                    'RATE_LIMITED',
                    429,
                    { recent_count: recentCount, limit: msgsPerMinute }
                )
            }

            // 4f. Verify thread is not closed
            const { data: threadRecord, error: threadCheckError } = await supabaseAdmin
                .from('chat_threads')
                .select('id, status, org_id')
                .eq('id', activeThreadId)
                .single()

            if (threadCheckError || !threadRecord) {
                logger.error('Thread lookup failed', { threadId: activeThreadId, error: threadCheckError?.message })
                return errorResponse('Thread not found', 'THREAD_NOT_FOUND', 404)
            }

            if (threadRecord.status === 'closed') {
                logger.warn('Participant attempted to message in closed thread', { threadId: activeThreadId })
                return errorResponse(
                    'This thread has been closed by the organizer',
                    'THREAD_CLOSED',
                    403
                )
            }

            // 4g. Check content for profanity (placeholder stub)
            const isContentFlagged = shouldFlagContent(content)
            if (isContentFlagged) {
                logger.info('Content flagged by profanity placeholder', { threadId: activeThreadId })
            }

            // 4h. Insert message
            const { data: message, error: insertError } = await supabaseAdmin
                .from('chat_messages')
                .insert({
                    thread_id: activeThreadId,
                    org_id: threadRecord.org_id,
                    sender_type: 'participant',
                    sender_user_id: user.id,
                    content: content,
                    is_flagged: isContentFlagged
                })
                .select('id, thread_id, created_at, is_flagged')
                .single()

            if (insertError || !message) {
                logger.error('Failed to insert message', { error: insertError?.message })
                return errorResponse('Failed to send message', 'MESSAGE_INSERT_ERROR', 500, insertError?.message)
            }

            logger.info('Message sent by participant', { messageId: message.id, threadId: activeThreadId })

            // Audit log (non-fatal)
            const { error: auditError1 } = await supabaseAdmin
                .from('audit_log')
                .insert({
                    org_id: threadRecord.org_id,
                    actor_user_id: user.id,
                    action: 'CHAT_MESSAGE_SENT',
                    entity_type: 'chat_message',
                    entity_id: message.id,
                    after_state: {
                        thread_id: activeThreadId,
                        sender_type: 'participant',
                        is_flagged: isContentFlagged,
                        content_length: content.length
                    },
                    metadata: { event_id, source: 'send-message' }
                })
            if (auditError1) logger.warn('Audit log insert failed (non-fatal)')

            return jsonResponse({
                success: true,
                message_id: message.id,
                thread_id: message.thread_id,
                created_at: message.created_at,
                is_flagged: message.is_flagged
            }, 200)
        }

        // =================================================================
        // 5. ORGANIZER FLOW
        // =================================================================
        if (effectiveIsOrganizer) {
            // thread_id is required for organizers (they reply to existing threads)
            if (!thread_id) {
                return errorResponse(
                    'thread_id is required for organizer messages',
                    'MISSING_THREAD_ID',
                    400
                )
            }

            // 5a. Verify thread exists and belongs to organizer's org
            const { data: threadRecord, error: threadError } = await supabaseAdmin
                .from('chat_threads')
                .select('id, org_id, event_id, status')
                .eq('id', thread_id)
                .single()

            if (threadError || !threadRecord) {
                logger.error('Thread not found for organizer', { threadId: thread_id })
                return errorResponse('Thread not found', 'THREAD_NOT_FOUND', 404)
            }

            // Verify organizer membership on the thread's org
            const { data: orgMembership } = await supabaseAdmin
                .from('org_members')
                .select('role')
                .eq('org_id', threadRecord.org_id)
                .eq('user_id', user.id)
                .single()

            if (!orgMembership || !['owner', 'admin', 'support'].includes(orgMembership.role)) {
                logger.warn('Organizer not authorized for this thread org', { userId: user.id, orgId: threadRecord.org_id })
                return errorResponse('Not authorized for this thread', 'FORBIDDEN', 403)
            }

            // 5b. Get messaging settings to enforce content length
            const { data: settings, error: settingsError } = await supabaseAdmin
                .rpc('get_messaging_settings', { _event_id: threadRecord.event_id })

            if (settingsError || !settings) {
                logger.error('Failed to get messaging settings', { error: settingsError?.message })
                return errorResponse('Failed to retrieve messaging settings', 'SETTINGS_ERROR', 500, settingsError?.message)
            }

            const maxMessageLength: number = settings.max_message_length || 2000

            // 5c. Content length check
            if (content.length > maxMessageLength) {
                logger.warn('Organizer content exceeds max length', { length: content.length, max: maxMessageLength })
                return errorResponse(
                    `Message too long. Maximum ${maxMessageLength} characters allowed.`,
                    'CONTENT_TOO_LONG',
                    400,
                    { current_length: content.length, max_length: maxMessageLength }
                )
            }

            // 5d. Insert message
            const { data: message, error: insertError } = await supabaseAdmin
                .from('chat_messages')
                .insert({
                    thread_id: thread_id,
                    org_id: threadRecord.org_id,
                    sender_type: 'organizer',
                    sender_user_id: user.id,
                    content: content,
                    is_flagged: false  // Organizer messages are not auto-flagged
                })
                .select('id, thread_id, created_at')
                .single()

            if (insertError || !message) {
                logger.error('Failed to insert organizer message', { error: insertError?.message })
                return errorResponse('Failed to send message', 'MESSAGE_INSERT_ERROR', 500, insertError?.message)
            }

            logger.info('Message sent by organizer', { messageId: message.id, threadId: thread_id })

            // Audit log (non-fatal)
            const { error: auditError2 } = await supabaseAdmin
                .from('audit_log')
                .insert({
                    org_id: threadRecord.org_id,
                    actor_user_id: user.id,
                    action: 'CHAT_MESSAGE_SENT',
                    entity_type: 'chat_message',
                    entity_id: message.id,
                    after_state: {
                        thread_id: thread_id,
                        sender_type: 'organizer',
                        content_length: content.length
                    },
                    metadata: { event_id: threadRecord.event_id, source: 'send-message' }
                })

            if (auditError2) {
                logger.warn('Audit log insert failed (non-fatal)')
            }

            return jsonResponse({
                success: true,
                message_id: message.id,
                thread_id: message.thread_id,
                created_at: message.created_at
            }, 200)
        }

        // Should never reach here, but defensive return
        return errorResponse('Unhandled role state', 'INTERNAL_ERROR', 500)

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Unexpected error', message)
        const isDev = Deno.env.get('ENVIRONMENT') !== 'production'
        return errorResponse('Internal server error', 'UNEXPECTED_ERROR', 500, isDev ? message : undefined)
    }
})
