/**
 * Accounting Helpers
 *
 * Shared utilities for VAT calculation, platform fee calculation,
 * Dutch number formatting, and CSV export helpers.
 *
 * Key design: Prices are VAT-inclusive (NL consumer standard).
 * VAT is back-calculated: vat = total * rate / (100 + rate)
 */

/**
 * Calculate VAT amount from a VAT-inclusive price
 *
 * @param totalInclVat - Price including VAT
 * @param vatPercentage - VAT rate (e.g. 21 for 21%)
 * @returns VAT amount rounded to 2 decimals
 */
export function calculateVatFromInclusive(totalInclVat: number, vatPercentage: number): number {
  if (vatPercentage <= 0 || totalInclVat <= 0) return 0
  return Math.round(totalInclVat * vatPercentage / (100 + vatPercentage) * 100) / 100
}

/**
 * Calculate price excluding VAT from inclusive price
 */
export function priceExclVat(totalInclVat: number, vatPercentage: number): number {
  return Math.round((totalInclVat - calculateVatFromInclusive(totalInclVat, vatPercentage)) * 100) / 100
}

/**
 * Calculate platform fee for an order/revenue amount
 *
 * @param grossRevenue - Total revenue (VAT-inclusive)
 * @param feeConfig - Platform fee configuration
 * @returns Fee breakdown
 */
export function calculatePlatformFee(
  grossRevenue: number,
  feeConfig: {
    fee_type: string
    percentage_rate: number
    flat_fee_per_ticket: number
    minimum_fee_per_order: number
    vat_percentage: number
  },
  ticketCount: number = 0
): { feeExclVat: number; feeVat: number; feeInclVat: number } {
  let feeExclVat = 0

  switch (feeConfig.fee_type) {
    case 'percentage':
      feeExclVat = grossRevenue * feeConfig.percentage_rate / 100
      break
    case 'flat':
      feeExclVat = feeConfig.flat_fee_per_ticket * ticketCount
      break
    case 'percentage_plus_flat':
      feeExclVat = (grossRevenue * feeConfig.percentage_rate / 100) + (feeConfig.flat_fee_per_ticket * ticketCount)
      break
    default:
      feeExclVat = grossRevenue * feeConfig.percentage_rate / 100
  }

  // Apply minimum
  if (feeConfig.minimum_fee_per_order > 0 && feeExclVat < feeConfig.minimum_fee_per_order) {
    feeExclVat = feeConfig.minimum_fee_per_order
  }

  feeExclVat = Math.round(feeExclVat * 100) / 100
  const feeVat = Math.round(feeExclVat * feeConfig.vat_percentage / 100 * 100) / 100
  const feeInclVat = feeExclVat + feeVat

  return { feeExclVat, feeVat, feeInclVat }
}

/**
 * Format a number as Dutch currency (€ 1.234,56)
 */
export function formatDutchCurrency(amount: number): string {
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
  }).format(amount)
}

/**
 * Format a number as Dutch decimal (1.234,56)
 */
export function formatDutchNumber(amount: number, decimals: number = 2): string {
  return new Intl.NumberFormat('nl-NL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount)
}

/**
 * Format a date as Dutch format (19-02-2026)
 */
export function formatDutchDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('nl-NL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

/**
 * Escape a value for CSV (semicolon-delimited)
 * Wraps in quotes if the value contains semicolons, quotes, or newlines
 */
export function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(';') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}

/**
 * Build a CSV row from values (semicolon-delimited)
 */
export function csvRow(values: (string | number | null | undefined)[]): string {
  return values.map(csvEscape).join(';')
}

/**
 * UTF-8 BOM for Excel compatibility
 */
export const CSV_BOM = '\uFEFF'
