/**
 * bootstrap-org Edge Function
 *
 * Creates a new organization and makes the caller the owner.
 * Idempotent: if org exists and caller is a member, returns existing org.
 *
 * Flow:
 * 1. Authenticate user via JWT
 * 2. Validate slug and name
 * 3. Check if org already exists
 * 4. If exists and caller is member: return org (idempotent)
 * 5. If exists and caller not member: return 403
 * 6. If not exists: create org + add caller as owner
 *
 * Security: JWT verification enabled, only authenticated users can bootstrap.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { authenticateUser } from '../_shared/auth.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

serve(async (req: Request) => {
    // Handle CORS preflight
    const corsResponse = handleCors(req)
    if (corsResponse) return corsResponse

    const logger = createLogger('bootstrap-org')
    logger.info(`Received ${req.method} request`)

    try {
        // =========================================
        // 1. VERIFY AUTH (using the caller's JWT)
        // =========================================
        const { user, error: authError } = await authenticateUser(req)

        if (authError || !user) {
            logger.info('Auth check failed', { error: authError })
            return errorResponse(
                'Unauthorized',
                authError || 'INVALID_TOKEN',
                401,
                authError === 'NO_AUTH_HEADER' ? 'Missing Authorization header' : 'Could not verify user'
            )
        }

        logger.info('Auth check passed', { userId: user.id })

        // =========================================
        // 2. PARSE AND VALIDATE INPUT
        // =========================================
        let body: { slug?: string; name?: string }
        try {
            body = await req.json()
        } catch {
            return errorResponse('Invalid Request', 'INVALID_JSON', 400, 'Request body must be valid JSON')
        }

        const { slug, name } = body

        if (!slug || !name) {
            return errorResponse('Invalid Request', 'MISSING_FIELDS', 400, 'Both slug and name are required')
        }

        // Slug validation: lowercase, alphanumeric, hyphens only, min 3 chars
        const slugRegex = /^[a-z0-9-]{3,}$/
        if (!slugRegex.test(slug)) {
            return errorResponse(
                'Invalid Request',
                'INVALID_SLUG',
                400,
                'Slug must be lowercase, alphanumeric with hyphens, min 3 characters'
            )
        }

        logger.info('Input validated', { slug, name, userId: user.id })

        // =========================================
        // 3. INITIALIZE ADMIN CLIENT (Service Role)
        // =========================================
        const supabaseAdmin = getServiceClient()

        // =========================================
        // 4. CHECK IF ORG ALREADY EXISTS
        // =========================================
        const { data: existingOrg, error: orgLookupError } = await supabaseAdmin
            .from('orgs')
            .select('id, slug, name')
            .eq('slug', slug)
            .maybeSingle()

        if (orgLookupError) {
            logger.error('Org lookup error', orgLookupError)
            return errorResponse('Database Error', 'ORG_LOOKUP_FAILED', 500, orgLookupError.message)
        }

        if (existingOrg) {
            logger.info('Org exists', { orgId: existingOrg.id })

            // Check if user is already a member
            const { data: membership, error: memberLookupError } = await supabaseAdmin
                .from('org_members')
                .select('role')
                .eq('org_id', existingOrg.id)
                .eq('user_id', user.id)
                .maybeSingle()

            if (memberLookupError) {
                logger.error('Member lookup error', memberLookupError)
                return errorResponse('Database Error', 'MEMBER_LOOKUP_FAILED', 500, memberLookupError.message)
            }

            if (membership) {
                // Idempotent: user is already a member, return the org
                logger.info('User already member, returning org')
                return jsonResponse({ org: existingOrg, message: 'Already a member' }, 200)
            } else {
                // Org exists but caller is not a member
                logger.info('Org exists but user not a member')
                return errorResponse(
                    'Forbidden',
                    'NOT_A_MEMBER',
                    403,
                    'Organization exists but you are not a member'
                )
            }
        }

        // =========================================
        // 5. CREATE ORG + MEMBER (new org)
        // =========================================
        logger.info('Creating new org...')

        const { data: newOrg, error: createError } = await supabaseAdmin
            .from('orgs')
            .insert({ name, slug })
            .select('id, slug, name')
            .single()

        if (createError) {
            logger.error('Org creation error', createError)
            return errorResponse('Database Error', 'ORG_CREATE_FAILED', 500, createError.message)
        }

        logger.info('Org created', { orgId: newOrg.id })

        // Add user as owner
        const { error: memberError } = await supabaseAdmin
            .from('org_members')
            .insert({
                org_id: newOrg.id,
                user_id: user.id,
                role: 'owner'
            })

        if (memberError) {
            logger.error('Member creation error', memberError)
            // Attempt rollback
            await supabaseAdmin.from('orgs').delete().eq('id', newOrg.id)
            return errorResponse('Database Error', 'MEMBER_CREATE_FAILED', 500, memberError.message)
        }

        logger.info('Bootstrap complete', { orgId: newOrg.id, userId: user.id })

        return jsonResponse({ org: newOrg }, 200)

    } catch (error: unknown) {
        // Catch-all for any unexpected errors
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Unexpected error', message)
        return errorResponse('Internal Server Error', 'UNEXPECTED_ERROR', 500, message)
    }
})
