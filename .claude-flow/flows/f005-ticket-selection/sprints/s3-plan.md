# F005 S3: Subscription-Based Tickets for Clubs

**Status**: Complete
**Date**: 2026-02-19
**Joint Sprint**: F005 S3 + F006 S6

## Objective

Add subscription-based membership tickets for clubs (wielerverenigingen, sportgroepen).
Events get a mode: `event` (existing) or `club` (subscription-capable).
Ticket types in club-mode events support recurring billing via Mollie.

## What Was Built

### Database Schema
- `events.event_mode` column: `'event'` (default) or `'club'`
- `ticket_types` subscription fields: `is_subscription`, `billing_interval`, `billing_cycle_count`, `subscription_description`
- `mollie_customers` table: Maps auth users to Mollie Customer objects
- `subscriptions` table: Core subscription lifecycle tracking (pending_mandate → active → cancelled/completed)
- `subscription_payments` table: Each recurring payment audit trail

### RLS Security
- All 3 new tables: SELECT (user-owns + org-admin), INSERT/UPDATE/DELETE deny (service-role only)
- Partial unique index: One active subscription per user per ticket type

### RPC Functions
- `get_user_subscriptions()`: Lists subscriptions for authenticated user
- `handle_subscription_payment()`: Processes recurring payment (creates order, issues ticket, queues email)
- `cancel_subscription()`: Cancels with role-based authorization (owner/admin/self)
- `handle_subscription_failure()`: Handles failed payments (past_due, dunning email)

### Edge Functions
- `create-subscription-checkout`: First payment with Mollie sequenceType "first"
- `manage-subscription`: Cancel and list user subscriptions
- `mollie-webhook` (modified): Subscription payment detection + routing

### Mollie Integration
- Mollie Customer per user (reusable mandates)
- First payment → mandate creation → Mollie Subscription setup (automatic)
- Recurring payment detection via `subscriptionId` field
- Mollie `nextPaymentDate` used for period calculation

## Billing Intervals
- Monthly: `1 month`
- Quarterly: `3 months`
- Yearly: `1 year`
- Fixed-term: `billing_cycle_count` (e.g., 12 for monthly over 1 year)
- Open-ended: `billing_cycle_count = NULL`

## Key Decisions
1. Each subscription payment creates an order (audit trail)
2. Billing config copied to subscription row (immutable)
3. 7-day grace period on failed payments
4. Partial unique index (historical rows preserved)
5. Mollie Customer per user (not per subscription)
