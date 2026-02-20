/**
 * cleanup-jobs Edge Function
 *
 * Runs periodic cleanup tasks:
 * 1. cleanup_stale_pending_orders - Cancel orders pending > 1 hour
 * 2. cleanup_expired_transfers - Expire transfers past their deadline
 *
 * Intended to be called via:
 * - Supabase pg_cron (if available)
 * - External cron service (Netlify scheduled function, etc.)
 * - Manual invocation for maintenance
 *
 * Security: Requires service role key (no user auth needed)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

serve(async (req: Request) => {
    // Handle CORS preflight
    const corsResponse = handleCors(req)
    if (corsResponse) return corsResponse

    const logger = createLogger('cleanup-jobs')
    logger.info('Cleanup jobs started')

    // Verify this is called with service role key
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY')
    if (!serviceKey) {
        return errorResponse('Server misconfiguration', 'CONFIG_ERROR', 500)
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader || authHeader !== `Bearer ${serviceKey}`) {
        return errorResponse('Unauthorized', 'INVALID_SERVICE_KEY', 401)
    }

    try {
        const supabaseAdmin = getServiceClient()
        const results: Record<string, unknown> = {}

        // 1. Cleanup stale pending orders
        try {
            const { data: staleOrders, error: staleError } = await supabaseAdmin
                .rpc('cleanup_stale_pending_orders')

            if (staleError) {
                logger.error('cleanup_stale_pending_orders failed', staleError)
                results.stale_orders = { error: staleError.message }
            } else {
                results.stale_orders = { cancelled: staleOrders }
                logger.info('Stale orders cleaned', { count: staleOrders })
            }
        } catch (err) {
            logger.error('cleanup_stale_pending_orders exception', err)
            results.stale_orders = { error: String(err) }
        }

        // 2. Cleanup expired transfers
        try {
            const { data: expiredTransfers, error: expiredError } = await supabaseAdmin
                .rpc('cleanup_expired_transfers')

            if (expiredError) {
                logger.error('cleanup_expired_transfers failed', expiredError)
                results.expired_transfers = { error: expiredError.message }
            } else {
                results.expired_transfers = { expired: expiredTransfers }
                logger.info('Expired transfers cleaned', { count: expiredTransfers })
            }
        } catch (err) {
            logger.error('cleanup_expired_transfers exception', err)
            results.expired_transfers = { error: String(err) }
        }

        logger.info('Cleanup jobs completed', results)

        return jsonResponse({
            success: true,
            timestamp: new Date().toISOString(),
            results
        })

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Unexpected error', message)
        return errorResponse('Internal server error', 'UNEXPECTED_ERROR', 500, message)
    }
})
