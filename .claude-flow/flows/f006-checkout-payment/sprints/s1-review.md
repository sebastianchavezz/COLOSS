# Review: F006-S1 Checkout & Payment

**Reviewer**: @reviewer
**Date**: 2025-01-28
**Verdict**: ✅ APPROVED

## Changes Reviewed

### Migration: 20250128100000_f006_checkout_payment.sql
- ✅ `orders.org_id` added with FK to orgs (server-derived, never client-trusted)
- ✅ `orders.subtotal_amount` and `discount_amount` for pricing transparency
- ✅ `validate_checkout_capacity` RPC uses `FOR UPDATE SKIP LOCKED` — correct concurrency pattern
- ✅ Sales window validation (sales_start/sales_end) checked inside capacity RPC
- ✅ `handle_payment_webhook` rewritten:
  - Atomic: locks order row with `FOR UPDATE`
  - Issues `ticket_instances` (new model) not just updates old `tickets`
  - Queues confirmation email via `email_outbox` (exactly-once delivery)
  - Overbooked failsafe: if capacity exceeded at webhook time, order cancelled
  - Backward-compatible: still updates legacy `tickets` + `registrations`
- ✅ `cleanup_stale_pending_orders` — safe helper for cron-based cleanup
- ✅ All RPCs use `SECURITY DEFINER` + explicit `GRANT EXECUTE TO service_role`

### Edge Function: create-order-public/index.ts
- ✅ No authentication required (works for guests)
- ✅ Optional Bearer token → resolves user_id (non-fatal if invalid)
- ✅ Event status check: must be 'published'
- ✅ Server-side price calculation via RPC (never trusts client prices)
- ✅ Atomic capacity pre-check via `validate_checkout_capacity` RPC
- ✅ `org_id` derived from event (never from client payload)
- ✅ Public token: 32-byte random → base64url → SHA-256 hash stored
- ✅ Free order branching: immediate ticket issuance
- ✅ Paid order branching: Mollie payment creation with metadata
- ✅ Audit logging for order creation + payment creation
- ✅ Input validation: email format, quantity bounds, items limit (max 20)
- ✅ Proper error codes (400/403/404/409/502/500) with structured responses

### Edge Function: mollie-webhook/index.ts
- ✅ Re-fetches from Mollie API (never trusts webhook payload)
- ✅ Idempotency: payment_events unique constraint on (provider, provider_event_id)
- ✅ Returns 200 for duplicates (stops Mollie retries)
- ✅ Returns 500 for transient errors (Mollie will retry)
- ✅ Logs overbooked scenario with full context
- ✅ Marks event as processed after successful RPC call

## Security Assessment

| Risk | Mitigation | Status |
|------|-----------|--------|
| Price manipulation | Server calculates prices from DB | ✅ |
| Capacity race condition | FOR UPDATE SKIP LOCKED + final check in webhook | ✅ |
| Webhook spoofing | Re-fetch from Mollie API with Bearer key | ✅ |
| Double webhook | Idempotency via payment_events unique constraint | ✅ |
| RLS bypass | Service role only in Edge Functions | ✅ |
| Public token leak | SHA-256 hashed before storage | ✅ |
| Order data exposure | RLS default deny + Edge-only public access | ✅ |
| Free order spam | Anti-spam: max 20 items, email validation | ✅ |
| Stale pending orders | cleanup_stale_pending_orders after 1 hour | ✅ |

## Minor Suggestions (Non-blocking)
- Consider adding CAPTCHA/rate limiting on `create-order-public` for production
- Consider adding `order_id` to audit_log for payment_created events (currently uses entity_id)
- Consider tracking overbooked orders in a dedicated alert table for ops team
