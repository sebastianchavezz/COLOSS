# F005 S3 / F006 S6 - Subscription-Based Tickets Review

**Date**: 2026-02-19
**Reviewer**: @reviewer (automated)

## Review Summary

| Category | Score | Notes |
|----------|-------|-------|
| RLS SELECT policies | PASS | User-owns and org-admin patterns correct |
| RLS INSERT/UPDATE policies | PASS (fixed) | All 3 tables have deny policies for direct writes |
| Org admin role filtering | PASS (fixed) | cancel_subscription limited to owner/admin roles |
| NULL uid guard | PASS (fixed) | cancel_subscription rejects NULL auth.uid() |
| SQL injection risk | PASS | No string interpolation in SQL functions |
| Backwards compatibility | PASS | Existing one-time checkout path completely untouched |
| Webhook idempotency | PASS | Both payment_events + ON CONFLICT guards |
| handle_subscription_payment | PASS (fixed) | Added ON CONFLICT DO NOTHING for replay safety |
| Period calculation | PASS (fixed) | Uses Mollie's nextPaymentDate instead of hardcoded days |
| Re-subscribe safety | PASS (fixed) | Partial unique index, no row deletion |
| Mollie sequenceType "first" | PASS | Correctly implemented |
| Error logging | PASS | All paths log, user messages in Dutch |

## Issues Found & Fixed

### Critical (Fixed)
1. **Missing INSERT/UPDATE/DELETE RLS policies** - Added deny policies on all 3 new tables
2. **Authorization bypass in cancel_subscription** - Added role filter (owner/admin only) + NULL uid guard

### Warnings (Fixed)
3. **handle_subscription_payment not idempotent** - Added ON CONFLICT (mollie_payment_id) DO NOTHING
4. **Period calculation drift** - Now uses Mollie's nextPaymentDate from subscription response
5. **Re-subscribe deletes history** - Changed to partial unique index, preserves cancelled/completed rows

### Pre-existing (Not part of this PR)
- `_shared/auth.ts` fallback JWT decode bypasses server-side verification (tracked separately)

## Files Reviewed
- `supabase/migrations/20260220000000_f005_f006_subscriptions.sql`
- `supabase/functions/_shared/mollie.ts`
- `supabase/functions/create-subscription-checkout/index.ts`
- `supabase/functions/manage-subscription/index.ts`
- `supabase/functions/mollie-webhook/index.ts`
