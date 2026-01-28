# Sprint S1: Complete Checkout & Payment Flow

**Sprint**: F006-S1
**Date**: 2025-01-28
**Status**: 🟡 Active

## Scope

### Database Migration (1 migration)
1. Add `org_id` and `subtotal_amount` columns to `orders`
2. Add capacity validation RPC `validate_checkout_capacity`
3. Rewrite `handle_payment_webhook` to issue `ticket_instances` + queue confirmation email
4. Add `capacity_check` helper RPC for atomic capacity validation
5. Add cleanup trigger for pending orders older than 1 hour

### Edge Functions (2 functions updated/created)
1. **`create-order-public`** — Full guest checkout implementation:
   - Input validation (event_id, items, email, purchaser_name)
   - Event visibility & sales window check
   - Capacity pre-check
   - Server-side price calculation
   - Order + items creation with org_id
   - Public token generation (SHA-256 hashed)
   - Free order → immediate ticket issuance
   - Paid order → Mollie payment creation
   - Returns checkout_url or success confirmation

2. **`mollie-webhook`** — Enhanced webhook:
   - Issue `ticket_instances` on payment success (not just update old `tickets`)
   - Queue confirmation email via `email_outbox`
   - Overbooked failsafe: if capacity exceeded, mark order `overbooked`
   - Comprehensive audit logging

### Tests
- Integration test: create-order-public (valid, invalid event, sold out, free order)
- Integration test: mollie-webhook idempotency
- Integration test: capacity race condition
- RLS verification: anonymous cannot read orders directly

## Acceptance Criteria
- [x] Order created atomically with org_id
- [x] Capacity & sales window validated server-side
- [x] Payment provider integration (Mollie)
- [x] Webhook issues ticket_instances + queues email
- [x] Idempotency on webhook (payment_events deduplication)
- [x] Guest checkout via public token
- [x] Free order → immediate ticket issuance
- [x] Overbooked scenario handled (failsafe)

## Design Decisions
- Use `create-order-public` for ALL checkout (both guest and authenticated)
- Authenticated users get `user_id` set on order; guests get null
- `org_id` derived from event → org relationship (never trusted from client)
- Capacity check uses `FOR UPDATE SKIP LOCKED` for concurrency safety
- Public token: 32-byte random → base64url → SHA-256 hash stored in DB
