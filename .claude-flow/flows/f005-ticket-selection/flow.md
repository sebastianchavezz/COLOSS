# Flow: Ticket Selection

**ID**: F005
**Status**: 🔴 Planned
**Total Sprints**: 2
**Current Sprint**: -

## Sprints
| Sprint | Focus | Status |
|--------|-------|--------|
| S1 | Ticket types + availability | 🔴 |
| S2 | Cart + quantity limits | 🔴 |

## Dependencies
- **Requires**: F004
- **Blocks**: F006

## Overview

Bezoekers kunnen tickets selecteren en aan hun winkelwagen toevoegen.

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
| `ticket_types` | Ticket type definitions |
| `tickets` | Issued tickets |
| `cart_items` | Shopping cart (optional) |

### RLS Policies
| Policy | Table | Rule |
|--------|-------|------|
| `public_read` | `ticket_types` | `event.status = 'published'` |
| `check_availability` | `ticket_types` | Capacity not exceeded |

### Edge Functions
| Function | Purpose |
|----------|---------|
| `check-availability` | Real-time capacity check |

## API Endpoints

| Method | Endpoint | Auth |
|--------|----------|------|
| GET | `/rest/v1/ticket_types?event_id=eq.{id}` | No |
| POST | `/functions/v1/check-availability` | No |

## Test Scenarios

| ID | Scenario | Expected |
|----|----------|----------|
| T1 | View ticket types | All types for event shown |
| T2 | Sold out ticket | Shows "Sold out" |
| T3 | Select quantity | Quantity validated |
| T4 | Exceeds max per order | Error shown |
| T5 | Add to cart | Cart updated |

## Acceptance Criteria

- [ ] Ticket types display correctly
- [ ] Availability shown in real-time
- [ ] Quantity limits enforced
- [ ] Sold out tickets marked
- [ ] Cart persists during session

---

*Last updated: 2025-01-27*
