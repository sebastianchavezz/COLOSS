# Code Review: F006 S5 — Boekhoudkundige Verplichtingen

**Reviewer**: @reviewer
**Date**: 2026-02-19
**Files Reviewed**:
- `supabase/migrations/20260219200000_f006_s5a_vat_calculation.sql`
- `supabase/migrations/20260219200001_f006_s5b_platform_invoices_settlements.sql`
- `supabase/functions/create-order-public/index.ts` (order INSERT + order_items sections)
- `supabase/functions/_shared/accounting.ts`
- `supabase/functions/get-settlement-report/index.ts`
- `supabase/functions/get-accounting-export/index.ts`
- `supabase/functions/generate-platform-invoice/index.ts`

---

## Summary

The S5 upgrade is a well-structured, additive implementation. The core VAT back-calculation formula is mathematically correct, all new tables have RLS enabled with appropriate role restrictions, and the CSV export is properly BOM-prefixed. Three issues require fixes before this ships: a critical `SPLIT_PART` parsing bug that will produce wrong invoice sequence numbers, a security issue with debug-grade `console.log` leaking token previews in production auth logs, and a backwards-compatibility gap in older F013 SQL procedures that INSERT into `order_items` without providing the new `vat_amount` column — which is a `NOT NULL DEFAULT 0.00` column so it will not break writes, but it means those paths silently store zero VAT and will never be backfilled.

---

## Verdict

- [x] **APPROVED WITH COMMENTS** — Minor-to-medium issues must be addressed; core logic is sound. Do not ship the advisory-lock + SPLIT_PART bug to production.

---

## Critical Issues (Must Fix)

### Issue 1: SPLIT_PART extracts wrong invoice sequence part
**File**: `supabase/migrations/20260219200001_f006_s5b_platform_invoices_settlements.sql:496`
**Severity**: Critical
**Category**: Bug

**Problem**:
The invoice number is formatted as `INV-2026-0001` (format: `INV-{year}-{seq}`).
The line:
```sql
v_sequence := SPLIT_PART(v_invoice_number, '-', 3)::INT;
```
`SPLIT_PART` splits on `-` so parts are: `INV` (1), `2026` (2), `0001` (3).
Part 3 is `0001` which casts to `1` — this actually works by accident.

**BUT**: If the year is in the future and the number is e.g. `INV-2027-0042`, `SPLIT_PART` returns `0042` which casts to `42`. This is fine numerically. However the code has already assigned the sequence inside `next_platform_invoice_number` via `MAX(invoice_sequence) + 1` and returned it as part of the formatted string — then immediately re-parses the string. This is fragile: if the format ever changes (e.g. prefix becomes `FACT-2026-0001`), the part index breaks silently.

**Deeper bug**: `next_platform_invoice_number` returns the _number string_ but `generate_platform_invoice` needs the _integer sequence_. The RPC does not return the sequence separately. The re-parse works today, but is a latent bug.

**Suggested Fix**:
Change `next_platform_invoice_number` to return a composite type or use an OUT parameter:
```sql
-- Option A: Change RPC to return RECORD
CREATE OR REPLACE FUNCTION public.next_platform_invoice_number(_year INT)
RETURNS TABLE(invoice_number TEXT, invoice_sequence INT) ...

-- Option B: In generate_platform_invoice, query the sequence directly after insert
-- (since the UNIQUE constraint guarantees the number, query back after INSERT)
```
Alternatively, within `generate_platform_invoice`, derive `v_sequence` from `next_seq` before formatting, not by re-parsing the string:
```sql
-- Inside next_platform_invoice_number, expose v_next_seq somehow, OR
-- In generate_platform_invoice: query MAX(invoice_sequence)+1 directly
-- with the same advisory lock BEFORE calling next_platform_invoice_number
```

---

### Issue 2: Debug console.log leaks token previews in production
**File**: `supabase/functions/_shared/auth.ts:35-111`
**Severity**: Critical
**Category**: Security

**Problem**:
The shared `authenticateUser` function used by all protected Edge Functions contains 11 `console.log` statements at DEBUG level. These include:
- `token.substring(0, 50)` — partial token leak to log aggregator
- JWT header contents decoded and printed
- Whether env vars are set (useful to attacker if logs are compromised)
- Fallback user ID from manual JWT decode

These logs are present in every single protected endpoint: `get-settlement-report`, `get-accounting-export`, `generate-platform-invoice`. In Supabase, Edge Function logs are accessible via the dashboard and potentially via external log drains. Token previews in logs violate least-privilege principles.

**Suggested Fix**:
Remove or gate all `console.log` calls behind a debug flag:
```typescript
const DEBUG = Deno.env.get('AUTH_DEBUG') === 'true'
// ...
if (DEBUG) console.log('[auth] Token preview:', token.substring(0, 8) + '...')
```
At minimum, remove the token preview and JWT header dump entirely. They provide no production value.

---

## Warnings (Should Fix)

### Warning 1: Backfill is not fully idempotent for zero-price free orders
**File**: `supabase/migrations/20260219200000_f006_s5a_vat_calculation.sql:486-504`
**Severity**: Warning
**Category**: Data Integrity

**Problem**:
The backfill condition is:
```sql
WHERE oi.vat_amount = 0
  AND oi.total_price > 0
```
This correctly skips zero-price items. However, if an order item has `total_price > 0` and `vat_percentage = 0` (zero-VAT item, e.g. a service that is VAT-exempt), after backfill `vat_amount` will be set to `0` correctly. If the migration is re-run (which can happen in dev environments), these rows satisfy `vat_amount = 0` again and will be re-processed — but the result is the same `0`, so it is safe.

However: Items with `total_price = 0` (free tickets) are skipped entirely. Their `vat_percentage` remains `21.00` (the default) even though a `total_price = 0` item has no VAT. The backfill does not update `vat_percentage` for free items. This is a cosmetic issue (zero VAT is correct), but the `vat_percentage` of `21.00` on a free item is misleading in reports.

**Suggested Fix**:
Add a third UPDATE for zero-price items to set their `vat_percentage` correctly:
```sql
-- Backfill zero-price ticket items: set vat_percentage from source, vat_amount stays 0
UPDATE public.order_items oi
SET vat_percentage = COALESCE(tt.vat_percentage, 0.00)
FROM public.ticket_types tt
WHERE oi.ticket_type_id = tt.id
  AND oi.total_price = 0
  AND oi.vat_percentage = 21.00;  -- only where still at default
```

---

### Warning 2: F013 SQL procedures INSERT into order_items without VAT columns
**File**: `supabase/migrations/20260203200017_f013_fix_redirect_url.sql:245-259`
**File**: `supabase/migrations/20260203200018_f013_b008_paywall_paid_tickets.sql:457-471`
**File**: `supabase/migrations/20260203200010_f013_claim_use_base_url.sql:217-219`
**Severity**: Warning
**Category**: Backwards Compatibility

**Problem**:
Multiple F013 SQL stored procedures INSERT into `order_items` with only `(order_id, ticket_type_id, quantity, unit_price, total_price)`. After the S5a migration adds `vat_percentage NOT NULL DEFAULT 21.00` and `vat_amount NOT NULL DEFAULT 0.00`, these INSERTs will silently use the defaults. For invitation-claim flows (which always create free orders with `total_price = 0.00`), `vat_percentage = 21.00` and `vat_amount = 0.00` will be stored. The `vat_amount = 0` is correct for free items, but the backfill's `AND oi.total_price > 0` filter means these rows are never corrected. The VAT percentage of 21 on a free item is confusing.

These are not broken by the migration (defaults cover the gap), but the accounting export and settlement report will show `21%` VAT rate on free invitation items, which is semantically wrong.

**Suggested Fix**:
Update the F013 procedures to pass `vat_percentage = 0` for free-ticket claims, or update the backfill to also correct `vat_percentage` on zero-price items as described in Warning 1.

---

### Warning 3: generate_settlement computes fees on net revenue but settlement_lines use gross
**File**: `supabase/migrations/20260219200001_f006_s5b_platform_invoices_settlements.sql:377`
**Severity**: Warning
**Category**: Financial Logic

**Problem**:
Platform fees are computed as:
```sql
v_fees_excl := ROUND((v_gross_ticket + v_gross_product - v_total_refunds) * v_platform_fee_pct / 100, 2);
```
This is fees on _net revenue_ (after refunds). However in `generate_platform_invoice`, per-event fee items use:
```sql
ROUND(v_event.gross_revenue * v_platform_fee_pct / 100, 2)
```
This is fees on _gross revenue_ (before refunds). These two functions apply the fee to different bases — `generate_settlement` uses net, `generate_platform_invoice` uses gross. If there are refunds, the totals from an invoice and a settlement for the same period will not match.

**Suggested Fix**:
Decide on one definition and apply it consistently. If the platform charges fees on gross revenue (standard), change `generate_settlement` to:
```sql
v_fees_excl := ROUND((v_gross_ticket + v_gross_product) * v_platform_fee_pct / 100, 2);
```
And reflect the refund separately as a deduction. Or if fees are on net, update `generate_platform_invoice` to account for refunds per event.

---

### Warning 4: isOrgMember does not validate orgId format (SQL injection surface)
**File**: `supabase/functions/_shared/auth.ts:124-143`
**Severity**: Warning
**Category**: Security

**Problem**:
`isOrgMember` receives `orgId` directly from query params (in `get-settlement-report` and `get-accounting-export`) and uses it unvalidated in a `.eq('org_id', orgId)` call. The Supabase JS client uses parameterized queries, so there is no SQL injection risk at the database layer. However there is no UUID format validation, meaning a malformed `org_id` will simply return `false` (no member found) rather than a clear 400 error. This allows probing: attackers can send arbitrary strings and distinguish "no such org" from "not a member" by the response time.

**Suggested Fix**:
Validate UUID format before calling `isOrgMember`:
```typescript
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
if (!UUID_REGEX.test(orgId)) {
  return errorResponse('Invalid org_id format', 'INVALID_ORG_ID', 400)
}
```

---

### Warning 5: Platform company info update is fire-and-forget
**File**: `supabase/functions/generate-platform-invoice/index.ts:127-136`
**Severity**: Warning
**Category**: Bug

**Problem**:
The platform company info snapshot is written in a second UPDATE after the invoice is created and returned:
```typescript
await supabaseAdmin
  .from('platform_invoices')
  .update({ platform_company_name: ..., platform_vat_number: ..., ... })
  .eq('id', invoiceId)
```
The error is silently ignored — there is no `if (updateError)` check. If this UPDATE fails (e.g., column not found, network timeout), the invoice is returned to the client with empty company fields (`platform_vat_number: ''`, etc.). The response at line 157-159 reads from the _original_ `invoice` object fetched before the UPDATE, so the returned data will always show empty platform fields even when the UPDATE succeeds.

**Suggested Fix**:
1. Check the update error and log it.
2. Re-fetch the invoice after the update (or move the update to inside the RPC so it runs atomically), OR pass the platform info into the RPC so the INSERT includes it from the start.
3. Remove the second fetch/update anti-pattern entirely by including platform info in the initial INSERT via the RPC.

---

### Warning 6: get-settlement-report refunds query has no date filter
**File**: `supabase/functions/get-settlement-report/index.ts:140-151`
**Severity**: Warning
**Category**: Financial Logic

**Problem**:
The refunds query is:
```typescript
const { data: refunds } = await refundQuery
  .from('refunds')
  .select('amount_cents, orders!inner(org_id, event_id)')
  .eq('orders.org_id', orgId)
  .in('status', ['completed', 'pending'])
```
There is no date filter on refunds. The settlement report will include all-time refunds for the org, not just refunds within the requested `date_from`/`date_to` period. This means older refunds will inflate the `total_refunds` figure and deflate `net_payout` for any period query.

**Suggested Fix**:
Add date filtering to the refunds query:
```typescript
.gte('created_at', effectiveFrom)
.lte('created_at', effectiveTo + 'T23:59:59.999Z')
```

---

### Warning 7: accounting.ts calculatePlatformFee applies minimum before rounding
**File**: `supabase/functions/_shared/accounting.ts:65-69`
**Severity**: Warning
**Category**: Financial Logic

**Problem**:
```typescript
if (feeConfig.minimum_fee_per_order > 0 && feeExclVat < feeConfig.minimum_fee_per_order) {
  feeExclVat = feeConfig.minimum_fee_per_order
}
feeExclVat = Math.round(feeExclVat * 100) / 100
```
The minimum fee itself is not rounded. If `minimum_fee_per_order` is stored as e.g. `0.999` (unlikely but possible given `NUMERIC(10,2)` — this cannot happen with 2dp storage), this would produce a 3dp fee amount. This is a minor concern with the current DB schema (which uses `NUMERIC(10,2)`) but worth noting for robustness.

More importantly: the TypeScript `calculatePlatformFee` function is used client-side for display but the actual fee in `generate_settlement` is computed in SQL with different logic. If the fee_type is `flat` or `percentage_plus_flat`, the SQL `generate_settlement` RPC only uses `percentage_rate` (line 377 of S5b migration) and ignores `flat_fee_per_ticket`. The TS and SQL implementations are not in sync for `flat` and `percentage_plus_flat` fee types.

**Suggested Fix**:
Either update `generate_settlement` to handle all three fee types (matching the TS implementation), or document clearly that only `percentage` type is supported in the SQL path.

---

## Supabase Specific Findings

### RLS Policies

| Table | Has RLS | Policy Count | Issues |
|-------|---------|--------------|--------|
| `platform_fee_config` | Yes | 1 (SELECT) | No INSERT/UPDATE/DELETE policy — only service_role can write, which is correct |
| `platform_invoices` | Yes | 1 (SELECT) | Same — service_role only for writes |
| `platform_invoice_items` | Yes | 1 (SELECT via JOIN) | Correct pattern |
| `settlements` | Yes | 1 (SELECT) | Correct |
| `settlement_lines` | Yes | 1 (SELECT via JOIN) | Correct |
| `order_items` (modified) | Pre-existing | Pre-existing | New columns have defaults, existing policies unaffected |
| `orders` (modified) | Pre-existing | Pre-existing | New `vat_amount` column has default, backward safe |

All new tables have RLS enabled. All SELECT policies correctly restrict to `owner/admin/finance` roles — the `support` role is excluded as required. No authenticated user can write to these tables directly; all writes go through service_role in Edge Functions or SECURITY DEFINER RPCs.

### Auth Patterns

- All three new Edge Functions authenticate via `authenticateUser` + `isOrgMember` before data access. Pattern is consistent and correct.
- `generate-platform-invoice` uses POST with JSON body for the trigger action (correct — not a GET that could be triggered by a link follow).
- `get-accounting-export` and `get-settlement-report` are GET endpoints with query params. No CSRF risk since they require a Bearer token.
- `validate_checkout_with_products` RPC is granted only to `service_role` (line 420 of S5a). It is a SECURITY DEFINER function. Correct — it should not be callable by authenticated clients directly.
- `generate_settlement` and `generate_platform_invoice` RPCs are granted only to `service_role`. Correct.
- `next_platform_invoice_number` is granted only to `service_role`. Correct.

### Advisory Lock Analysis (Race Safety)

The advisory lock in `next_platform_invoice_number` uses:
```sql
PERFORM pg_advisory_xact_lock(hashtext('platform_invoice_' || _year::TEXT));
```

This is a transaction-level advisory lock (`pg_advisory_xact_lock`, not `pg_advisory_lock`). It will be released automatically when the transaction commits or rolls back. The lock key is derived from the year string, so different years do not block each other — this is correct behavior. The lock is acquired before the `MAX(invoice_sequence)` query, ensuring two concurrent calls for the same year will serialize correctly. **The advisory lock pattern is race-safe.**

One note: `hashtext` can theoretically collide for different inputs (it is a 32-bit hash), but in practice the lock key space is effectively unique for calendar year strings.

### Query Performance

- New index `idx_order_items_vat_percentage` on `order_items(vat_percentage)` is added. This index is of limited value — `vat_percentage` is very low cardinality (likely only 3-4 distinct values: 0, 9, 21). The index will rarely be used by the query planner for these settlement queries which filter on `org_id` + `status` + `created_at`. This index wastes storage and write overhead. Consider dropping it.
- `get-settlement-report` executes separate queries for ticket items and product items when a single query with conditional aggregation would suffice, reducing round trips.
- `get-accounting-export` performs N+2 additional queries (ticket names, product names) after the main order query. For large exports, this is a performance concern. The `in('id', Array.from(ticketTypeIds))` approach is fine as long as the Set does not exceed Supabase's URL length limits on the filter.

### VAT Calculation Verification

The formula `vat_amount = total_price * vat_percentage / (100 + vat_percentage)` is **mathematically correct** for back-calculating VAT from a VAT-inclusive price.

Example with 21% VAT and price 10.00 EUR:
- `vat = 10.00 * 21 / (100 + 21) = 210 / 121 = 1.7355...`
- Rounded to 2dp: `1.74`
- Excl. VAT: `10.00 - 1.74 = 8.26`
- Check: `8.26 * 1.21 = 9.9946` (rounding artefact of 0.0054)

The rounding is applied correctly at each line item level. The SQL uses `ROUND(..., 2)` and the TypeScript uses `Math.round(x * 100) / 100`. Both are consistent. No discrepancy found.

### refunds.amount_cents Division

In `generate_settlement` (S5b migration, line 367):
```sql
SELECT COALESCE(SUM(r.amount_cents), 0) / 100.0 INTO v_total_refunds
```
Division by `100.0` (not `100`) forces floating-point division in Postgres. Correct — integer division by `100` would truncate.

In `get-settlement-report` (line 151):
```typescript
const totalRefunds = (refunds || []).reduce((sum, r) => sum + (r.amount_cents || 0), 0) / 100
```
Correct — divides the summed integer cents by 100.

In `get-accounting-export` (line 161):
```typescript
const amount = (r.amount_cents || 0) / 100
```
Correct — per-refund conversion.

All three refund amount conversions are correct.

### CSV BOM for Excel Compatibility

```typescript
export const CSV_BOM = '\uFEFF'
// ...
const csvContent = CSV_BOM + rows.join('\r\n')
```

UTF-8 BOM (`\uFEFF`) is present. File uses `\r\n` line endings and semicolon delimiter. `Content-Type: text/csv; charset=utf-8` is set. This is correct for Dutch accounting software (Exact, Twinfield) which expect semicolon-delimited CSV with BOM.

### SQL Injection via Query Params

No SQL injection vulnerability. Query parameters are used only in `.eq()`, `.gte()`, `.lte()`, `.in()` Supabase JS client calls which generate parameterized queries. No raw SQL string interpolation exists in any Edge Function.

---

## Summary of Required Actions for @backend

| Priority | Issue | File | Action |
|----------|-------|------|--------|
| Critical | SPLIT_PART sequence re-parse is fragile | S5b migration line 496 | Refactor `next_platform_invoice_number` to avoid re-parsing the formatted string |
| Critical | console.log leaks token in auth.ts | `_shared/auth.ts:43` | Remove token preview and JWT decode logs, gate behind env flag |
| Should Fix | Settlement refunds query has no date filter | `get-settlement-report:140` | Add `gte`/`lte` date filters to refunds query |
| Should Fix | Fee base inconsistency (net vs gross) between `generate_settlement` and `generate_platform_invoice` | S5b migration lines 377, 539 | Align fee calculation base |
| Should Fix | Platform info UPDATE is fire-and-forget, response uses stale data | `generate-platform-invoice:127-136` | Check update error; re-fetch or move into RPC |
| Should Fix | F013 procedures leave vat_percentage=21 on free items | F013 migrations | Update backfill or F013 procedures for zero-price items |
| Low | Remove index `idx_order_items_vat_percentage` | S5a migration line 521 | Low-cardinality column, index wastes write overhead |
| Low | `calculatePlatformFee` TS vs SQL out of sync for flat/percentage_plus_flat | `accounting.ts:50-63` + S5b migration | Document or align |

