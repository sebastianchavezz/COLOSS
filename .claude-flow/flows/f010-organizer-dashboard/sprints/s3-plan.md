# F010 S3: Subscription Management in Organizer Dashboard

**Status**: In Progress
**Date**: 2026-02-19
**Upgrade Type**: Add subscription management to organizer dashboard

## Objective

Add subscription management capabilities to the organizer dashboard so club/event organizers can:
- See subscription KPIs (active subs, MRR, churn)
- View all subscribers with status
- Cancel subscriptions from the admin panel
- See subscription payment history

## Dependencies

- **Requires**: F005 S3 (subscription tables), F006 S6 (subscription checkout), F010 S2 (dashboard UI)
- All dependencies are complete.

## What Will Be Built

### Database (Migration)
1. **New RPC**: `get_org_subscription_stats(_org_id)` - Returns:
   - Summary: total active, past_due, cancelled, completed, MRR
   - Per-event breakdown: subscriptions grouped by event
   - Subscriber list: all subscriptions with user email, status, amount, dates
   - Recent subscription payments
2. **Updated RPC**: `get_org_dashboard_stats` - Add `subscriptions` to summary

### Frontend
1. **Types**: Add `SubscriptionStats`, `SubscriberRow` types to `dashboard.ts`
2. **UI**: Add subscription stats cards + subscriber table to `OrgDashboard.tsx`

### Backwards Compatibility
- Existing dashboard RPC extended (additive, non-breaking)
- New RPC is opt-in (separate call)
- UI shows subscription section only when org has club-mode events

## Acceptance Criteria

- [ ] `get_org_subscription_stats` returns correct data
- [ ] `get_org_dashboard_stats` includes subscription summary
- [ ] Dashboard shows subscription KPIs (active, MRR, past_due)
- [ ] Subscriber table lists all subscriptions
- [ ] RLS enforced (org members only)
- [ ] Backwards compatible (no existing functionality broken)
- [ ] Tests passing
