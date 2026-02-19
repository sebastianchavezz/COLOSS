/**
 * create-subscription-checkout Edge Function
 *
 * Handles the first payment for subscription setup.
 * Requires authentication (Mollie needs a Customer + mandate for recurring).
 *
 * Flow:
 * 1. Authenticate user (required for subscriptions)
 * 2. Validate: event must be club mode, ticket_type must be subscription
 * 3. Check if user already has active subscription for this ticket_type
 * 4. Get or create Mollie Customer
 * 5. Create order (type: subscription_setup)
 * 6. Create Mollie payment with sequenceType: "first" + customerId
 * 7. Create subscription row with status 'pending_mandate'
 * 8. Return checkout_url
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { authenticateUser } from '../_shared/auth.ts'
import { createLogger } from '../_shared/logger.ts'
import { getOrCreateMollieCustomer, createFirstPayment } from '../_shared/mollie.ts'

interface CreateSubscriptionRequest {
  event_id: string
  ticket_type_id: string
}

serve(async (req: Request) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  const logger = createLogger('create-subscription-checkout')
  logger.info('Function invoked')

  try {
    if (req.method !== 'POST') {
      return errorResponse('Method not allowed', 'METHOD_NOT_ALLOWED', 405)
    }

    // =================================================================
    // 1. AUTHENTICATE USER (required for subscriptions)
    // =================================================================
    const { user, error: authError } = await authenticateUser(req)
    if (authError || !user) {
      logger.warn('Authentication required for subscription checkout', { error: authError })
      return errorResponse(
        'Je moet ingelogd zijn om een abonnement af te sluiten',
        'AUTH_REQUIRED',
        401
      )
    }

    const userId = user.id
    const userEmail = user.email || ''
    logger.info('User authenticated', { userId })

    // =================================================================
    // 2. PARSE & VALIDATE INPUT
    // =================================================================
    let body: Partial<CreateSubscriptionRequest>
    try {
      body = await req.json()
    } catch {
      return errorResponse('Invalid JSON', 'INVALID_JSON', 400)
    }

    const { event_id, ticket_type_id } = body
    if (!event_id) {
      return errorResponse('Missing event_id', 'MISSING_EVENT_ID', 400)
    }
    if (!ticket_type_id) {
      return errorResponse('Missing ticket_type_id', 'MISSING_TICKET_TYPE_ID', 400)
    }

    const supabaseAdmin = getServiceClient()

    // =================================================================
    // 3. VALIDATE EVENT (must be club mode)
    // =================================================================
    const { data: event, error: eventError } = await supabaseAdmin
      .from('events')
      .select('id, name, slug, org_id, status, event_mode')
      .eq('id', event_id)
      .single()

    if (eventError || !event) {
      return errorResponse('Event niet gevonden', 'EVENT_NOT_FOUND', 404)
    }

    if (event.status !== 'published') {
      return errorResponse('Event is niet beschikbaar', 'EVENT_NOT_PUBLISHED', 403)
    }

    if (event.event_mode !== 'club') {
      return errorResponse(
        'Dit event ondersteunt geen abonnementen',
        'NOT_CLUB_MODE',
        400
      )
    }

    logger.info('Event validated', { name: event.name, mode: event.event_mode })

    // =================================================================
    // 4. VALIDATE TICKET TYPE (must be subscription)
    // =================================================================
    const { data: ticketType, error: ttError } = await supabaseAdmin
      .from('ticket_types')
      .select('id, name, price, is_subscription, billing_interval, billing_cycle_count, subscription_description, event_id')
      .eq('id', ticket_type_id)
      .eq('event_id', event_id)
      .single()

    if (ttError || !ticketType) {
      return errorResponse('Ticket type niet gevonden', 'TICKET_TYPE_NOT_FOUND', 404)
    }

    if (!ticketType.is_subscription) {
      return errorResponse(
        'Dit ticket type is geen abonnement. Gebruik de standaard checkout.',
        'NOT_SUBSCRIPTION',
        400
      )
    }

    if (!ticketType.billing_interval) {
      return errorResponse(
        'Billing interval niet ingesteld voor dit abonnement',
        'MISSING_BILLING_INTERVAL',
        400
      )
    }

    const price = parseFloat(ticketType.price?.toString() || '0')
    if (price <= 0) {
      return errorResponse(
        'Abonnementsprijs moet groter dan 0 zijn',
        'INVALID_PRICE',
        400
      )
    }

    logger.info('Ticket type validated', {
      name: ticketType.name,
      price,
      interval: ticketType.billing_interval,
      cycles: ticketType.billing_cycle_count,
    })

    // =================================================================
    // 5. CHECK EXISTING SUBSCRIPTION
    // =================================================================
    // Partial unique index only blocks active/pending_mandate/past_due.
    // Cancelled/completed/suspended rows are preserved as history.
    const { data: existingSubs } = await supabaseAdmin
      .from('subscriptions')
      .select('id, status')
      .eq('user_id', userId)
      .eq('ticket_type_id', ticket_type_id)
      .in('status', ['active', 'pending_mandate', 'past_due'])

    if (existingSubs && existingSubs.length > 0) {
      const activeSub = existingSubs[0]
      return errorResponse(
        'Je hebt al een actief abonnement voor dit ticket type',
        'ALREADY_SUBSCRIBED',
        409,
        { subscription_id: activeSub.id, status: activeSub.status }
      )
    }

    // =================================================================
    // 6. GET OR CREATE MOLLIE CUSTOMER
    // =================================================================
    let mollieCustomerId: string
    try {
      const { customerId, isNew } = await getOrCreateMollieCustomer(
        supabaseAdmin,
        userId,
        userEmail,
        user.user_metadata?.full_name || user.user_metadata?.name
      )
      mollieCustomerId = customerId
      logger.info('Mollie customer resolved', { customerId, isNew })
    } catch (mollieErr) {
      logger.error('Failed to get/create Mollie customer', mollieErr)
      return errorResponse(
        'Kon betalingsaccount niet aanmaken',
        'MOLLIE_CUSTOMER_ERROR',
        502
      )
    }

    // =================================================================
    // 7. CREATE ORDER (subscription_setup)
    // =================================================================
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        event_id: event.id,
        org_id: event.org_id,
        user_id: userId,
        email: userEmail,
        status: 'pending',
        subtotal_amount: price,
        total_amount: price,
        currency: 'EUR',
        metadata: {
          type: 'subscription_setup',
          ticket_type_id,
          billing_interval: ticketType.billing_interval,
          billing_cycle_count: ticketType.billing_cycle_count,
        },
      })
      .select('id, status, total_amount, created_at')
      .single()

    if (orderError || !order) {
      logger.error('Failed to create order', orderError)
      return errorResponse('Kon bestelling niet aanmaken', 'ORDER_CREATE_FAILED', 500)
    }

    // Create order item
    await supabaseAdmin
      .from('order_items')
      .insert({
        order_id: order.id,
        ticket_type_id,
        quantity: 1,
        unit_price: price,
        total_price: price,
      })

    logger.info('Order created', { orderId: order.id })

    // =================================================================
    // 8. CREATE MOLLIE FIRST PAYMENT
    // =================================================================
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const frontendUrl = Deno.env.get('FRONTEND_URL')
    const origin = frontendUrl || req.headers.get('origin') || 'http://localhost:5173'

    let molliePayment: any
    try {
      molliePayment = await createFirstPayment({
        customerId: mollieCustomerId,
        amount: {
          currency: 'EUR',
          value: price.toFixed(2),
        },
        description: `Abonnement: ${ticketType.name} - ${event.name}`,
        redirectUrl: `${origin}/e/${event.slug}/subscription-confirm?order_id=${order.id}`,
        webhookUrl: `${supabaseUrl}/functions/v1/mollie-webhook`,
        metadata: {
          order_id: order.id,
          org_id: event.org_id,
          event_id: event.id,
          user_id: userId,
          subscription_setup: 'true',
          ticket_type_id,
        },
      })
    } catch (mollieErr) {
      logger.error('Failed to create Mollie first payment', mollieErr)
      // Rollback: mark order as failed
      await supabaseAdmin
        .from('orders')
        .update({ status: 'failed' })
        .eq('id', order.id)
      return errorResponse(
        'Kon betaling niet aanmaken',
        'MOLLIE_PAYMENT_ERROR',
        502
      )
    }

    const checkoutUrl = molliePayment._links?.checkout?.href
    if (!checkoutUrl) {
      logger.error('Mollie did not return checkout URL', {
        mollieId: molliePayment.id,
        links: molliePayment._links,
      })
      return errorResponse(
        'Betaalprovider gaf geen checkout URL terug',
        'MOLLIE_NO_CHECKOUT_URL',
        502
      )
    }

    logger.info('Mollie first payment created', {
      molliePaymentId: molliePayment.id,
      checkoutUrl,
    })

    // Store payment record
    await supabaseAdmin
      .from('payments')
      .insert({
        org_id: event.org_id,
        order_id: order.id,
        provider: 'mollie',
        provider_payment_id: molliePayment.id,
        amount: Math.round(price * 100),
        currency: 'EUR',
        status: molliePayment.status || 'open',
      })

    // =================================================================
    // 9. CREATE SUBSCRIPTION ROW (pending_mandate)
    // =================================================================
    const { data: subscription, error: subError } = await supabaseAdmin
      .from('subscriptions')
      .insert({
        user_id: userId,
        event_id: event.id,
        ticket_type_id,
        org_id: event.org_id,
        mollie_customer_id: mollieCustomerId,
        status: 'pending_mandate',
        billing_interval: ticketType.billing_interval,
        billing_cycle_count: ticketType.billing_cycle_count,
        amount: price,
        currency: 'EUR',
        first_order_id: order.id,
      })
      .select('id')
      .single()

    if (subError) {
      logger.error('Failed to create subscription row', subError)
      // Non-fatal: webhook will reconcile
    }

    logger.info('Subscription created', {
      subscriptionId: subscription?.id,
      status: 'pending_mandate',
    })

    // Audit log
    try {
      await supabaseAdmin
        .from('audit_log')
        .insert({
          org_id: event.org_id,
          actor_user_id: userId,
          action: 'SUBSCRIPTION_CHECKOUT_STARTED',
          entity_type: 'subscription',
          entity_id: subscription?.id || order.id,
          after_state: {
            status: 'pending_mandate',
            ticket_type: ticketType.name,
            amount: price,
            interval: ticketType.billing_interval,
          },
          metadata: {
            order_id: order.id,
            mollie_payment_id: molliePayment.id,
          },
        })
    } catch {
      logger.warn('Audit log failed (non-fatal)')
    }

    return jsonResponse({
      success: true,
      subscription_id: subscription?.id,
      checkout_url: checkoutUrl,
      order: {
        id: order.id,
        status: order.status,
        total_amount: order.total_amount,
      },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Unexpected error', message)
    return errorResponse('Internal server error', 'UNEXPECTED_ERROR', 500, message)
  }
})
