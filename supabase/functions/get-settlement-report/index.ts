/**
 * get-settlement-report Edge Function
 *
 * Returns a JSON settlement report for an organization.
 * Includes revenue by VAT rate, ticket summary, refund totals,
 * platform fees, and net payout calculation.
 *
 * Query params:
 *   - org_id (required)
 *   - event_id (optional) - filter by specific event
 *   - date_from (optional) - start date (YYYY-MM-DD)
 *   - date_to (optional) - end date (YYYY-MM-DD)
 *
 * Auth: org member with owner/admin/finance role
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { authenticateUser, isOrgMember } from '../_shared/auth.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'
import { calculateVatFromInclusive } from '../_shared/accounting.ts'

serve(async (req: Request) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  const logger = createLogger('get-settlement-report')
  logger.info('Function invoked')

  try {
    if (req.method !== 'GET') {
      return errorResponse('Method not allowed', 'METHOD_NOT_ALLOWED', 405)
    }

    // 1. Authenticate
    const { user, error: authError } = await authenticateUser(req)
    if (authError || !user) {
      return errorResponse('Unauthorized', authError || 'NO_USER', 401)
    }

    // 2. Parse query params
    const url = new URL(req.url)
    const orgId = url.searchParams.get('org_id')
    const eventId = url.searchParams.get('event_id')
    const dateFrom = url.searchParams.get('date_from')
    const dateTo = url.searchParams.get('date_to')

    if (!orgId) {
      return errorResponse('org_id is required', 'MISSING_ORG_ID', 400)
    }

    // 3. Verify org membership (owner/admin/finance)
    const supabaseAdmin = getServiceClient()
    const hasRole = await isOrgMember(supabaseAdmin, orgId, user.id, ['owner', 'admin', 'finance'])
    if (!hasRole) {
      return errorResponse('Insufficient permissions', 'FORBIDDEN', 403)
    }

    // 4. Build date filters
    const effectiveFrom = dateFrom || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const effectiveTo = dateTo || new Date().toISOString().split('T')[0]

    logger.info('Generating settlement report', { orgId, eventId, effectiveFrom, effectiveTo })

    // 5. Revenue by VAT rate (tickets)
    let ticketQuery = supabaseAdmin
      .from('order_items')
      .select('vat_percentage, total_price, vat_amount, quantity, ticket_type_id, orders!inner(org_id, status, event_id, created_at)')
      .eq('orders.org_id', orgId)
      .eq('orders.status', 'paid')
      .gte('orders.created_at', effectiveFrom)
      .lte('orders.created_at', effectiveTo + 'T23:59:59.999Z')
      .not('ticket_type_id', 'is', null)

    if (eventId) {
      ticketQuery = ticketQuery.eq('orders.event_id', eventId)
    }

    const { data: ticketItems, error: ticketError } = await ticketQuery

    if (ticketError) {
      logger.error('Failed to query ticket items', ticketError)
      return errorResponse('Failed to generate report', 'QUERY_ERROR', 500, ticketError.message)
    }

    // 6. Revenue by VAT rate (products)
    let productQuery = supabaseAdmin
      .from('order_items')
      .select('vat_percentage, total_price, vat_amount, quantity, product_id, orders!inner(org_id, status, event_id, created_at)')
      .eq('orders.org_id', orgId)
      .eq('orders.status', 'paid')
      .gte('orders.created_at', effectiveFrom)
      .lte('orders.created_at', effectiveTo + 'T23:59:59.999Z')
      .not('product_id', 'is', null)

    if (eventId) {
      productQuery = productQuery.eq('orders.event_id', eventId)
    }

    const { data: productItems, error: productError } = await productQuery

    if (productError) {
      logger.error('Failed to query product items', productError)
      return errorResponse('Failed to generate report', 'QUERY_ERROR', 500, productError.message)
    }

    // 7. Aggregate revenue by VAT rate
    const vatBreakdown: Record<string, { rate: number; ticketRevenue: number; productRevenue: number; ticketVat: number; productVat: number; ticketCount: number; productCount: number }> = {}

    for (const item of (ticketItems || [])) {
      const rate = parseFloat(item.vat_percentage?.toString() || '21')
      const key = rate.toFixed(2)
      if (!vatBreakdown[key]) {
        vatBreakdown[key] = { rate, ticketRevenue: 0, productRevenue: 0, ticketVat: 0, productVat: 0, ticketCount: 0, productCount: 0 }
      }
      vatBreakdown[key].ticketRevenue += parseFloat(item.total_price?.toString() || '0')
      vatBreakdown[key].ticketVat += parseFloat(item.vat_amount?.toString() || '0')
      vatBreakdown[key].ticketCount += item.quantity || 0
    }

    for (const item of (productItems || [])) {
      const rate = parseFloat(item.vat_percentage?.toString() || '21')
      const key = rate.toFixed(2)
      if (!vatBreakdown[key]) {
        vatBreakdown[key] = { rate, ticketRevenue: 0, productRevenue: 0, ticketVat: 0, productVat: 0, ticketCount: 0, productCount: 0 }
      }
      vatBreakdown[key].productRevenue += parseFloat(item.total_price?.toString() || '0')
      vatBreakdown[key].productVat += parseFloat(item.vat_amount?.toString() || '0')
      vatBreakdown[key].productCount += item.quantity || 0
    }

    // 8. Totals
    const grossTicketRevenue = (ticketItems || []).reduce((sum: number, i: any) => sum + parseFloat(i.total_price?.toString() || '0'), 0)
    const grossProductRevenue = (productItems || []).reduce((sum: number, i: any) => sum + parseFloat(i.total_price?.toString() || '0'), 0)
    const totalRevenue = grossTicketRevenue + grossProductRevenue

    // 9. Refund totals (scoped to the same period)
    let refundQuery = supabaseAdmin
      .from('refunds')
      .select('amount_cents, orders!inner(org_id, event_id)')
      .eq('orders.org_id', orgId)
      .in('status', ['completed', 'pending'])
      .gte('created_at', effectiveFrom)
      .lte('created_at', effectiveTo + 'T23:59:59.999Z')

    if (eventId) {
      refundQuery = refundQuery.eq('orders.event_id', eventId)
    }

    const { data: refunds } = await refundQuery
    const totalRefunds = (refunds || []).reduce((sum: number, r: any) => sum + (r.amount_cents || 0), 0) / 100

    // 10. Platform fees
    const { data: feeConfig } = await supabaseAdmin
      .from('platform_fee_config')
      .select('percentage_rate, vat_percentage')
      .eq('org_id', orgId)
      .lte('effective_from', effectiveTo)
      .order('effective_from', { ascending: false })
      .limit(1)
      .single()

    const feeRate = feeConfig?.percentage_rate || 5
    const feeVatRate = feeConfig?.vat_percentage || 21
    const netRevenue = totalRevenue - totalRefunds
    const platformFeesExcl = Math.round(Math.max(netRevenue * feeRate / 100, 0) * 100) / 100
    const platformFeesVat = Math.round(platformFeesExcl * feeVatRate / 100 * 100) / 100
    const platformFeesIncl = platformFeesExcl + platformFeesVat
    const netPayout = netRevenue - platformFeesIncl

    // 11. Return report
    return jsonResponse({
      period: { from: effectiveFrom, to: effectiveTo },
      event_id: eventId || null,
      revenue: {
        gross_ticket_revenue: Math.round(grossTicketRevenue * 100) / 100,
        gross_product_revenue: Math.round(grossProductRevenue * 100) / 100,
        total_revenue: Math.round(totalRevenue * 100) / 100,
      },
      vat_breakdown: Object.values(vatBreakdown).map(v => ({
        vat_rate: v.rate,
        ticket_revenue_incl_vat: Math.round(v.ticketRevenue * 100) / 100,
        ticket_vat_amount: Math.round(v.ticketVat * 100) / 100,
        ticket_count: v.ticketCount,
        product_revenue_incl_vat: Math.round(v.productRevenue * 100) / 100,
        product_vat_amount: Math.round(v.productVat * 100) / 100,
        product_count: v.productCount,
        total_revenue_incl_vat: Math.round((v.ticketRevenue + v.productRevenue) * 100) / 100,
        total_vat_amount: Math.round((v.ticketVat + v.productVat) * 100) / 100,
      })),
      refunds: {
        total_refunds: Math.round(totalRefunds * 100) / 100,
      },
      platform_fees: {
        fee_rate_percentage: feeRate,
        fees_excl_vat: platformFeesExcl,
        fees_vat_rate: feeVatRate,
        fees_vat_amount: platformFeesVat,
        fees_incl_vat: platformFeesIncl,
      },
      net_payout: Math.round(netPayout * 100) / 100,
    })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Unexpected error', message)
    return errorResponse('Internal server error', 'UNEXPECTED_ERROR', 500, message)
  }
})
