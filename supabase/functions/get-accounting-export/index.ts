/**
 * get-accounting-export Edge Function
 *
 * Returns a CSV (semicolon-delimited, UTF-8 BOM) accounting export
 * suitable for import into Dutch accounting software (Exact, Twinfield, etc.)
 *
 * Columns:
 *   Ordernummer, Datum, Evenement, Deelnemer, Email,
 *   Tickettype/Product, Aantal, Stukprijs excl. BTW,
 *   BTW-tarief, BTW-bedrag, Totaal incl. BTW,
 *   Restitutiestatus, Restitutiebedrag, Platformkosten
 *
 * Query params:
 *   - org_id (required)
 *   - event_id (optional)
 *   - date_from (optional, YYYY-MM-DD)
 *   - date_to (optional, YYYY-MM-DD)
 *   - locale (optional, nl/en, default: nl)
 *
 * Auth: org member with owner/admin/finance role
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors } from '../_shared/cors.ts'
import { errorResponse } from '../_shared/response.ts'
import { authenticateUser, isOrgMember } from '../_shared/auth.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'
import { csvRow, CSV_BOM, formatDutchDate, formatDutchNumber } from '../_shared/accounting.ts'
import { corsHeaders } from '../_shared/cors.ts'

const HEADERS_NL = [
  'Ordernummer', 'Datum', 'Evenement', 'Deelnemer', 'Email',
  'Type', 'Naam', 'Aantal', 'Stukprijs excl. BTW',
  'BTW-tarief (%)', 'BTW-bedrag', 'Totaal incl. BTW',
  'Restitutiestatus', 'Restitutiebedrag', 'Platformkosten'
]

const HEADERS_EN = [
  'Order Number', 'Date', 'Event', 'Participant', 'Email',
  'Type', 'Name', 'Quantity', 'Unit Price excl. VAT',
  'VAT Rate (%)', 'VAT Amount', 'Total incl. VAT',
  'Refund Status', 'Refund Amount', 'Platform Fee'
]

serve(async (req: Request) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  const logger = createLogger('get-accounting-export')
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
    const locale = url.searchParams.get('locale') || 'nl'

    if (!orgId) {
      return errorResponse('org_id is required', 'MISSING_ORG_ID', 400)
    }

    // 3. Verify org membership
    const supabaseAdmin = getServiceClient()
    const hasRole = await isOrgMember(supabaseAdmin, orgId, user.id, ['owner', 'admin', 'finance'])
    if (!hasRole) {
      return errorResponse('Insufficient permissions', 'FORBIDDEN', 403)
    }

    const effectiveFrom = dateFrom || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const effectiveTo = dateTo || new Date().toISOString().split('T')[0]

    logger.info('Generating accounting export', { orgId, eventId, effectiveFrom, effectiveTo, locale })

    // 4. Query orders with items
    let query = supabaseAdmin
      .from('orders')
      .select(`
        id, created_at, email, purchaser_name, status, total_amount, event_id,
        events!inner(name),
        order_items(
          id, ticket_type_id, product_id, quantity, unit_price, total_price,
          vat_percentage, vat_amount
        )
      `)
      .eq('org_id', orgId)
      .eq('status', 'paid')
      .gte('created_at', effectiveFrom)
      .lte('created_at', effectiveTo + 'T23:59:59.999Z')
      .order('created_at', { ascending: true })

    if (eventId) {
      query = query.eq('event_id', eventId)
    }

    const { data: orders, error: ordersError } = await query

    if (ordersError) {
      logger.error('Failed to query orders', ordersError)
      return errorResponse('Failed to generate export', 'QUERY_ERROR', 500, ordersError.message)
    }

    // 5. Get ticket type names
    const ticketTypeIds = new Set<string>()
    const productIds = new Set<string>()
    for (const order of (orders || [])) {
      for (const item of (order.order_items || [])) {
        if (item.ticket_type_id) ticketTypeIds.add(item.ticket_type_id)
        if (item.product_id) productIds.add(item.product_id)
      }
    }

    const ticketNameMap = new Map<string, string>()
    const productNameMap = new Map<string, string>()

    if (ticketTypeIds.size > 0) {
      const { data: ticketTypes } = await supabaseAdmin
        .from('ticket_types')
        .select('id, name')
        .in('id', Array.from(ticketTypeIds))
      for (const tt of (ticketTypes || [])) {
        ticketNameMap.set(tt.id, tt.name)
      }
    }

    if (productIds.size > 0) {
      const { data: products } = await supabaseAdmin
        .from('products')
        .select('id, name')
        .in('id', Array.from(productIds))
      for (const p of (products || [])) {
        productNameMap.set(p.id, p.name)
      }
    }

    // 6. Get refund data per order
    const orderIds = (orders || []).map((o: any) => o.id)
    const refundMap = new Map<string, { status: string; amount: number }>()

    if (orderIds.length > 0) {
      const { data: refunds } = await supabaseAdmin
        .from('refunds')
        .select('order_id, status, amount_cents')
        .in('order_id', orderIds)

      for (const r of (refunds || [])) {
        const existing = refundMap.get(r.order_id)
        const amount = (r.amount_cents || 0) / 100
        if (existing) {
          existing.amount += amount
        } else {
          refundMap.set(r.order_id, { status: r.status, amount })
        }
      }
    }

    // 7. Get platform fee rate
    const { data: feeConfig } = await supabaseAdmin
      .from('platform_fee_config')
      .select('percentage_rate')
      .eq('org_id', orgId)
      .lte('effective_from', effectiveTo)
      .order('effective_from', { ascending: false })
      .limit(1)
      .single()

    const feeRate = feeConfig?.percentage_rate || 5

    // 8. Build CSV
    const headers = locale === 'en' ? HEADERS_EN : HEADERS_NL
    const rows: string[] = [csvRow(headers)]

    for (const order of (orders || [])) {
      const eventName = (order as any).events?.name || ''
      const refund = refundMap.get(order.id)

      for (const item of (order.order_items || [])) {
        const isTicket = !!item.ticket_type_id
        const type = isTicket ? (locale === 'en' ? 'Ticket' : 'Ticket') : (locale === 'en' ? 'Product' : 'Product')
        const name = isTicket
          ? (ticketNameMap.get(item.ticket_type_id) || 'Unknown')
          : (productNameMap.get(item.product_id) || 'Unknown')

        const vatPct = parseFloat(item.vat_percentage?.toString() || '21')
        const totalInclVat = parseFloat(item.total_price?.toString() || '0')
        const vatAmount = parseFloat(item.vat_amount?.toString() || '0')
        const unitPriceExcl = item.quantity > 0
          ? Math.round((totalInclVat - vatAmount) / item.quantity * 100) / 100
          : 0
        const platformFee = Math.round(totalInclVat * feeRate / 100 * 100) / 100

        rows.push(csvRow([
          order.id.slice(0, 8),
          formatDutchDate(order.created_at),
          eventName,
          order.purchaser_name || '',
          order.email || '',
          type,
          name,
          item.quantity,
          formatDutchNumber(unitPriceExcl),
          formatDutchNumber(vatPct),
          formatDutchNumber(vatAmount),
          formatDutchNumber(totalInclVat),
          refund ? refund.status : '',
          refund ? formatDutchNumber(refund.amount) : '',
          formatDutchNumber(platformFee),
        ]))
      }
    }

    const csvContent = CSV_BOM + rows.join('\r\n')

    logger.info('Export generated', { orderCount: orders?.length || 0, rowCount: rows.length - 1 })

    // 9. Return CSV with proper headers
    const filename = `boekhouding_${effectiveFrom}_${effectiveTo}.csv`

    return new Response(csvContent, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Unexpected error', message)
    return errorResponse('Internal server error', 'UNEXPECTED_ERROR', 500, message)
  }
})
