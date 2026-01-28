# Sprint S2: Cart + Quantity Limits

**Flow**: F005 Ticket Selection
**Sprint**: S2
**Date**: 2026-01-28
**Status**: In Progress

---

## Context

### S1 Completed (2025-01-27)
- Extended ticket_types with distance, category, visibility, max_per_participant
- Added ticket_type_i18n for translations
- Added ticket_time_slots for waves/start times
- Added ticket_team_config for team settings
- Settings domain: tickets.*
- RPCs for ticket configuration

### S2 Scope
Complete the ticket selection flow with:
1. **Quantity Validation** - Enforce max_per_participant limits
2. **Availability Display** - Show remaining capacity in real-time
3. **Enhanced Checkout UI** - Show extended ticket info (distance, category, slots)
4. **Cart Persistence** (optional) - Session-based cart

---

## Analysis: What's Missing

### 1. Frontend Enhancements
- PublicEventCheckout doesn't show:
  - Distance/category info
  - Time slots selection
  - Remaining capacity
  - Max per participant limits
  - Sold out visual state

### 2. Backend Validation
- Need RPC to validate order against:
  - `max_per_participant` limit
  - Ticket availability
  - Time slot capacity (if selected)

### 3. Time Slot Selection
- UI to select time slot when ordering
- Capacity tracking per slot

---

## Deliverables

| Component | Priority | Description |
|-----------|----------|-------------|
| get_ticket_availability RPC | HIGH | Returns availability + remaining capacity |
| validate_ticket_order RPC | HIGH | Pre-validates order before checkout |
| Enhanced Checkout UI | HIGH | Shows extended ticket info |
| Time Slot Selector | MEDIUM | Optional slot selection in checkout |
| Sold Out State | HIGH | Visual indicator + disabled selection |

---

## Database Changes

### RPC: get_ticket_availability

```sql
CREATE OR REPLACE FUNCTION get_ticket_availability(_event_id uuid)
RETURNS jsonb
-- Returns ticket types with:
-- - sold_count (from ticket_instances)
-- - available_count (capacity - sold)
-- - is_sold_out (boolean)
-- - max_per_participant
-- - time_slots with their availability
```

### RPC: validate_ticket_order

```sql
CREATE OR REPLACE FUNCTION validate_ticket_order(
  _items jsonb,  -- [{ticket_type_id, quantity, time_slot_id?}]
  _user_id uuid DEFAULT NULL
)
RETURNS jsonb
-- Validates:
-- - Total quantity <= capacity available
-- - Quantity per type <= max_per_participant
-- - Time slot capacity (if applicable)
-- Returns: {valid: true/false, errors: [...]}
```

---

## Frontend Changes

### PublicEventCheckout Enhancements

```typescript
// Enhanced ticket display
interface TicketTypeDisplay {
  id: string
  name: string
  description: string
  price: number
  currency: string
  // Extended fields
  distance_value: number | null
  distance_unit: string | null
  ticket_category: string
  max_per_participant: number | null
  // Availability
  capacity_total: number
  sold_count: number
  available_count: number
  is_sold_out: boolean
  // Time slots (if any)
  time_slots: TimeSlot[]
}

// UI changes:
// - Show "X of Y remaining"
// - Disable + button when max reached
// - Show SOLD OUT badge
// - Show distance badge (e.g., "21.1 km")
// - Time slot dropdown if available
```

---

## Acceptance Criteria

- [ ] Available capacity shown for each ticket type
- [ ] Sold out tickets visually disabled
- [ ] max_per_participant enforced in UI
- [ ] Time slot selection works (when slots exist)
- [ ] Order validation before checkout
- [ ] Error messages for validation failures
- [ ] Tests verify all limits

---

*Sprint S2 Plan - F005 Ticket Selection - 2026-01-28*
