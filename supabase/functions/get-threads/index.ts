/**
 * get-threads Edge Function
 *
 * Retrieves a paginated list of chat threads for an event, scoped to
 * organizers only. Includes participant profile info and aggregate
 * unread counts for dashboard display.
 *
 * Flow:
 * 1. Authenticate user (required)
 * 2. Parse query params: event_id, status, page, page_size
 * 3. Resolve event -> org_id
 * 4. Verify user is organizer (owner/admin/support) for the org
 * 5. Query chat_threads with filters, pagination, and ordering
 * 6. Count total threads (same filters, no pagination)
 * 7. Count unread_total across open+pending threads
 * 8. Enrich each thread with participant info (first_name, last_name, email)
 * 9. Return { threads, total, unread_total, page, page_size }
 *
 * Security:
 *    - Organizer-only access (owner/admin/support roles)
 *    - org_id derived server-side from event, never trusted from client
 *    - Uses SERVICE_ROLE for queries (authorisation enforced in application logic)
 */ import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleCors } from '../_shared/cors.ts';
import { jsonResponse, errorResponse } from '../_shared/response.ts';
import { authenticateUser, isOrgMember } from '../_shared/auth.ts';
import { getServiceClient } from '../_shared/supabase.ts';
import { createLogger } from '../_shared/logger.ts';
// Valid thread status filter values
const VALID_STATUSES = [
  'open',
  'pending',
  'closed',
  'all'
];
// Pagination limits
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
serve(async (req)=>{
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  const logger = createLogger('get-threads');
  logger.info('Function invoked');
  try {
    // Only GET allowed
    if (req.method !== 'GET') {
      return errorResponse('Method not allowed', 'METHOD_NOT_ALLOWED', 405);
    }
    // =================================================================
    // 1. AUTHENTICATE USER (required)
    // =================================================================
    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) {
      return errorResponse('Unauthorized', authError || 'NO_USER', 401);
    }
    logger.info('User authenticated', {
      userId: user.id
    });
    // =================================================================
    // 2. PARSE QUERY PARAMS
    // =================================================================
    const url = new URL(req.url);
    const eventId = url.searchParams.get('event_id');
    const statusFilter = url.searchParams.get('status') || 'all';
    const pageParam = url.searchParams.get('page');
    const pageSizeParam = url.searchParams.get('page_size');
    // event_id is required
    if (!eventId) {
      return errorResponse('event_id query parameter is required', 'MISSING_EVENT_ID', 400);
    }
    // Validate status filter
    if (!VALID_STATUSES.includes(statusFilter)) {
      return errorResponse(`Invalid status filter. Allowed values: ${VALID_STATUSES.join(', ')}`, 'INVALID_STATUS', 400);
    }
    // Parse and validate pagination
    let page = DEFAULT_PAGE;
    if (pageParam !== null) {
      page = parseInt(pageParam, 10);
      if (isNaN(page) || page < 1) {
        return errorResponse('page must be a positive integer', 'INVALID_PAGE', 400);
      }
    }
    let pageSize = DEFAULT_PAGE_SIZE;
    if (pageSizeParam !== null) {
      pageSize = parseInt(pageSizeParam, 10);
      if (isNaN(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
        return errorResponse(`page_size must be between 1 and ${MAX_PAGE_SIZE}`, 'INVALID_PAGE_SIZE', 400);
      }
    }
    logger.info('Query params parsed', {
      eventId,
      statusFilter,
      page,
      pageSize
    });
    // =================================================================
    // 3. RESOLVE EVENT -> ORG_ID
    // =================================================================
    const supabaseAdmin = getServiceClient();
    const { data: event, error: eventError } = await supabaseAdmin.from('events').select('id, org_id, name').eq('id', eventId).single();
    if (eventError || !event) {
      logger.warn('Event not found', {
        eventId
      });
      return errorResponse('Event not found', 'EVENT_NOT_FOUND', 404);
    }
    const orgId = event.org_id;
    logger.info('Event resolved', {
      eventId,
      orgId,
      eventName: event.name
    });
    // =================================================================
    // 4. VERIFY ORGANIZER ROLE (owner/admin/support)
    // =================================================================
    const hasRole = await isOrgMember(supabaseAdmin, orgId, user.id, [
      'owner',
      'admin',
      'support'
    ]);
    if (!hasRole) {
      logger.warn('User does not have organizer role for this org', {
        userId: user.id,
        orgId
      });
      return errorResponse('Insufficient permissions. Owner, admin, or support role required.', 'FORBIDDEN', 403);
    }
    logger.info('Organizer role verified', {
      orgId
    });
    // =================================================================
    // 5. QUERY THREADS (with filters + pagination)
    // =================================================================
    const offset = (page - 1) * pageSize;
    // Build the threads query
    let threadsQuery = supabaseAdmin.from('chat_threads').select('id, org_id, event_id, participant_id, status, unread_count_organizer, last_message_at, created_at, updated_at, participant_has_access').eq('event_id', eventId).eq('org_id', orgId);
    // Apply status filter (skip if 'all')
    if (statusFilter !== 'all') {
      threadsQuery = threadsQuery.eq('status', statusFilter);
    }
    // Order by last_message_at DESC (most recent first), NULLS LAST
    threadsQuery = threadsQuery.order('last_message_at', {
      ascending: false,
      nullsFirst: false
    });
    // Apply pagination using range (Supabase v2 doesn't have .offset())
    const rangeStart = offset;
    const rangeEnd = offset + pageSize - 1;
    threadsQuery = threadsQuery.range(rangeStart, rangeEnd);
    const { data: threads, error: threadsError } = await threadsQuery;
    if (threadsError) {
      logger.error('Failed to query threads', {
        error: threadsError.message
      });
      return errorResponse('Failed to fetch threads', 'THREADS_QUERY_ERROR', 500, threadsError.message);
    }
    logger.info('Threads fetched', {
      count: threads?.length || 0
    });
    // =================================================================
    // 6. COUNT TOTAL (same filters, no pagination)
    // =================================================================
    let countQuery = supabaseAdmin.from('chat_threads').select('count', {
      count: 'exact',
      head: true
    }).eq('event_id', eventId).eq('org_id', orgId);
    if (statusFilter !== 'all') {
      countQuery = countQuery.eq('status', statusFilter);
    }
    const { count: total, error: countError } = await countQuery;
    if (countError) {
      logger.error('Failed to count threads', {
        error: countError.message
      });
      return errorResponse('Failed to count threads', 'COUNT_QUERY_ERROR', 500, countError.message);
    }
    // =================================================================
    // 7. COUNT UNREAD TOTAL (open + pending threads with unread > 0)
    // =================================================================
    const { data: unreadResult, error: unreadError } = await supabaseAdmin.from('chat_threads').select('unread_count_organizer').eq('event_id', eventId).eq('org_id', orgId).in('status', [
      'open',
      'pending'
    ]).gt('unread_count_organizer', 0);
    let unreadTotal = 0;
    if (!unreadError && unreadResult) {
      unreadTotal = unreadResult.reduce((sum, row)=>sum + row.unread_count_organizer, 0);
    } else if (unreadError) {
      // Non-fatal: log warning but continue with 0
      logger.warn('Failed to compute unread total (non-fatal)', {
        error: unreadError.message
      });
    }
    logger.info('Unread total computed', {
      unreadTotal
    });
    // =================================================================
    // 8. ENRICH THREADS WITH PARTICIPANT INFO
    // =================================================================
    const enrichedThreads = [];
    if (threads && threads.length > 0) {
      // Collect unique participant_ids for batch lookup
      const participantIds = [
        ...new Set(threads.map((t)=>t.participant_id))
      ];
      // Fetch participant records in a single query
      const { data: participants, error: participantsError } = await supabaseAdmin.from('participants').select('id, first_name, last_name, email').in('id', participantIds);
      if (participantsError) {
        logger.warn('Failed to fetch participant info (using empty placeholders)', {
          error: participantsError.message
        });
      }
      // Build a lookup map for O(1) access per thread
      const participantMap = new Map();
      if (participants) {
        for (const p of participants){
          participantMap.set(p.id, {
            first_name: p.first_name || null,
            last_name: p.last_name || null,
            email: p.email || null
          });
        }
      }
      // Enrich each thread with participant data
      for (const thread of threads){
        const participantInfo = participantMap.get(thread.participant_id) || {
          first_name: null,
          last_name: null,
          email: null
        };
        enrichedThreads.push({
          ...thread,
          participant: participantInfo
        });
      }
    }
    logger.info('Threads enriched with participant info', {
      enrichedCount: enrichedThreads.length
    });
    // =================================================================
    // 9. RETURN RESPONSE
    // =================================================================
    return jsonResponse({
      threads: enrichedThreads,
      total: total || 0,
      unread_total: unreadTotal,
      page,
      page_size: pageSize
    }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    logger.error('Unexpected error', {
      message,
      stack
    });
    // Always include error details for debugging
    return errorResponse('Internal server error', 'UNEXPECTED_ERROR', 500, message);
  }
});
