# F006 S5: Boekhoudkundige Verplichtingen (Accounting Obligations)

**Status**: 🟡 Active
**Type**: Upgrade (additive, backwards compatible)

## Scope

Add VAT calculation, platform invoices, settlements, and accounting exports to F006 Checkout/Payment.

### S5a: BTW-berekening in Database
- Add `vat_percentage` + `vat_amount` to `order_items` and `orders`
- Update `validate_checkout_with_products` RPC to return VAT info
- Backfill existing orders
- Update `create-order-public` Edge Function to store VAT data

### S5b: Platform Invoices & Settlements
- `platform_fee_config` — fee configuration per org
- `platform_invoices` + `platform_invoice_items` — COLOSS invoices to organizers
- `settlements` + `settlement_lines` — payout summaries per event/period
- RPCs: generate_settlement, generate_platform_invoice, next_platform_invoice_number

### S5c: Edge Functions (Reports & Export)
- `get-settlement-report` — JSON settlement report
- `get-accounting-export` — CSV export (semicolon-delimited, UTF-8 BOM)
- `generate-platform-invoice` — generate and store invoice
- `_shared/accounting.ts` — VAT helpers, formatting, CSV escaping

## Key Decisions
- Prices are VAT-inclusive (standard NL consumer pricing)
- VAT is back-calculated: `vat_amount = total_price - (total_price / (1 + vat_percentage / 100))`
- COLOSS operates as agent (intermediary) — organizer is seller
- Platform fees always 21% VAT (NL services)
- `refunds.amount_cents` is integer — divide by 100 in reports

## Dependencies
- F006 S4 (Products Integration) — existing RPC
- F009 (Refund Flow) — refund amounts in reports
- Settings framework (payments domain) — org VAT/invoice settings

---

*Created: 2026-02-19*
