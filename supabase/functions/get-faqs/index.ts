/**
 * get-faqs Edge Function
 *
 * Public endpoint to retrieve published FAQ items for an event.
 * Returns event-specific FAQs and org-wide fallback FAQs, with optional
 * category filtering and full-text search (Dutch locale).
 *
 * No authentication required — visibility is enforced by filtering
 * status = 'published' and using the service client for direct queries.
 *
 * Flow:
 * 1. Parse query params: event_id (required), category, search, page, page_size
 * 2. Verify event exists and is published
 * 3. Resolve org_id from the event
 * 4. Query published FAQs scoped to event OR org-wide
 * 5. Apply optional category and full-text search filters
 * 6. Paginate results
 * 7. Fetch distinct categories for UI filtering
 * 8. Return { faqs, categories, total, page, page_size }
 *
 * Security: Public (no auth). Only 'published' FAQs are returned.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

// Pagination defaults and bounds
const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

serve(async (req: Request) => {
    // Handle CORS preflight
    const corsResponse = handleCors(req)
    if (corsResponse) return corsResponse

    const logger = createLogger('get-faqs')
    logger.info('Function invoked')

    try {
        // ===========================================================
        // 1. PARSE QUERY PARAMS
        // ===========================================================
        const url = new URL(req.url)
        const eventId = url.searchParams.get('event_id')
        const category = url.searchParams.get('category')
        const search = url.searchParams.get('search')

        if (!eventId) {
            return errorResponse('Missing event_id query parameter', 'MISSING_EVENT_ID', 400)
        }

        // Parse page (minimum 1)
        const rawPage = parseInt(url.searchParams.get('page') || String(DEFAULT_PAGE), 10)
        const page = isNaN(rawPage) || rawPage < 1 ? DEFAULT_PAGE : rawPage

        // Parse page_size (clamped between 1 and MAX_PAGE_SIZE)
        const rawPageSize = parseInt(url.searchParams.get('page_size') || String(DEFAULT_PAGE_SIZE), 10)
        const pageSize = isNaN(rawPageSize)
            ? DEFAULT_PAGE_SIZE
            : Math.min(Math.max(rawPageSize, 1), MAX_PAGE_SIZE)

        logger.info('Params parsed', { eventId, category, search, page, pageSize })

        // ===========================================================
        // 2. GET SERVICE CLIENT & VERIFY EVENT
        // ===========================================================
        const supabaseAdmin = getServiceClient()

        const { data: event, error: eventError } = await supabaseAdmin
            .from('events')
            .select('id, org_id, status')
            .eq('id', eventId)
            .single()

        if (eventError || !event) {
            logger.warn('Event not found', { eventId })
            return errorResponse('Event not found', 'NOT_FOUND', 404)
        }

        if (event.status !== 'published') {
            logger.warn('Event is not published', { eventId, status: event.status })
            return errorResponse('Event not found', 'NOT_FOUND', 404)
        }

        const orgId = event.org_id
        logger.info('Event verified', { eventId, orgId })

        // ===========================================================
        // 3. BUILD BASE FAQ QUERY
        //    Match event-specific FAQs OR org-wide FAQs (event_id IS NULL)
        // ===========================================================
        // We use a raw query via .or() to express:
        //   WHERE status = 'published' AND (event_id = ? OR (event_id IS NULL AND org_id = ?))
        //
        // Supabase JS client OR syntax:
        //   .or(`event_id.eq.${eventId},and(event_id.is.null,org_id.eq.${orgId})`)

        const baseFilter = `event_id.eq.${eventId},and(event_id.is.null,org_id.eq.${orgId})`

        // ===========================================================
        // 4. QUERY FAQs WITH OPTIONAL FILTERS + PAGINATION
        // ===========================================================
        let faqQuery = supabaseAdmin
            .from('faq_items')
            .select('id, event_id, title, content, category, sort_order, created_at')
            .eq('status', 'published')
            .or(baseFilter)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: false })

        // Apply category filter if provided
        if (category) {
            faqQuery = faqQuery.eq('category', category)
        }

        // Apply full-text search filter if provided (Dutch locale)
        // Uses PostgreSQL to_tsvector / plainto_tsquery via textSearch
        if (search && search.trim().length > 0) {
            // Supabase .textSearch targets a column; we need a compound search on title + content.
            // We use .filter() with a raw PostgREST expression for the tsvector match.
            faqQuery = faqQuery.filter(
                'search_vector',
                'phfts(dutch)',
                search.trim()
            )
        }

        // Apply pagination
        const offset = (page - 1) * pageSize
        faqQuery = faqQuery.range(offset, offset + pageSize - 1)

        const { data: faqs, error: faqsError } = await faqQuery

        if (faqsError) {
            // If search_vector column does not exist, fall back to LIKE-based search
            // This handles the case where the generated search column is not yet created
            logger.warn('FAQ query failed (possibly missing search_vector)', faqsError)

            // Retry without full-text search filter
            let retryQuery = supabaseAdmin
                .from('faq_items')
                .select('id, event_id, title, content, category, sort_order, created_at')
                .eq('status', 'published')
                .or(baseFilter)
                .order('sort_order', { ascending: true })
                .order('created_at', { ascending: false })

            if (category) {
                retryQuery = retryQuery.eq('category', category)
            }

            // Simple ILIKE fallback for search (escape special ILIKE chars)
            if (search && search.trim().length > 0) {
                const escaped = search.trim()
                    .replace(/%/g, '\\%')
                    .replace(/_/g, '\\_')
                retryQuery = retryQuery.or(
                    `title.ilike.%${escaped}%,content.ilike.%${escaped}%`
                )
            }

            retryQuery = retryQuery.range(offset, offset + pageSize - 1)

            const { data: retryFaqs, error: retryError } = await retryQuery
            if (retryError) {
                logger.error('FAQ retry query also failed', retryError)
                return errorResponse('Failed to fetch FAQs', 'QUERY_ERROR', 500)
            }

            // Use retry results below
            return buildResponse(retryFaqs, eventId, orgId, category, page, pageSize, supabaseAdmin, logger)
        }

        return buildResponse(faqs, eventId, orgId, category, page, pageSize, supabaseAdmin, logger)

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Unexpected error', message)
        const isDev = Deno.env.get('ENVIRONMENT') !== 'production'
        return errorResponse('Internal server error', 'UNEXPECTED_ERROR', 500, isDev ? message : undefined)
    }
})

/**
 * Build the final response with total count and distinct categories.
 * Extracted to avoid duplicating the count + categories logic in the fallback path.
 */
async function buildResponse(
    faqs: Array<{ id: string; event_id: string | null; title: string; content: string | null; category: string | null; sort_order: number; created_at: string }> | null,
    eventId: string,
    orgId: string,
    category: string | null,
    page: number,
    pageSize: number,
    supabaseAdmin: ReturnType<typeof getServiceClient>,
    logger: ReturnType<typeof createLogger>
): Promise<Response> {
    const baseFilter = `event_id.eq.${eventId},and(event_id.is.null,org_id.eq.${orgId})`

    // ===========================================================
    // 5. COUNT TOTAL (same filters, no pagination)
    // ===========================================================
    let countQuery = supabaseAdmin
        .from('faq_items')
        .select('count')
        .eq('status', 'published')
        .or(baseFilter)

    if (category) {
        countQuery = countQuery.eq('category', category)
    }

    const { data: countResult, error: countError } = await countQuery.single()

    if (countError) {
        logger.warn('Failed to count FAQs', countError)
    }

    const total = (countResult as { count: number })?.count ?? 0

    // ===========================================================
    // 6. FETCH DISTINCT CATEGORIES
    //    All published categories for this event scope (ignoring category filter)
    // ===========================================================
    const { data: categoryRows, error: catError } = await supabaseAdmin
        .from('faq_items')
        .select('category')
        .eq('status', 'published')
        .or(baseFilter)
        .not('category', 'is', null)

    if (catError) {
        logger.warn('Failed to fetch categories', catError)
    }

    // Deduplicate categories
    const categories = [...new Set(
        (categoryRows || []).map((row: { category: string }) => row.category)
    )]

    logger.info('Response built', { faqCount: faqs?.length ?? 0, total, categories: categories.length })

    // ===========================================================
    // 7. RETURN RESPONSE
    // ===========================================================
    return jsonResponse({
        faqs: faqs || [],
        categories,
        total,
        page,
        page_size: pageSize,
    })
}
