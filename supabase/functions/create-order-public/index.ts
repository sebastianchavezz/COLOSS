/**
 * create-order-public Edge Function
 *
 * Waterdichte public checkout — werkt voor zowel authenticated als guest users.
 * Ondersteunt zowel tickets als producten (F015 integration).
 *
 * Flow:
 * 1. Parse & validate input (event_id or event_slug, items, product_items, email, purchaser_name)
 * 2. Resolve user_id from optional Bearer token
 * 3. Verify event is published + within sales window
 * 4. Atomic capacity pre-check via RPC (FOR UPDATE SKIP LOCKED) - tickets AND products
 * 5. Server-side price calculation (never trust client prices)
 * 6. Derive org_id from event (never from client)
 * 7. Generate public_token → SHA-256 hash → store in order
 * 8. INSERT order + order_items (tickets + products)
 * 9. If total == 0 (free): issue tickets immediately
 * 10. If total > 0: create Mollie payment → return checkout_url + public_token
 *
 * Security:
 * - Uses SERVICE_ROLE for all DB writes (bypasses RLS for creation)
 * - All inputs validated server-side
 * - Prices computed from DB, never from client
 * - Capacity checked atomically with row locking
 * - Public token hashed before storage (DB leak protection)
 * - Product restrictions enforced (ticket_upgrade requires matching ticket)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

const MOLLIE_API_URL = "https://api.mollie.com/v2/payments"

interface TicketItem {
    ticket_type_id: string
    quantity: number
}

interface ProductItem {
    product_id: string
    variant_id?: string
    quantity: number
}

interface CreateOrderPublicRequest {
    event_id?: string
    event_slug?: string
    items: TicketItem[]              // Ticket items
    product_items?: ProductItem[]     // Product items (F015)
    email: string
    purchaser_name?: string
    // Optional: Bearer token in Authorization header for authenticated users
    // B008: Optional invitation token - gives ACCESS to purchase (NOT a discount!)
    invitation_token?: string
}

/**
 * Generate a cryptographically secure random token (base64url)
 */
function generateToken(): string {
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    return btoa(String.fromCharCode(...array))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
}

/**
 * Hash a token using SHA-256 → hex string
 */
async function hashToken(token: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(token)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

serve(async (req: Request) => {
    // Handle CORS preflight
    const corsResponse = handleCors(req)
    if (corsResponse) return corsResponse

    const logger = createLogger('create-order-public')
    logger.info('Function invoked')

    try {
        // Only POST allowed
        if (req.method !== 'POST') {
            return errorResponse('Method not allowed', 'METHOD_NOT_ALLOWED', 405)
        }

        // =================================================================
        // 1. PARSE & VALIDATE INPUT
        // =================================================================
        let body: Partial<CreateOrderPublicRequest>
        try {
            body = await req.json()
        } catch {
            return errorResponse('Invalid JSON', 'INVALID_JSON', 400)
        }

        const { event_id, event_slug, items, product_items, email, purchaser_name, invitation_token } = body

        if (!event_id && !event_slug) {
            return errorResponse('Missing event_id or event_slug', 'MISSING_EVENT_ID', 400)
        }

        // At least one item type required
        const hasTickets = items && Array.isArray(items) && items.length > 0
        const hasProducts = product_items && Array.isArray(product_items) && product_items.length > 0

        if (!hasTickets && !hasProducts) {
            return errorResponse('Missing items - need at least tickets or products', 'MISSING_ITEMS', 400)
        }

        if (!email || !email.includes('@')) {
            return errorResponse('Missing or invalid email', 'MISSING_EMAIL', 400)
        }

        // Validate ticket items structure
        if (hasTickets) {
            for (const item of items!) {
                if (!item.ticket_type_id) {
                    return errorResponse('Each ticket item must have ticket_type_id', 'INVALID_TICKET_ITEM', 400)
                }
                if (!Number.isInteger(item.quantity) || item.quantity < 1) {
                    return errorResponse('Each ticket item must have quantity >= 1', 'INVALID_TICKET_QUANTITY', 400)
                }
            }
        }

        // Validate product items structure
        if (hasProducts) {
            for (const item of product_items!) {
                if (!item.product_id) {
                    return errorResponse('Each product item must have product_id', 'INVALID_PRODUCT_ITEM', 400)
                }
                if (!Number.isInteger(item.quantity) || item.quantity < 1) {
                    return errorResponse('Each product item must have quantity >= 1', 'INVALID_PRODUCT_QUANTITY', 400)
                }
            }
        }

        // Limit items per request (anti-spam)
        const totalItems = (items?.length || 0) + (product_items?.length || 0)
        if (totalItems > 30) {
            return errorResponse('Too many items (max 30 total)', 'TOO_MANY_ITEMS', 400)
        }

        logger.info('Input validated', {
            event_id,
            event_slug,
            ticketCount: items?.length || 0,
            productCount: product_items?.length || 0,
            email
        })

        // =================================================================
        // 2. RESOLVE USER (optional — works for both guest and authenticated)
        // =================================================================
        const supabaseAdmin = getServiceClient()
        let userId: string | null = null

        const authHeader = req.headers.get('Authorization')
        if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
                // Try to resolve user from token
                const supabaseUrl = Deno.env.get('SUPABASE_URL')
                const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
                if (supabaseUrl && anonKey) {
                    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
                    const userClient = createClient(supabaseUrl, anonKey, {
                        global: { headers: { Authorization: authHeader } }
                    })
                    const { data: { user } } = await userClient.auth.getUser()
                    if (user) {
                        userId = user.id
                        logger.info('Authenticated user resolved', { userId })
                    }
                }
            } catch {
                // Non-fatal: proceed as guest
                logger.info('Auth token invalid or missing — proceeding as guest')
            }
        }

        // =================================================================
        // 3. VERIFY EVENT IS PUBLISHED + WITHIN SALES WINDOW
        // =================================================================
        let eventQuery = supabaseAdmin
            .from('events')
            .select('id, name, slug, org_id, status')

        // Support both event_id and event_slug
        if (event_id) {
            eventQuery = eventQuery.eq('id', event_id)
        } else {
            eventQuery = eventQuery.eq('slug', event_slug)
        }

        const { data: event, error: eventError } = await eventQuery.single()

        if (eventError || !event) {
            logger.warn('Event not found', { event_id, event_slug })
            return errorResponse('Event not found', 'EVENT_NOT_FOUND', 404)
        }

        // Use resolved event.id for the rest of the function
        const resolvedEventId = event.id

        if (event.status !== 'published') {
            return errorResponse('Event is not available for purchase', 'EVENT_NOT_PUBLISHED', 403)
        }

        logger.info('Event verified', { name: event.name, org_id: event.org_id })

        // =================================================================
        // 3.5 B008: VALIDATE INVITATION TOKEN (if provided)
        // =================================================================
        let invitationValidation: any = null
        let invitedTicketTypeId: string | null = null

        if (invitation_token) {
            logger.info('Invitation token provided, validating...')

            // Validate the invitation token
            const { data: invValidation, error: invError } = await supabaseAdmin
                .rpc('validate_email_invitation', { _token: invitation_token })

            if (invError) {
                logger.error('Invitation validation failed', invError)
                // Don't block - just proceed without discount
            } else if (!invValidation?.valid) {
                logger.warn('Invalid invitation token', { error: invValidation?.error })
                // Return error for critical invitation issues
                if (invValidation?.error === 'ALREADY_CLAIMED') {
                    return errorResponse('Deze uitnodiging is al geclaimd', 'INVITATION_ALREADY_CLAIMED', 400)
                }
                // For other errors, proceed without discount
            } else {
                // Check if user email matches invitation email
                if (invValidation.recipient_email && email.toLowerCase() !== invValidation.recipient_email.toLowerCase()) {
                    logger.warn('Email mismatch for invitation', {
                        expected: invValidation.recipient_email,
                        provided: email
                    })
                    return errorResponse(
                        `Deze uitnodiging is voor ${invValidation.recipient_email}, niet ${email}`,
                        'INVITATION_EMAIL_MISMATCH',
                        403
                    )
                }

                // Store validated invitation info
                invitationValidation = invValidation
                invitedTicketTypeId = invValidation.ticket?.id

                logger.info('Invitation validated', {
                    invitationId: invValidation.invitation_id,
                    ticketTypeId: invitedTicketTypeId,
                    originalPrice: invValidation.ticket?.price
                })
            }
        }

        // =================================================================
        // 4. ATOMIC CAPACITY + PRICE VALIDATION (via RPC)
        // =================================================================
        const ticketItemsJsonb = hasTickets
            ? items!.map(item => ({
                ticket_type_id: item.ticket_type_id,
                quantity: item.quantity
              }))
            : []

        const productItemsJsonb = hasProducts
            ? product_items!.map(item => ({
                product_id: item.product_id,
                variant_id: item.variant_id || null,
                quantity: item.quantity
              }))
            : []

        // Use the new RPC that handles both tickets and products
        const { data: capacityResult, error: capacityError } = await supabaseAdmin
            .rpc('validate_checkout_with_products', {
                _event_id: resolvedEventId,
                _ticket_items: ticketItemsJsonb,
                _product_items: productItemsJsonb
            })

        if (capacityError) {
            logger.error('Capacity validation RPC failed', capacityError)
            // Fallback to old RPC if new one doesn't exist (schema cache issue)
            if (capacityError.code === 'PGRST202' || capacityError.message?.includes('not found')) {
                logger.warn('validate_checkout_with_products not found, falling back to validate_checkout_capacity')

                // Can only validate tickets with old RPC
                if (hasProducts) {
                    return errorResponse(
                        'Product checkout not available (migration pending)',
                        'PRODUCTS_NOT_AVAILABLE',
                        503
                    )
                }

                // Fall back to ticket-only validation
                const { data: ticketResult, error: ticketError } = await supabaseAdmin
                    .rpc('validate_checkout_capacity', {
                        _event_id: resolvedEventId,
                        _items: ticketItemsJsonb
                    })

                if (ticketError) {
                    return errorResponse('Capacity validation failed', 'CAPACITY_CHECK_ERROR', 500, ticketError.message)
                }

                if (!ticketResult || !ticketResult.valid) {
                    return errorResponse(
                        'Checkout validation failed',
                        'VALIDATION_FAILED',
                        409,
                        ticketResult?.details || 'Capacity or sales window check failed'
                    )
                }

                // Convert old format to new format
                const serverPrice: number = parseFloat(ticketResult.total_price.toString())
                const ticketDetails = ticketResult.details

                // Invitation gives ACCESS, NOT a discount - user pays full price!
                // Continue with order creation using ticket-only data at FULL PRICE
                return await createOrder({
                    supabaseAdmin,
                    logger,
                    event,
                    resolvedEventId,
                    userId,
                    email,
                    purchaser_name,
                    serverPrice,  // FULL PRICE - no discount!
                    originalPrice: serverPrice,
                    discountAmount: 0,  // NO DISCOUNT
                    ticketDetails,
                    productDetails: [],
                    req,
                    invitationToken: invitation_token,
                    invitedTicketTypeId
                })
            }

            return errorResponse('Capacity validation failed', 'CAPACITY_CHECK_ERROR', 500, capacityError.message)
        }

        if (!capacityResult || !capacityResult.valid) {
            logger.warn('Capacity validation failed', capacityResult)
            return errorResponse(
                'Checkout validation failed',
                'VALIDATION_FAILED',
                409,
                {
                    ticket_errors: capacityResult?.ticket_details?.filter((d: any) => d.reason) || [],
                    product_errors: capacityResult?.product_details?.filter((d: any) => d.reason) || []
                }
            )
        }

        const serverPrice: number = parseFloat(capacityResult.total_price.toString())
        const totalVat: number = capacityResult.total_vat != null
            ? parseFloat(capacityResult.total_vat.toString())
            : 0  // Fallback for old RPC without VAT
        const ticketDetails = capacityResult.ticket_details || []
        const productDetails = capacityResult.product_details || []

        logger.info('Capacity & pricing validated', {
            total_price: serverPrice,
            total_vat: totalVat,
            tickets: ticketDetails.filter((d: any) => d.status === 'OK').length,
            products: productDetails.filter((d: any) => d.status === 'OK').length
        })

        // Invitation gives ACCESS to buy, NOT a discount - user pays full price!
        // Continue with order creation at FULL PRICE
        return await createOrder({
            supabaseAdmin,
            logger,
            event,
            resolvedEventId,
            userId,
            email,
            purchaser_name,
            serverPrice,  // FULL PRICE - no discount!
            originalPrice: serverPrice,
            discountAmount: 0,  // NO DISCOUNT
            totalVat,
            ticketDetails,
            productDetails,
            req,
            invitationToken: invitation_token,
            invitedTicketTypeId
        })

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Unexpected error', message)
        return errorResponse('Internal server error', 'UNEXPECTED_ERROR', 500, message)
    }
})

/**
 * Create order and handle payment/free flow
 */
async function createOrder(params: {
    supabaseAdmin: any
    logger: any
    event: any
    resolvedEventId: string
    userId: string | null
    email: string
    purchaser_name?: string
    serverPrice: number
    originalPrice?: number      // B011: Same as serverPrice (no discount)
    discountAmount?: number     // B011: Always 0 (invitation = ACCESS, not discount)
    totalVat?: number           // S5a: Total VAT amount (back-calculated from inclusive prices)
    ticketDetails: any[]
    productDetails: any[]
    req: Request
    invitationToken?: string    // B008: Token for marking invitation claimed
    invitedTicketTypeId?: string | null  // B008: Which ticket type was invited
}) {
    const {
        supabaseAdmin,
        logger,
        event,
        resolvedEventId,
        userId,
        email,
        purchaser_name,
        serverPrice,
        originalPrice = serverPrice,
        discountAmount = 0,
        totalVat = 0,
        ticketDetails,
        productDetails,
        req,
        invitationToken,
        invitedTicketTypeId
    } = params

    // =================================================================
    // 5. GENERATE PUBLIC TOKEN
    // =================================================================
    const publicToken = generateToken()
    const publicTokenHash = await hashToken(publicToken)
    logger.info('Public token generated', { preview: publicToken.slice(0, 8) + '...' })

    // =================================================================
    // 6. CREATE ORDER
    // =================================================================
    // B011: Invitation gives ACCESS, not discount - metadata tracks invitation source only
    const orderMetadata: Record<string, any> = {}
    if (invitationToken) {
        orderMetadata.invitation_token = invitationToken
        orderMetadata.invited_ticket_type_id = invitedTicketTypeId
        orderMetadata.source = 'email_invitation'
        // Note: NO discount applied - user pays full price
    }

    const { data: order, error: orderError } = await supabaseAdmin
        .from('orders')
        .insert({
            event_id: resolvedEventId,
            org_id: event.org_id,  // Derived server-side from event
            user_id: userId,       // null for guests
            email: email,
            purchaser_name: purchaser_name || null,
            status: 'pending',
            subtotal_amount: originalPrice,      // B011: Full price (no discount)
            discount_amount: discountAmount,     // B011: Always 0 (no discount)
            total_amount: serverPrice,           // B011: Full price (user pays 100%)
            vat_amount: totalVat,               // S5a: Total VAT (back-calculated from inclusive prices)
            currency: 'EUR',
            public_token_hash: publicTokenHash,
            public_token_created_at: new Date().toISOString(),
            metadata: Object.keys(orderMetadata).length > 0 ? orderMetadata : null,
        })
        .select('id, status, total_amount, created_at')
        .single()

    if (orderError || !order) {
        logger.error('Failed to create order', orderError)
        return errorResponse('Failed to create order', 'ORDER_CREATE_FAILED', 500, orderError?.message)
    }

    logger.info('Order created', { orderId: order.id, total: order.total_amount })

    // =================================================================
    // 7. CREATE ORDER ITEMS (tickets + products)
    // =================================================================
    // Invitation gives ACCESS to buy, NOT a discount - full price for all items!
    const orderItemsPayload: any[] = []

    // Add ticket items at FULL PRICE with VAT breakdown
    for (const detail of ticketDetails) {
        if (detail.status === 'OK') {
            const vatPct = detail.vat_percentage != null ? parseFloat(detail.vat_percentage.toString()) : 21.00
            const lineTotal = parseFloat(detail.line_total.toString())
            const vatAmount = detail.vat_amount != null
                ? parseFloat(detail.vat_amount.toString())
                : Math.round(lineTotal * vatPct / (100 + vatPct) * 100) / 100  // Fallback calculation

            orderItemsPayload.push({
                order_id: order.id,
                ticket_type_id: detail.ticket_type_id,
                product_id: null,
                product_variant_id: null,
                quantity: detail.quantity,
                unit_price: parseFloat(detail.price.toString()),
                total_price: lineTotal,
                vat_percentage: vatPct,
                vat_amount: vatAmount,
            })
        }
    }

    // Add product items with VAT breakdown
    for (const detail of productDetails) {
        if (detail.status === 'OK') {
            const vatPct = detail.vat_percentage != null ? parseFloat(detail.vat_percentage.toString()) : 21.00
            const lineTotal = parseFloat(detail.line_total.toString())
            const vatAmount = detail.vat_amount != null
                ? parseFloat(detail.vat_amount.toString())
                : Math.round(lineTotal * vatPct / (100 + vatPct) * 100) / 100  // Fallback calculation

            orderItemsPayload.push({
                order_id: order.id,
                ticket_type_id: null,
                product_id: detail.product_id,
                product_variant_id: detail.variant_id || null,
                quantity: detail.quantity,
                unit_price: parseFloat(detail.price.toString()),
                total_price: lineTotal,
                vat_percentage: vatPct,
                vat_amount: vatAmount,
            })
        }
    }

    const { error: itemsError } = await supabaseAdmin
        .from('order_items')
        .insert(orderItemsPayload)

    if (itemsError) {
        logger.error('Failed to create order items', itemsError)
        // Rollback: mark order as failed
        await supabaseAdmin
            .from('orders')
            .update({ status: 'failed' })
            .eq('id', order.id)

        return errorResponse('Failed to create order items', 'ITEMS_CREATE_FAILED', 500, itemsError.message)
    }

    logger.info('Order items created', {
        ticketItems: ticketDetails.filter((d: any) => d.status === 'OK').length,
        productItems: productDetails.filter((d: any) => d.status === 'OK').length
    })

    // =================================================================
    // 8. AUDIT LOG
    // =================================================================
    try {
        await supabaseAdmin
            .from('audit_log')
            .insert({
                org_id: event.org_id,
                actor_user_id: userId,
                action: 'ORDER_CREATED',
                entity_type: 'order',
                entity_id: order.id,
                after_state: {
                    status: 'pending',
                    total_amount: serverPrice,
                    ticket_count: ticketDetails.filter((d: any) => d.status === 'OK').length,
                    product_count: productDetails.filter((d: any) => d.status === 'OK').length,
                    is_guest: !userId
                },
                metadata: { event_id: resolvedEventId, source: 'create-order-public' }
            })
    } catch {
        // Non-fatal: audit log failure should not block the flow
        logger.warn('Audit log insert failed (non-fatal)')
    }

    // =================================================================
    // 9. BRANCHING: Free vs Paid
    // =================================================================
    if (serverPrice === 0) {
        // FREE ORDER: issue tickets immediately
        logger.info('Free order detected — issuing tickets immediately')

        // Mark order as paid (free = instant)
        const { error: updateError } = await supabaseAdmin
            .from('orders')
            .update({ status: 'paid' })
            .eq('id', order.id)

        if (updateError) {
            logger.error('Failed to update order to paid', updateError)
        } else {
            logger.info('Order marked as paid (free)')
        }

        // Call issue-tickets function internally (only issues tickets, not products)
        const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ??
                               Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!

        let issuedTickets: any[] = []
        const hasTicketItems = ticketDetails.some((d: any) => d.status === 'OK')

        if (hasTicketItems) {
            try {
                const issueResponse = await fetch(`${supabaseUrl}/functions/v1/issue-tickets`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${serviceRoleKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ order_id: order.id })
                })

                if (issueResponse.ok) {
                    const issueData = await issueResponse.json()
                    issuedTickets = issueData.tickets || []
                    logger.info('Tickets issued for free order', { count: issuedTickets.length })
                } else {
                    logger.error('Failed to issue tickets for free order', await issueResponse.text())
                }
            } catch (issueErr) {
                logger.error('Issue tickets call failed', issueErr)
            }
        }

        // B008: Mark invitation as claimed if this was an invitation order
        if (invitationToken && issuedTickets.length > 0) {
            try {
                // Find the ticket ID for the invited ticket type
                const invitedTicket = issuedTickets.find((t: any) =>
                    t.ticket_type_id === invitedTicketTypeId
                )
                const ticketInstanceId = invitedTicket?.id || issuedTickets[0]?.id

                const { error: claimError } = await supabaseAdmin
                    .rpc('mark_invitation_claimed_by_order', {
                        _token: invitationToken,
                        _order_id: order.id,
                        _ticket_instance_id: ticketInstanceId
                    })

                if (claimError) {
                    logger.error('Failed to mark invitation as claimed', claimError)
                } else {
                    logger.info('Invitation marked as claimed', {
                        token: invitationToken.slice(0, 8) + '...',
                        orderId: order.id
                    })
                }
            } catch (claimErr) {
                logger.error('Mark invitation claimed failed', claimErr)
            }
        }

        return jsonResponse({
            success: true,
            message: invitationToken ? 'Order completed (invitation claimed)' : 'Order completed (free)',
            order: {
                id: order.id,
                status: 'paid',
                total_amount: 0,
                created_at: order.created_at,
            },
            public_token: publicToken,
            tickets: issuedTickets,
            products: productDetails.filter((d: any) => d.status === 'OK').map((d: any) => ({
                product_id: d.product_id,
                product_name: d.product_name,
                variant_id: d.variant_id,
                variant_name: d.variant_name,
                quantity: d.quantity
            }))
        }, 200)

    } else {
        // PAID ORDER: create Mollie payment session
        logger.info('Paid order — creating Mollie payment', { amount: serverPrice })

        const mollieApiKey = Deno.env.get('MOLLIE_API_KEY')
        if (!mollieApiKey) {
            logger.error('Missing MOLLIE_API_KEY')
            return errorResponse('Payment provider not configured', 'MISSING_MOLLIE_KEY', 500)
        }

        // Detect test mode (key starts with 'test_')
        const isTestMode = mollieApiKey.startsWith('test_')
        if (isTestMode) {
            logger.info('🧪 MOLLIE TEST MODE ACTIVE')
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        // Determine redirect URL: env var > origin header > default
        const frontendUrl = Deno.env.get('FRONTEND_URL')
        const origin = frontendUrl || req.headers.get('origin') || 'http://localhost:5173'

        // Format amount for Mollie: EUR value as string with 2 decimals
        const amountString = serverPrice.toFixed(2)

        // Build description with item summary
        const ticketCount = ticketDetails.filter((d: any) => d.status === 'OK').length
        const productCount = productDetails.filter((d: any) => d.status === 'OK').length
        let description = `Bestelling ${order.id.slice(0, 8)}`
        if (ticketCount > 0 && productCount > 0) {
            description += ` (${ticketCount} tickets, ${productCount} products)`
        } else if (ticketCount > 0) {
            description += ` (${ticketCount} tickets)`
        } else if (productCount > 0) {
            description += ` (${productCount} products)`
        }

        const molliePayload = {
            amount: {
                currency: 'EUR',
                value: amountString,
            },
            description,
            redirectUrl: `${origin}/e/${event.slug}/confirm?token=${publicToken}`,
            webhookUrl: `${supabaseUrl}/functions/v1/mollie-webhook`,
            metadata: {
                order_id: order.id,
                org_id: event.org_id,
                event_id: resolvedEventId,
                user_id: userId,
            },
        }

        let mollieData: any
        try {
            const mollieResponse = await fetch(MOLLIE_API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${mollieApiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(molliePayload),
            })

            mollieData = await mollieResponse.json()

            if (!mollieResponse.ok) {
                logger.error('Mollie API error', mollieData)
                return errorResponse(
                    'Payment provider error',
                    'MOLLIE_ERROR',
                    502,
                    mollieData.detail || 'Mollie API returned an error'
                )
            }
        } catch (mollieErr) {
            logger.error('Mollie API call failed', mollieErr)
            return errorResponse('Payment provider unreachable', 'MOLLIE_UNREACHABLE', 502)
        }

        logger.info('Mollie payment created', {
            mollieId: mollieData.id,
            status: mollieData.status,
            checkoutUrl: mollieData._links?.checkout?.href,
            hasLinks: !!mollieData._links,
            linkKeys: mollieData._links ? Object.keys(mollieData._links) : []
        })

        // Validate that Mollie returned a checkout URL
        const checkoutUrl = mollieData._links?.checkout?.href
        if (!checkoutUrl) {
            logger.error('Mollie did not return a checkout URL', {
                mollieId: mollieData.id,
                links: mollieData._links,
                fullResponse: JSON.stringify(mollieData).slice(0, 500)
            })
            return errorResponse(
                'Payment provider did not return checkout URL',
                'MOLLIE_NO_CHECKOUT_URL',
                502,
                { mollieId: mollieData.id, status: mollieData.status }
            )
        }

        // Store payment record
        const { error: paymentInsertError } = await supabaseAdmin
            .from('payments')
            .insert({
                org_id: event.org_id,
                order_id: order.id,
                provider: 'mollie',
                provider_payment_id: mollieData.id,
                amount: Math.round(serverPrice * 100),  // Store in cents
                currency: 'EUR',
                status: mollieData.status || 'open',
            })

        if (paymentInsertError) {
            logger.error('Failed to store payment record', paymentInsertError)
            // Critical: payment created at Mollie but not in DB
            // Return success anyway — webhook will reconcile
        }

        // Audit log: payment created
        try {
            await supabaseAdmin
                .from('audit_log')
                .insert({
                    org_id: event.org_id,
                    actor_user_id: userId,
                    action: 'PAYMENT_CREATED',
                    entity_type: 'payment',
                    entity_id: order.id,
                    after_state: { provider_payment_id: mollieData.id, status: mollieData.status },
                    metadata: { order_id: order.id }
                })
        } catch {
            logger.warn('Audit log failed (non-fatal)')
        }

        return jsonResponse({
            success: true,
            message: 'Order created — redirect to payment',
            order: {
                id: order.id,
                status: 'pending',
                total_amount: serverPrice,
                created_at: order.created_at,
            },
            payment: {
                provider: 'mollie',
                payment_id: mollieData.id,
                test_mode: isTestMode,
            },
            checkout_url: checkoutUrl,
            public_token: publicToken
        }, 200)
    }
}
