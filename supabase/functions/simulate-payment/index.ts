/**
 * simulate-payment Edge Function
 *
 * Development/testing tool to simulate a successful payment.
 * This bypasses Mollie and directly marks an order as paid.
 *
 * Security: Only enabled via feature flag (SIMULATE_PAYMENTS_ENABLED=true)
 * WARNING: NEVER enable this in production!
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { authenticateUser } from '../_shared/auth.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

serve(async (req: Request) => {
    // Handle CORS preflight
    const corsResponse = handleCors(req)
    if (corsResponse) return corsResponse

    const logger = createLogger('simulate-payment')
    logger.info('Function invoked')

    try {
        // 1. CHECK FEATURE FLAG
        const isEnabled = Deno.env.get('SIMULATE_PAYMENTS_ENABLED') === 'true'
        if (!isEnabled) {
            logger.warn('Payment simulation is disabled')
            return errorResponse('Payment simulation is disabled', 'FEATURE_DISABLED', 403)
        }

        // 2. AUTHENTICATE USER
        const { user, error: authError } = await authenticateUser(req)
        if (authError) {
            return errorResponse('Unauthorized', authError, 401)
        }

        logger.info('User authenticated', user!.id)

        // 3. PARSE INPUT
        let body: { order_id?: string }
        try {
            body = await req.json()
        } catch {
            return errorResponse('Invalid JSON', 'INVALID_JSON', 400)
        }

        const { order_id } = body

        if (!order_id) {
            return errorResponse('Missing order_id', 'MISSING_ORDER_ID', 400)
        }

        // 4. EXECUTE ADMIN ACTION (RPC)
        // Use Service Role to bypass RLS restrictions
        const adminClient = getServiceClient()

        const { error: rpcError } = await adminClient.rpc('simulate_payment_success', {
            _order_id: order_id
        })

        if (rpcError) {
            logger.error('RPC failed', rpcError)
            return errorResponse(rpcError.message, 'RPC_ERROR', 400)
        }

        logger.info('Payment simulated successfully')

        // 5. TRIGGER TICKET ISSUANCE
        // In a real webhook flow, this happens automatically.
        // Here we do it explicitly to complete the simulation.
        logger.info('Triggering ticket issuance')

        const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ??
                               Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!

        const issueResponse = await fetch(`${supabaseUrl}/functions/v1/issue-tickets`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${serviceRoleKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ order_id: order_id })
        })

        let issueResult = null
        if (issueResponse.ok) {
            issueResult = await issueResponse.json()
            logger.info('Tickets issued', issueResult.count || 0)
        } else {
            logger.error('Failed to issue tickets', await issueResponse.text())
        }

        // 6. SUCCESS
        return jsonResponse({
            success: true,
            message: 'Payment simulated successfully',
            tickets_issued: issueResult?.count || 0
        }, 200)

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Unexpected error', message)
        return errorResponse('Internal server error', 'UNEXPECTED_ERROR', 500, message)
    }
})
