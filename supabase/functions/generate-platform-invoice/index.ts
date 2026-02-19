/**
 * generate-platform-invoice Edge Function
 *
 * Generates a platform invoice for an organization over a specified period.
 * Aggregates revenue per event, calculates platform fees, generates
 * sequential invoice number, stores invoice in DB.
 *
 * POST body:
 *   - org_id (required)
 *   - period_start (required, YYYY-MM-DD)
 *   - period_end (required, YYYY-MM-DD)
 *   - event_ids (optional, UUID[])
 *
 * Returns JSON with invoice details (frontend renders as PDF).
 *
 * Auth: org member with owner/admin/finance role
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { authenticateUser, isOrgMember } from '../_shared/auth.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

// COLOSS company info from env vars (or defaults for dev)
function getPlatformInfo() {
  return {
    company_name: Deno.env.get('PLATFORM_COMPANY_NAME') || 'COLOSS B.V.',
    vat_number: Deno.env.get('PLATFORM_VAT_NUMBER') || '',
    kvk_number: Deno.env.get('PLATFORM_KVK_NUMBER') || '',
    address: Deno.env.get('PLATFORM_ADDRESS') || '',
    iban: Deno.env.get('PLATFORM_IBAN') || '',
  }
}

serve(async (req: Request) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  const logger = createLogger('generate-platform-invoice')
  logger.info('Function invoked')

  try {
    if (req.method !== 'POST') {
      return errorResponse('Method not allowed', 'METHOD_NOT_ALLOWED', 405)
    }

    // 1. Authenticate
    const { user, error: authError } = await authenticateUser(req)
    if (authError || !user) {
      return errorResponse('Unauthorized', authError || 'NO_USER', 401)
    }

    // 2. Parse body
    let body: any
    try {
      body = await req.json()
    } catch {
      return errorResponse('Invalid JSON', 'INVALID_JSON', 400)
    }

    const { org_id, period_start, period_end, event_ids } = body

    if (!org_id) {
      return errorResponse('org_id is required', 'MISSING_ORG_ID', 400)
    }
    if (!period_start || !period_end) {
      return errorResponse('period_start and period_end are required', 'MISSING_PERIOD', 400)
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRegex.test(period_start) || !dateRegex.test(period_end)) {
      return errorResponse('Dates must be in YYYY-MM-DD format', 'INVALID_DATE_FORMAT', 400)
    }

    if (period_end < period_start) {
      return errorResponse('period_end must be >= period_start', 'INVALID_PERIOD', 400)
    }

    // 3. Verify org membership
    const supabaseAdmin = getServiceClient()
    const hasRole = await isOrgMember(supabaseAdmin, org_id, user.id, ['owner', 'admin', 'finance'])
    if (!hasRole) {
      return errorResponse('Insufficient permissions', 'FORBIDDEN', 403)
    }

    logger.info('Generating platform invoice', { org_id, period_start, period_end, event_ids })

    // 4. Call the RPC to generate invoice (handles numbering + items + totals)
    const { data: invoiceId, error: rpcError } = await supabaseAdmin
      .rpc('generate_platform_invoice', {
        _org_id: org_id,
        _period_start: period_start,
        _period_end: period_end,
        _event_ids: event_ids || null,
      })

    if (rpcError) {
      logger.error('Invoice generation RPC failed', rpcError)
      return errorResponse('Failed to generate invoice', 'INVOICE_GENERATION_FAILED', 500, rpcError.message)
    }

    if (!invoiceId) {
      return errorResponse('Invoice generation returned no ID', 'NO_INVOICE_ID', 500)
    }

    // 5. Fetch the complete invoice with items
    const { data: invoice, error: fetchError } = await supabaseAdmin
      .from('platform_invoices')
      .select(`
        *,
        platform_invoice_items(*)
      `)
      .eq('id', invoiceId)
      .single()

    if (fetchError || !invoice) {
      logger.error('Failed to fetch generated invoice', fetchError)
      return errorResponse('Failed to fetch invoice', 'FETCH_FAILED', 500)
    }

    // 6. Enrich with platform company info
    const platformInfo = getPlatformInfo()

    // Update invoice with platform company snapshot and re-fetch
    const { error: updateError } = await supabaseAdmin
      .from('platform_invoices')
      .update({
        platform_company_name: platformInfo.company_name,
        platform_vat_number: platformInfo.vat_number,
        platform_kvk_number: platformInfo.kvk_number,
        platform_address: platformInfo.address,
      })
      .eq('id', invoiceId)

    if (updateError) {
      logger.warn('Failed to update platform info on invoice (non-fatal)', updateError)
    }

    // 7. Return complete invoice data
    return jsonResponse({
      success: true,
      invoice: {
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        period: {
          start: invoice.period_start,
          end: invoice.period_end,
        },
        amounts: {
          subtotal: parseFloat(invoice.subtotal_amount),
          vat_percentage: parseFloat(invoice.vat_percentage),
          vat_amount: parseFloat(invoice.vat_amount),
          total: parseFloat(invoice.total_amount),
        },
        status: invoice.status,
        platform: {
          company_name: platformInfo.company_name,
          vat_number: platformInfo.vat_number,
          kvk_number: platformInfo.kvk_number,
          address: platformInfo.address,
          iban: platformInfo.iban,
        },
        organization: {
          company_name: invoice.org_company_name,
          vat_number: invoice.org_vat_number,
          kvk_number: invoice.org_kvk_number,
          address: invoice.org_address,
        },
        items: (invoice.platform_invoice_items || []).map((item: any) => ({
          id: item.id,
          event_id: item.event_id,
          description: item.description,
          order_count: item.order_count,
          ticket_count: item.ticket_count,
          gross_revenue: parseFloat(item.gross_revenue),
          fee_amount: parseFloat(item.fee_amount),
        })),
        created_at: invoice.created_at,
      },
    })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Unexpected error', message)
    return errorResponse('Internal server error', 'UNEXPECTED_ERROR', 500, message)
  }
})
