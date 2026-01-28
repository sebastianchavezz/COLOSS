# Sprint S2: Review

**Flow**: F005 Ticket Selection
**Sprint**: S2
**Date**: 2026-01-28
**Status**: Complete

---

## Summary

Sprint S2 completes the ticket selection flow with real-time availability tracking, quantity limits enforcement, and an enhanced checkout UI.

---

## Deliverables

| Artifact | Status | Location |
|----------|--------|----------|
| S2 Plan | Done | `sprints/s2-plan.md` |
| S2 Architecture | Done | `sprints/s2-architecture.md` |
| SQL Migration | Done | `supabase/migrations/20250128160000_f005_s2_availability_rpcs.sql` |
| PublicEventCheckout Update | Done | `web/src/pages/public/PublicEventCheckout.tsx` |
| Integration Tests | Done (12/12) | `tests/s2-integration-tests.sql` |
| This Review | Done | `sprints/s2-review.md` |

---

## Database Changes

### New RPCs

1. **get_ticket_availability(_event_id uuid)** → jsonb
   - Returns all visible ticket types with availability info
   - Fields: sold_count, available_count, is_sold_out, on_sale
   - Extended fields: distance_value, distance_unit, ticket_category
   - Includes time_slots array
   - Granted to: anon, authenticated

2. **validate_ticket_order(_event_id uuid, _items jsonb)** → jsonb
   - Pre-validates order before checkout
   - Checks: capacity, max_per_participant, sales window, visibility
   - Returns: { valid: boolean, errors: [...] }
   - Error codes: NO_ITEMS, EVENT_NOT_FOUND, TICKET_TYPE_NOT_FOUND, TICKET_NOT_PUBLISHED, TICKET_NOT_VISIBLE, SALES_NOT_STARTED, SALES_ENDED, INSUFFICIENT_CAPACITY, EXCEEDS_MAX_PER_PARTICIPANT
   - Granted to: anon, authenticated

3. **get_ticket_type_with_availability(_ticket_type_id uuid)** → jsonb
   - Returns single ticket type with full details
   - Used for detail pages or price calculations
   - Granted to: anon, authenticated

---

## Frontend Changes

### PublicEventCheckout.tsx

Enhanced features:
- Uses `get_ticket_availability` RPC instead of direct table query
- Real-time availability display: "X van Y beschikbaar"
- Max per participant enforcement in quantity selector
- Sold out badge + disabled state
- "Binnenkort" badge for future sales
- "Verkoop gesloten" badge for ended sales
- "Nog X" badge for low stock (≤5)
- Distance badge (e.g., "10 km")
- Category badge (e.g., "individual", "team")
- Pre-checkout validation via `validate_ticket_order` RPC
- Translated error messages in Dutch

---

## Test Results

```
=== F005 S2 Integration Tests ===

TEST 1: get_ticket_availability returns ticket types       PASS
TEST 2: Availability shows correct sold/available counts   PASS
TEST 3: Sold out ticket shows correct state               PASS
TEST 4: Future ticket shows on_sale=false                 PASS
TEST 5: Ticket shows extended info (distance, category)   PASS
TEST 6: validate_ticket_order - valid order passes        PASS
TEST 7: validate_ticket_order - exceeds capacity fails    PASS
TEST 8: validate_ticket_order - exceeds max_per_participant fails  PASS
TEST 9: validate_ticket_order - future sales fails        PASS
TEST 10: validate_ticket_order - empty items fails        PASS
TEST 11: get_ticket_type_with_availability - returns single ticket  PASS
TEST 12: get_ticket_availability - non-existent event returns error  PASS

=== TEST SUMMARY ===
Tests Run: 12
Tests Passed: 12
Tests Failed: 0

ALL TESTS PASSED
```

---

## Acceptance Criteria

- [x] Available capacity shown for each ticket type
- [x] Sold out tickets visually disabled
- [x] max_per_participant enforced in UI
- [x] Time slot data returned (UI selection deferred to S3)
- [x] Order validation before checkout
- [x] Error messages for validation failures
- [x] Tests verify all limits

---

## Notes

- Time slot UI selection deferred to S3 (slots returned but UI picker not implemented)
- Cart persistence was descoped (optional feature)
- All RPC functions use SECURITY DEFINER with explicit search_path

---

*Sprint S2 Review - F005 Ticket Selection - 2026-01-28*
