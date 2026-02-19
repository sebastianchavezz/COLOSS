# F010 S3: Subscription Dashboard - Review Report

**Date**: 2026-02-19
**Reviewer**: @reviewer

## Review Summary

| Category | Issues Found | Fixed |
|----------|-------------|-------|
| Critical | 3 | 3 |
| Warning | 6 | 4 |
| **Total** | **9** | **7** |

## Critical Issues (All Fixed)

### 1. Unbounded subscriber query (Performance)
**Problem**: `v_subscribers` query had no LIMIT, could return 50k+ rows in a single JSONB blob.
**Fix**: Added `ORDER BY s.created_at DESC LIMIT 100` to the inner query.

### 2. Dead variable `v_user_id`
**Problem**: Declared but never used, suggesting incomplete implementation.
**Fix**: Removed the unused declaration.

### 3. `auth.users` join security documentation
**Problem**: Direct `auth.users` join in SECURITY DEFINER function needs explicit documentation.
**Fix**: Added security comments at both join sites documenting that the caller is verified as org member.

## Warnings (Fixed)

### 4. Number() guard for NUMERIC values
**Problem**: PostgreSQL NUMERIC values may arrive as strings; `.toFixed(2)` would throw.
**Fix**: Wrapped all `.toFixed(2)` calls with `Number()` cast.

### 5. useEffect cleanup pattern
**Problem**: No abort/cleanup on unmount; loading not reset on org change.
**Fix**: Added `cancelled` flag pattern + `setLoading(true)` + `setError(null)` on each effect run.

### 6. Broad index replaced with composite
**Problem**: `idx_sub_payments_created` on `(created_at DESC)` alone was ineffective for the join-based query.
**Fix**: Replaced with `idx_sub_payments_sub_created ON (subscription_id, created_at DESC)`.

### 7. Type guard for subscription stats
**Problem**: Direct `as OrgSubscriptionStats` cast without shape validation.
**Fix**: Added `'summary' in subResult.data` guard before cast.

## Warnings (Accepted / Deferred)

### 8. MRR calculation duplication
**Accepted**: Two RPCs duplicate the MRR CASE expression. Extracting to a helper function would be cleaner but is deferred to avoid scope creep in this sprint.

### 9. `recent_payments` data fetched but not rendered
**Accepted**: The data is returned from the RPC but the UI only shows the subscriber table. The `recent_payments` data will be used in a future "Betalingsoverzicht" tab. Keeping it avoids a second RPC call later.

## Security Audit

| Check | Result |
|-------|--------|
| Org member check in RPC | Pass - `is_org_member()` called first |
| RLS on subscription tables | Pass - SELECT for user/org, deny INSERT/UPDATE/DELETE |
| No service_role in client | Pass |
| SECURITY DEFINER with search_path | Pass |
| auth.users access documented | Pass (after fix) |

## Backwards Compatibility

| Check | Result |
|-------|--------|
| Existing dashboard still works | Pass - `subscriptions` key is additive |
| Subscription section hidden when no subs | Pass - `hasSubscriptions` gate |
| TypeScript types backwards compatible | Pass - `subscriptions?` is optional |
| Existing tests unaffected | Pass |
