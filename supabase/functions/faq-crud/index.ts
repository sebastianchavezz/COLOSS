/**
 * faq-crud Edge Function
 *
 * Multi-method CRUD handler for FAQ items.
 * Supports POST (create), PUT (update), and DELETE based on HTTP method.
 * All operations require authentication and organizer access (owner/admin).
 *
 * POST /faq-crud
 *   Body: { event_id?, title, content?, category?, status?, sort_order? }
 *   Creates a new FAQ item. If event_id is provided, the FAQ is scoped to that event;
 *   otherwise it applies org-wide.
 *
 * PUT /faq-crud
 *   Body: { faq_id, title?, content?, category?, status?, sort_order? }
 *   Updates an existing FAQ item. Only provided fields are changed.
 *
 * DELETE /faq-crud
 *   Body: { faq_id }
 *   Permanently deletes an FAQ item.
 *
 * Security: JWT required. Owner/admin role on the FAQ's org.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { authenticateUser } from '../_shared/auth.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

// Roles allowed to manage FAQ items
const ALLOWED_ROLES = ['owner', 'admin']

// Valid FAQ status values
const VALID_FAQ_STATUSES = ['draft', 'published']

// --- Input Interfaces ---

interface FaqCreateRequest {
    event_id?: string
    title: string
    content?: string
    category?: string
    status?: 'draft' | 'published'
    sort_order?: number
}

interface FaqUpdateRequest {
    faq_id: string
    title?: string
    content?: string
    category?: string
    status?: string
    sort_order?: number
}

interface FaqDeleteRequest {
    faq_id: string
}

// --- Handler Functions ---

/**
 * POST handler: Create a new FAQ item
 */
async function handleCreate(
    body: Partial<FaqCreateRequest>,
    userId: string,
    supabaseAdmin: ReturnType<typeof getServiceClient>,
    logger: ReturnType<typeof createLogger>
): Promise<Response> {
    const { event_id, title, content, category, status, sort_order } = body

    // Validate required title
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return errorResponse('Title is required and must be a non-empty string', 'INVALID_TITLE', 400)
    }

    // Validate status if provided
    if (status && !VALID_FAQ_STATUSES.includes(status)) {
        return errorResponse(
            `Invalid status. Must be one of: ${VALID_FAQ_STATUSES.join(', ')}`,
            'INVALID_STATUS',
            400
        )
    }

    let orgId: string

    if (event_id) {
        // Event-scoped FAQ: verify event exists and belongs to user's org
        const { data: event } = await supabaseAdmin
            .from('events')
            .select('id, org_id')
            .eq('id', event_id)
            .single()

        if (!event) {
            return errorResponse('Event not found', 'EVENT_NOT_FOUND', 404)
        }

        orgId = event.org_id

        // Verify user is owner/admin for this org
        const { data: membership } = await supabaseAdmin
            .from('org_members')
            .select('role')
            .eq('org_id', orgId)
            .eq('user_id', userId)
            .single()

        if (!membership || !ALLOWED_ROLES.includes(membership.role)) {
            return errorResponse('Only owner/admin can create FAQ items', 'FORBIDDEN', 403)
        }
    } else {
        // Org-wide FAQ: resolve org_id from user's membership
        const { data: memberships } = await supabaseAdmin
            .from('org_members')
            .select('org_id, role')
            .eq('user_id', userId)

        // Find first membership with allowed role
        const validMembership = memberships?.find(
            (m: { org_id: string; role: string }) => ALLOWED_ROLES.includes(m.role)
        )

        if (!validMembership) {
            return errorResponse(
                'No organization with owner/admin role found. Provide event_id or ensure you have the correct role.',
                'FORBIDDEN',
                403
            )
        }

        orgId = validMembership.org_id
    }

    logger.info('Org resolved', { orgId, eventId: event_id || 'org-wide' })

    // Insert FAQ item
    const { data: faq, error: insertError } = await supabaseAdmin
        .from('faq_items')
        .insert({
            org_id: orgId,
            event_id: event_id || null,
            title: title.trim(),
            content: content || null,
            category: category || null,
            status: status || 'draft',
            sort_order: sort_order ?? 0,
            created_by: userId,
        })
        .select('id, created_at')
        .single()

    if (insertError || !faq) {
        logger.error('Failed to insert FAQ item', insertError)
        return errorResponse('Failed to create FAQ item', 'INSERT_ERROR', 500)
    }

    logger.info('FAQ created', { faqId: faq.id })

    return jsonResponse({
        faq_id: faq.id,
        created_at: faq.created_at,
    }, 201)
}

/**
 * PUT handler: Update an existing FAQ item
 */
async function handleUpdate(
    body: Partial<FaqUpdateRequest>,
    userId: string,
    supabaseAdmin: ReturnType<typeof getServiceClient>,
    logger: ReturnType<typeof createLogger>
): Promise<Response> {
    const { faq_id, title, content, category, status, sort_order } = body

    if (!faq_id) {
        return errorResponse('Missing faq_id', 'MISSING_FAQ_ID', 400)
    }

    // Validate status if provided
    if (status && !VALID_FAQ_STATUSES.includes(status)) {
        return errorResponse(
            `Invalid status. Must be one of: ${VALID_FAQ_STATUSES.join(', ')}`,
            'INVALID_STATUS',
            400
        )
    }

    // Fetch existing FAQ to get org_id
    const { data: existing } = await supabaseAdmin
        .from('faq_items')
        .select('id, org_id')
        .eq('id', faq_id)
        .single()

    if (!existing) {
        return errorResponse('FAQ item not found', 'NOT_FOUND', 404)
    }

    // Verify user is owner/admin for this org
    const { data: membership } = await supabaseAdmin
        .from('org_members')
        .select('role')
        .eq('org_id', existing.org_id)
        .eq('user_id', userId)
        .single()

    if (!membership || !ALLOWED_ROLES.includes(membership.role)) {
        return errorResponse('Only owner/admin can update FAQ items', 'FORBIDDEN', 403)
    }

    logger.info('Access verified for update', { faqId: faq_id, orgId: existing.org_id })

    // Build update object from provided fields only
    const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
    }

    if (title !== undefined && title !== null) {
        if (typeof title !== 'string' || title.trim().length === 0) {
            return errorResponse('Title must be a non-empty string', 'INVALID_TITLE', 400)
        }
        updateData.title = title.trim()
    }
    if (content !== undefined) updateData.content = content
    if (category !== undefined) updateData.category = category
    if (status !== undefined) updateData.status = status
    if (sort_order !== undefined) updateData.sort_order = sort_order

    // Apply update
    const { data: updated, error: updateError } = await supabaseAdmin
        .from('faq_items')
        .update(updateData)
        .eq('id', faq_id)
        .select('id, updated_at')
        .single()

    if (updateError || !updated) {
        logger.error('Failed to update FAQ item', updateError)
        return errorResponse('Failed to update FAQ item', 'UPDATE_ERROR', 500)
    }

    logger.info('FAQ updated', { faqId: updated.id })

    return jsonResponse({
        faq_id: updated.id,
        updated_at: updated.updated_at,
    })
}

/**
 * DELETE handler: Remove an FAQ item
 */
async function handleDelete(
    body: Partial<FaqDeleteRequest>,
    userId: string,
    supabaseAdmin: ReturnType<typeof getServiceClient>,
    logger: ReturnType<typeof createLogger>
): Promise<Response> {
    const { faq_id } = body

    if (!faq_id) {
        return errorResponse('Missing faq_id', 'MISSING_FAQ_ID', 400)
    }

    // Fetch existing FAQ to get org_id
    const { data: existing } = await supabaseAdmin
        .from('faq_items')
        .select('id, org_id')
        .eq('id', faq_id)
        .single()

    if (!existing) {
        return errorResponse('FAQ item not found', 'NOT_FOUND', 404)
    }

    // Verify user is owner/admin for this org
    const { data: membership } = await supabaseAdmin
        .from('org_members')
        .select('role')
        .eq('org_id', existing.org_id)
        .eq('user_id', userId)
        .single()

    if (!membership || !ALLOWED_ROLES.includes(membership.role)) {
        return errorResponse('Only owner/admin can delete FAQ items', 'FORBIDDEN', 403)
    }

    logger.info('Access verified for delete', { faqId: faq_id, orgId: existing.org_id })

    // Delete the FAQ item
    const { error: deleteError } = await supabaseAdmin
        .from('faq_items')
        .delete()
        .eq('id', faq_id)

    if (deleteError) {
        logger.error('Failed to delete FAQ item', deleteError)
        return errorResponse('Failed to delete FAQ item', 'DELETE_ERROR', 500)
    }

    logger.info('FAQ deleted', { faqId: faq_id })

    return jsonResponse({
        deleted: true,
        faq_id: faq_id,
    })
}

// --- Main Entry Point ---

serve(async (req: Request) => {
    // Handle CORS preflight
    const corsResponse = handleCors(req)
    if (corsResponse) return corsResponse

    const logger = createLogger('faq-crud')
    logger.info('Function invoked', { method: req.method })

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
        // 2. PARSE BODY (shared across all methods)
        // ===========================================================
        let body: Record<string, unknown>
        try {
            body = await req.json()
        } catch {
            return errorResponse('Invalid JSON body', 'INVALID_JSON', 400)
        }

        // ===========================================================
        // 3. GET SERVICE CLIENT
        // ===========================================================
        const supabaseAdmin = getServiceClient()

        // ===========================================================
        // 4. ROUTE BY HTTP METHOD
        // ===========================================================
        switch (req.method.toUpperCase()) {
            case 'POST':
                return await handleCreate(body as Partial<FaqCreateRequest>, user.id, supabaseAdmin, logger)

            case 'PUT':
                return await handleUpdate(body as Partial<FaqUpdateRequest>, user.id, supabaseAdmin, logger)

            case 'DELETE':
                return await handleDelete(body as Partial<FaqDeleteRequest>, user.id, supabaseAdmin, logger)

            default:
                return errorResponse(
                    `Method ${req.method} not allowed. Use POST, PUT, or DELETE.`,
                    'METHOD_NOT_ALLOWED',
                    405
                )
        }

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Unexpected error', message)
        const isDev = Deno.env.get('ENVIRONMENT') !== 'production'
        return errorResponse('Internal server error', 'UNEXPECTED_ERROR', 500, isDev ? message : undefined)
    }
})
