# F009 S2 Review: Refund Flow Waterdicht

## Review Status: APPROVED

## Critical Fix
The **entire refund webhook chain was broken** because `mollie-webhook/index.ts` used `GET /v2/refunds/{id}` which does NOT exist in Mollie's API. The correct endpoint is `GET /v2/payments/{paymentId}/refunds/{refundId}`.

### Fix approach
1. Look up the refund in local DB first to get `mollie_payment_id`
2. Use `mollie_payment_id` to construct correct Mollie API URL
3. If refund not found in local DB, return 200 (security best practice)

## Changes

### mollie-webhook/index.ts (handleRefundWebhook)
- **Before**: `GET /v2/refunds/${mollieRefundId}` → 404 → silent 200 → chain broken
- **After**: DB lookup → `GET /v2/payments/${paymentId}/refunds/${refundId}` → full chain works

### create-refund/index.ts
- Fixed status mapping: `failed` and `canceled` are now correctly mapped (were both mapped to `processing`)

### handle_refund_webhook RPC (migration)
- Added order status transition: `paid → refunded` on full refund completion
- Added `order_refunded` field in return JSONB

## Security Checklist
- [x] Mollie API re-verification still enforced (never trust webhook payload)
- [x] Unknown refund IDs return 200 (no info leakage)
- [x] Idempotency via payment_events table preserved
- [x] void_tickets_for_refund already fixed in F006 S7
- [x] Email notification chain verified (queue_refund_confirmation_email exists)

## Complete Chain (Fixed)
```
Organizer → create-refund → Mollie API → webhook →
  DB lookup (get paymentId) → Mollie verify →
  handle_refund_webhook RPC → void tickets + update order →
  queue_refund_confirmation_email → process-outbox → email sent
```

## Audit Log
The audit_log INSERT uses `resource_type`/`resource_id`/`details` which DO exist in the remote schema (verified via db dump). Both column sets (`resource_*` and `entity_*`) are present.
