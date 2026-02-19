/**
 * manage-subscription Edge Function
 *
 * Manages user subscriptions: cancel and list.
 * Requires authentication.
 *
 * Actions:
 * - list: Get all subscriptions for the authenticated user
 * - cancel: Cancel a specific subscription (also cancels at Mollie)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { authenticateUser } from '../_shared/auth.ts'
import { createLogger } from '../_shared/logger.ts'
import { cancelMollieSubscription } from '../_shared/mollie.ts'

interface ManageSubscriptionRequest {
  action: 'list' | 'cancel'
  subscription_id?: string
  reason?: string
}

serve(async (req: Request) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  const logger = createLogger('manage-subscription')
  logger.info('Function invoked')

  try {
    if (req.method !== 'POST') {
      return errorResponse('Method not allowed', 'METHOD_NOT_ALLOWED', 405)
    }

    // =================================================================
    // 1. AUTHENTICATE USER
    // =================================================================
    const { user, error: authError } = await authenticateUser(req)
    if (authError || !user) {
      return errorResponse('Authenticatie vereist', 'AUTH_REQUIRED', 401)
    }

    const userId = user.id
    logger.info('User authenticated', { userId })

    // =================================================================
    // 2. PARSE INPUT
    // =================================================================
    let body: Partial<ManageSubscriptionRequest>
    try {
      body = await req.json()
    } catch {
      return errorResponse('Invalid JSON', 'INVALID_JSON', 400)
    }

    const { action } = body
    if (!action || !['list', 'cancel'].includes(action)) {
      return errorResponse(
        'Invalid action. Use "list" or "cancel".',
        'INVALID_ACTION',
        400
      )
    }

    const supabaseAdmin = getServiceClient()

    // =================================================================
    // 3. HANDLE ACTIONS
    // =================================================================
    if (action === 'list') {
      return await handleList(supabaseAdmin, userId, logger)
    }

    if (action === 'cancel') {
      if (!body.subscription_id) {
        return errorResponse('Missing subscription_id', 'MISSING_SUBSCRIPTION_ID', 400)
      }
      return await handleCancel(supabaseAdmin, userId, body.subscription_id, body.reason, logger)
    }

    return errorResponse('Unknown action', 'UNKNOWN_ACTION', 400)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Unexpected error', message)
    return errorResponse('Internal server error', 'UNEXPECTED_ERROR', 500, message)
  }
})

/**
 * List all subscriptions for the authenticated user
 */
async function handleList(
  supabaseAdmin: any,
  userId: string,
  logger: any
): Promise<Response> {
  const { data, error } = await supabaseAdmin.rpc('get_user_subscriptions')

  if (error) {
    logger.error('RPC get_user_subscriptions failed', error)
    return errorResponse('Kon abonnementen niet ophalen', 'LIST_FAILED', 500)
  }

  logger.info('Subscriptions listed', {
    count: data?.subscriptions?.length || 0,
  })

  return jsonResponse({
    success: true,
    subscriptions: data?.subscriptions || [],
  })
}

/**
 * Cancel a subscription (updates DB + cancels at Mollie)
 */
async function handleCancel(
  supabaseAdmin: any,
  userId: string,
  subscriptionId: string,
  reason: string | undefined,
  logger: any
): Promise<Response> {
  // 1. Call our cancel_subscription RPC (handles auth check, status update, audit, email)
  const { data: result, error: rpcError } = await supabaseAdmin.rpc('cancel_subscription', {
    _subscription_id: subscriptionId,
    _reason: reason || null,
  })

  if (rpcError) {
    logger.error('RPC cancel_subscription failed', rpcError)
    return errorResponse('Kon abonnement niet opzeggen', 'CANCEL_RPC_FAILED', 500)
  }

  if (result?.error) {
    logger.warn('Cancel subscription returned error', result)
    const statusMap: Record<string, number> = {
      'SUBSCRIPTION_NOT_FOUND': 404,
      'NOT_AUTHORIZED': 403,
      'CANNOT_CANCEL': 409,
    }
    return errorResponse(
      result.error,
      result.error,
      statusMap[result.error] || 400
    )
  }

  // 2. Cancel at Mollie (if subscription has a Mollie subscription ID)
  const mollieSubscriptionId = result?.mollie_subscription_id
  if (mollieSubscriptionId) {
    // Need the Mollie customer ID to cancel
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('mollie_customer_id')
      .eq('id', subscriptionId)
      .single()

    if (sub?.mollie_customer_id) {
      try {
        const cancelled = await cancelMollieSubscription(
          sub.mollie_customer_id,
          mollieSubscriptionId
        )
        logger.info('Mollie subscription cancelled', {
          mollieSubscriptionId,
          success: cancelled,
        })
      } catch (mollieErr) {
        logger.error('Failed to cancel Mollie subscription (non-fatal)', mollieErr)
        // Non-fatal: our DB is updated, Mollie will stop charging when mandate expires
      }
    }
  }

  logger.info('Subscription cancelled', {
    subscriptionId,
    accessUntil: result?.access_until,
  })

  return jsonResponse({
    success: true,
    subscription_id: subscriptionId,
    cancelled_at: result?.cancelled_at,
    access_until: result?.access_until,
  })
}
