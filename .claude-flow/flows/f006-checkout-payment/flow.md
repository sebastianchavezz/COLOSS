# Flow: Checkout & Payment

**ID**: F006
**Status**: 🔴 Planned
**Total Sprints**: 3
**Current Sprint**: -

## Sprints
| Sprint | Focus | Status |
|--------|-------|--------|
| S1 | Order creation + validation | 🔴 |
| S2 | Payment provider (Mollie) | 🔴 |
| S3 | Webhooks + idempotency | 🔴 |

## Dependencies
- **Requires**: F005
- **Blocks**: F007, F009

## Overview

Bezoekers voltooien hun bestelling en betalen voor tickets.

```
Als bezoeker
Wil ik veilig kunnen betalen
Zodat ik mijn tickets ontvang
```

## Flow Diagram

```
[Cart] → [Enter Details] → [Select Payment]
                                   │
                                   ▼
                           [Create Order]
                                   │
                                   ▼
                          [Payment Provider]
                                   │
              ┌────────────────────┴────────────────────┐
              ▼                                         ▼
        [Payment Success]                        [Payment Failed]
              │                                         │
              ▼                                         ▼
      [Order Confirmed] → [F007]               [Retry/Cancel]
```

## Supabase

### Tables
| Table | Purpose |
|-------|---------|
| `orders` | Order records |
| `order_items` | Items per order |
| `payments` | Payment transactions |
| `registrations` | Participant registrations |

### RLS Policies
| Policy | Table | Rule |
|--------|-------|------|
| `read_own` | `orders` | `user_id = auth.uid()` |
| `create_own` | `orders` | `user_id = auth.uid()` |

### Edge Functions
| Function | Purpose |
|----------|---------|
| `create-checkout` | Create order + payment |
| `mollie-webhook` | Handle payment status |
| `complete-order` | Finalize order, create tickets |

## API Endpoints

| Method | Endpoint | Auth |
|--------|----------|------|
| POST | `/functions/v1/create-checkout` | Yes/Guest |
| POST | `/functions/v1/mollie-webhook` | Signature |
| GET | `/rest/v1/orders?id=eq.{id}` | Yes |

## Test Scenarios

| ID | Scenario | Expected |
|----|----------|----------|
| T1 | Happy path | Order created, payment success |
| T2 | Payment failed | Order stays pending |
| T3 | Duplicate webhook | Idempotent handling |
| T4 | Capacity exceeded | Order rejected |
| T5 | Invalid payment | Error shown |
| T6 | Guest checkout | Works without account |

## Acceptance Criteria

- [ ] Order created atomically
- [ ] Payment provider integration
- [ ] Webhook handling with idempotency
- [ ] Capacity race conditions handled
- [ ] Guest checkout supported
- [ ] Order confirmation shown

---

*Last updated: 2025-01-27*
