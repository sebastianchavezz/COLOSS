# Flow: Checkout & Payment

**ID**: F006
**Status**: 🟢 Done
**Total Sprints**: 1 (consolidated)
**Current Sprint**: S1 Complete

## Sprints
| Sprint | Focus | Status |
|--------|-------|--------|
| S1 | Full checkout flow (order + validation + Mollie + webhook + ticket issuance) | 🟢 |

## Dependencies
- **Requires**: F005 (Ticket Selection)
- **Blocks**: F007, F009

## Overview

Waterdichte checkout flow voor het aankopen van tickets.
Werkt voor zowel ingelogde gebruikers als guests.

```
Als bezoeker
Wil ik veilig kunnen betalen via Mollie
Zodat ik mijn tickets ontvang na succesvolle betaling
```

## Geïmplementeerde Componenten

### Database (Migration: 20250128100000_f006_checkout_payment.sql)
- `orders.org_id` — server-afgeleid uit event (nooit client-trusted)
- `orders.subtotal_amount` / `discount_amount` — transparante pricing
- `validate_checkout_capacity` RPC — atomische capacity + sales window check (FOR UPDATE SKIP LOCKED)
- `handle_payment_webhook` RPC — atomische webhook: ticket_instances + email + overbooked failsafe
- `cleanup_stale_pending_orders` RPC — pending orders older than 1 hour

### Edge Functions
| Function | Purpose | Status |
|----------|---------|--------|
| `create-order-public` | Guest + authenticated checkout | 🟢 Fully implemented |
| `mollie-webhook` | Webhook handler with idempotency + ticket issuance | 🟢 Fully implemented |
| `create-mollie-payment` | Authenticated-only payment creation | 🟢 Bestaand |
| `get-order-public` | Public order lookup via token | 🟢 Bestaand |
| `issue-tickets` | Ticket issuance (called by webhook RPC + free orders) | 🟢 Bestaand |
| `simulate-payment` | Dev-only payment simulation | 🟢 Bestaand |

### Enforcement Points
| Point | Where | What |
|-------|-------|------|
| Event visibility | create-order-public | events.status = 'published' |
| Sales window | validate_checkout_capacity RPC | sales_start <= now() <= sales_end |
| Capacity pre-check | validate_checkout_capacity RPC | FOR UPDATE SKIP LOCKED |
| Price integrity | create-order-public | Server-calculated, never client-trusted |
| Webhook verification | mollie-webhook | Re-fetch from Mollie API |
| Idempotency | mollie-webhook | payment_events unique constraint |
| Final capacity | handle_payment_webhook RPC | Atomic check before ticket issuance |
| Overbooked failsafe | handle_payment_webhook RPC | Mark order cancelled if capacity exceeded |
| Email notification | handle_payment_webhook RPC | Queue via email_outbox |

## Flow Diagram

```
[Cart] → [Enter Details] → [create-order-public]
                                    │
                          ┌─────────┴─────────┐
                          ▼                   ▼
                    [Free: total=0]    [Paid: total>0]
                          │                   │
                          ▼                   ▼
                  [issue-tickets]     [Mollie Payment]
                          │                   │
                          ▼                   ▼
                  [Order Confirmed]    [Redirect to Mollie]
                                              │
                                              ▼
                                       [User Pays]
                                              │
                                              ▼
                                       [mollie-webhook]
                                              │
                                    ┌─────────┴─────────┐
                                    ▼                   ▼
                             [Paid → issue tickets]  [Failed → cancel order]
                                    │
                                    ▼
                             [Email queued]
                                    │
                                    ▼
                             [Order Confirmed]
```

## Test Results
- 25/25 tests passed
- Coverage: schema, RPCs, edge functions, RLS, capacity validation
- See: `tests/integration-tests.mjs`

---

*Last updated: 2025-01-28*
