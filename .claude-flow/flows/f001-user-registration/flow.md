# F001: User Registration

## Status: 🟢 Done

## Summary

Post-purchase user/participant registration flow. When an order is paid, automatically:
1. Upsert participant (auth user or guest)
2. Create/confirm registration for the event
3. Link tickets to participant
4. Queue confirmation email via outbox

## Dependencies

- Requires: F006 (Checkout/Payment) - ✅ Done
- Requires: F008 (Communication/Outbox) - ✅ Done
- Enables: F002 (User Login), F007 (Ticket Delivery)

## Deliverables

| Artifact | Status | Location |
|----------|--------|----------|
| Sprint Plan | ✅ Done | `sprints/s1-plan.md` |
| Architecture | ✅ Done | `sprints/s1-architecture.md` |
| SQL Migration | ✅ Done | `supabase/migrations/20250128130000_f001_registration_enhancements.sql` |
| Integration Tests | ✅ Done (12/12) | `tests/integration-tests.mjs` |
| Review | ✅ Approved | `sprints/s1-review.md` |

## Database Changes

### Existing Tables (Layer 3)
- `participants` - Already exists, needs enhancements
- `registrations` - Already exists, needs order_id link
- `registration_answers` - Already exists

### New/Modified Columns
- `registrations.order_id` - Link registration to order
- `ticket_instances.participant_id` - Link ticket to participant

### New RPC Functions
- `sync_registration_on_payment(order_id)` - Idempotent post-purchase sync

### New Views
- `organiser_registrations_view` - Aggregated view for organizer dashboard

## Edge Functions

None new - uses existing checkout webhook flow.

## Acceptance Criteria

1. When order.status -> 'paid', participant is upserted (email + name from order)
2. Registration is created/confirmed for the event with status 'confirmed'
3. All ticket_instances for the order get linked to the participant
4. Outbox event 'REGISTRATION_CONFIRMATION' is created
5. Organizer can view registrations per event with filters
6. Idempotent: duplicate webhook calls don't create duplicates

---

*Created: 2026-01-28*
