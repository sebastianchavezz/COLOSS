# Flow: Ticket Selection

**ID**: F005
**Status**: 🟢 Done
**Total Sprints**: 2
**Current Sprint**: Done

## Sprints
| Sprint | Focus | Status |
|--------|-------|--------|
| S1 | Atleta-style ticket configuration | 🟢 Complete |
| S2 | Cart + quantity limits | 🟢 Complete |

## Dependencies
- **Requires**: F004
- **Blocks**: F006

## Overview

Bezoekers kunnen tickets selecteren met real-time availability tracking.
Atleta-style configuratie met distance info, i18n, time slots, en team config.

```
Als bezoeker
Wil ik tickets kunnen selecteren
Zodat ik me kan inschrijven voor een evenement
```

## Flow Diagram

```
[Event Detail] → [View Ticket Types]
                        │
                        ▼
                [Select Quantity]
                  (+ time slot)
                  (+ team info)
                        │
                        ▼
                [Add to Cart] → [Cart Summary]
                                      │
                                      ▼
                                [Checkout]
```

## Supabase

### Tables
| Table | Purpose |
|-------|---------|
| `ticket_types` | Ticket type definitions (extended with distance, category, visibility) |
| `ticket_type_i18n` | Internationalized content (name, description, instructions) |
| `ticket_time_slots` | Start times/waves per ticket type |
| `ticket_team_config` | Team configuration (min/max size, captain) |
| `ticket_instances` | Issued tickets |

### RLS Policies
| Policy | Table | Rule |
|--------|-------|------|
| `public_read` | `ticket_types` | `event.status = 'published' AND visibility = 'visible'` |
| `org_admin_manage` | `ticket_type_i18n` | Org admin/owner |
| `org_admin_manage` | `ticket_time_slots` | Org admin/owner |
| `org_admin_manage` | `ticket_team_config` | Org admin/owner |
| `public_read` | `ticket_*` | Published tickets only |

### RPC Functions
| Function | Purpose |
|----------|---------|
| `get_ticket_type_full` | Complete ticket config with i18n, slots, team |
| `get_event_ticket_types` | List tickets with availability counts |
| `get_ticket_availability` | Real-time availability for all ticket types |
| `validate_ticket_order` | Pre-validate order before checkout |
| `get_ticket_type_with_availability` | Single ticket type details |
| `update_ticket_type_extended` | Update extended fields |
| `upsert_ticket_type_i18n` | Manage translations |
| `upsert_ticket_time_slot` | Create/update time slot |
| `delete_ticket_time_slot` | Soft delete time slot |
| `upsert_ticket_team_config` | Manage team settings |
| `get_ticket_time_slots` | List slots with availability |

### Edge Functions
| Function | Purpose |
|----------|---------|
| `check-availability` | Real-time capacity check (legacy) |

## API Endpoints

| Method | Endpoint | Auth |
|--------|----------|------|
| RPC | `get_ticket_availability(_event_id)` | No |
| RPC | `validate_ticket_order(_event_id, _items)` | No |
| RPC | `get_ticket_type_with_availability(_ticket_type_id)` | No |
| RPC | `get_event_ticket_types(_event_id)` | No |
| RPC | `get_ticket_type_full(_ticket_type_id, _locale)` | No |
| RPC | `get_ticket_time_slots(_ticket_type_id)` | No |
| RPC | `update_ticket_type_extended(_id, _updates)` | Admin |
| RPC | `upsert_ticket_type_i18n(...)` | Admin |
| RPC | `upsert_ticket_time_slot(...)` | Admin |
| RPC | `upsert_ticket_team_config(...)` | Admin |

## Test Scenarios

| ID | Scenario | Expected | Status |
|----|----------|----------|--------|
| T1 | View ticket types | All types for event shown | 🟢 |
| T2 | Sold out ticket | Shows "Sold out" | 🟢 |
| T3 | Select quantity | Quantity validated | 🟢 |
| T4 | Exceeds max per order | Error shown | 🟢 |
| T5 | Pre-validate order | Errors returned | 🟢 |
| T6 | Get full ticket config | Returns i18n, slots, team | 🟢 |
| T7 | Filter by visibility | Hidden tickets excluded | 🟢 |
| T8 | Time slot availability | Shows sold/available | 🟢 |
| T9 | Future ticket sales | Shows "Binnenkort" | 🟢 |
| T10 | Ended ticket sales | Shows "Verkoop gesloten" | 🟢 |
| T11 | Low stock warning | Shows "Nog X" | 🟢 |
| T12 | Distance badge | Shows "10 km" | 🟢 |

## Acceptance Criteria

- [x] Ticket types display correctly
- [x] Availability shown in real-time
- [x] Extended fields (distance, category) available
- [x] i18n support for name/description
- [x] Time slots/waves configurable
- [x] Team configuration available
- [x] Visibility control works
- [x] Quantity limits enforced
- [x] Sold out badge displayed
- [x] Future/ended sales indicated
- [x] Pre-checkout validation works
- [x] 12/12 S2 tests passing

## Deliverables

| Artifact | Status | Location |
|----------|--------|----------|
| S1 Plan | Done | `sprints/s1-plan.md` |
| S1 Architecture | Done | `sprints/s1-architecture.md` |
| S2 Plan | Done | `sprints/s2-plan.md` |
| S2 Architecture | Done | `sprints/s2-architecture.md` |
| S2 Migration | Done | `supabase/migrations/20250128160000_f005_s2_availability_rpcs.sql` |
| PublicEventCheckout | Done | `web/src/pages/public/PublicEventCheckout.tsx` |
| S2 Tests | Done (12/12) | `tests/s2-integration-tests.sql` |
| S2 Review | Done | `sprints/s2-review.md` |

---

*Last updated: 2026-01-28*
*Sprint S1 completed: 2025-01-27*
*Sprint S2 completed: 2026-01-28*
