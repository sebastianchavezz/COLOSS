/**
 * validate-invitation-code Edge Function
 *
 * Validates an invitation code for a given event and email.
 * Can be called by authenticated or anonymous users (public endpoint).
 *
 * Flow:
 * 1. Parse input (code, event_id, email)
 * 2. Call RPC to validate code
 * 3. Return validation result
 *
 * Security: Public endpoint, but RPC enforces business rules
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

interface ValidateCodeRequest {
    code: string
    event_id: string
    email: string
}

serve(async (req: Request) => {
    // Handle CORS preflight
    const corsResponse = handleCors(req)
    if (corsResponse) return corsResponse

    const logger = createLogger('validate-invitation-code')
    logger.info('Function invoked')

    try {
        // 1. PARSE INPUT
        let body: Partial<ValidateCodeRequest>
        try {
            body = await req.json()
        } catch {
            return errorResponse('Invalid JSON', 'INVALID_JSON', 400)
        }

        const { code, event_id, email } = body

        if (!code || !event_id || !email) {
            return errorResponse(
                'Missing required fields: code, event_id, email',
                'MISSING_FIELDS',
                400
            )
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(email)) {
            return errorResponse('Invalid email format', 'INVALID_EMAIL', 400)
        }

        logger.info('Validating code', { code, event_id, email })

        // 2. VALIDATE CODE VIA RPC
        const supabaseAdmin = getServiceClient()

        const { data: validationResult, error: rpcError } = await supabaseAdmin
            .rpc('validate_invitation_code_usage', {
                _code: code,
                _event_id: event_id,
                _email: email
            })

        if (rpcError) {
            logger.error('RPC failed', rpcError)
            return errorResponse('Validation failed', 'VALIDATION_ERROR', 500, rpcError.message)
        }

        // 3. RETURN RESULT
        if (!validationResult.valid) {
            logger.warn('Code validation failed', validationResult)
            return jsonResponse(validationResult, 400)
        }

        logger.info('Code validated successfully', { code_id: validationResult.code_id })
        return jsonResponse(validationResult, 200)

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Unexpected error', message)
        return errorResponse('Internal server error', 'UNEXPECTED_ERROR', 500, message)
    }
})
