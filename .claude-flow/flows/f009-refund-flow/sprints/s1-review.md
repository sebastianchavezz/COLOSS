# F009 Sprint 1: Code Review

## Review Summary

| Area | Status | Notes |
|------|--------|-------|
| Database Schema | ✅ APPROVED | Proper constraints, indexes, RLS |
| Edge Function | ✅ APPROVED | Idempotent, proper error handling |
| Webhook | ✅ APPROVED | Extended correctly for refunds |
| Security | ✅ APPROVED | Auth checks, RLS policies |
| Audit Logging | ✅ APPROVED | Full audit trail |

## Detailed Review

### 1. Database Schema (20250128150000_f009_refunds.sql)

**Strengths:**
- ✅ `refund_status` enum with all Mollie statuses
- ✅ `refunds` table with proper foreign keys
- ✅ `idempotency_key` UNIQUE constraint prevents duplicates
- ✅ `amount_cents` stored as INTEGER (no floating point issues)
- ✅ `refund_items` for partial refund tracking
- ✅ Proper indexes on org_id, order_id, status
- ✅ `updated_at` trigger for automatic timestamps

**RLS Policies:**
- ✅ SELECT: Org admins/owners only
- ✅ INSERT: Org admins/owners only (WITH CHECK)
- ✅ UPDATE: service_role only (for webhook)
- ✅ refund_items follows parent refund permissions

### 2. Edge Function (create-refund/index.ts)

**Security:**
- ✅ Auth verification via user token
- ✅ Org membership check (admin/owner only)
- ✅ Order ownership verification
- ✅ No SQL injection risks (parameterized queries)

**Idempotency:**
- ✅ `idempotency_key` required
- ✅ Returns existing refund if key exists
- ✅ No duplicate Mollie API calls

**Error Handling:**
- ✅ Missing params → 400
- ✅ Order not found → 404
- ✅ Order not paid → 400
- ✅ Exceeds refundable → 400
- ✅ Mollie error → 502
- ✅ DB error → 500

**Amount Validation:**
- ✅ Calculates remaining refundable amount
- ✅ Prevents over-refunding
- ✅ Tracks pending refunds in calculation

### 3. Webhook Extension (mollie-webhook/index.ts)

**Refund Detection:**
- ✅ Detects refund IDs (re_xxx prefix)
- ✅ Separate handler function for clarity
- ✅ Re-fetches from Mollie API for verification

**Idempotency:**
- ✅ Uses payment_events table
- ✅ Unique constraint prevents duplicates
- ✅ Returns 200 for already-processed

**Status Handling:**
- ✅ Calls `handle_refund_webhook` RPC
- ✅ RPC handles ticket voiding for full refunds
- ✅ RPC queues email notification

### 4. RPCs

**get_order_refund_summary:**
- ✅ Permission check via org_members
- ✅ Returns comprehensive summary
- ✅ Includes pending refunds in calculations

**void_tickets_for_refund:**
- ✅ Only voids for full refunds
- ✅ Only voids when status = 'refunded'
- ✅ Prevents double-voiding
- ✅ Creates audit log entry

**handle_refund_webhook:**
- ✅ Maps Mollie statuses correctly
- ✅ Calls void_tickets_for_refund when appropriate
- ✅ Queues email notification
- ✅ Creates audit log entry

## Security Checklist

- [x] Authentication required for create-refund
- [x] Authorization check (org admin/owner)
- [x] RLS enabled on all tables
- [x] Service role used only in webhooks
- [x] No secrets in client responses
- [x] Idempotency prevents replay attacks
- [x] Amount validation prevents over-refunding
- [x] Mollie API verification in webhooks

## Recommendations

1. **Monitoring**: Add alerts for failed refunds
2. **Rate Limiting**: Consider adding rate limit on create-refund
3. **Testing**: Test with Mollie sandbox before production

## Verdict

**APPROVED** - Ready for deployment and testing.

---

*Reviewed: 2026-01-28*
