# Flow: Checkout & Payment

**ID**: F006
**Status**: 🟢 Done
**Total Sprints**: 7
**Current Sprint**: S7 Complete

## Sprints
| Sprint | Focus | Status |
|--------|-------|--------|
| S1 | Full checkout flow (order + validation + Mollie + webhook + ticket issuance) | 🟢 |
| S2 | Mollie Sandbox Integration upgrade | 🟢 |
| S3 | Waterdichte Mollie Integration (best practices) | 🟢 |
| S4 | Products Integration (F015 - upgrades & merchandise) | 🟢 |
| S5 | Boekhoudkundige Verplichtingen (Accounting) | 🟢 |
| S6 | Subscription-Based Tickets for Clubs (joint with F005 S3) | 🟢 |
| S7 | Ticket Flow Waterdicht (security + correctness fixes) | 🟢 |

## Dependencies
- **Requires**: F005 (Ticket Selection), F015 (Products)
- **Blocks**: F007, F009

## Overview

Waterdichte checkout flow voor het aankopen van tickets én producten.
Werkt voor zowel ingelogde gebruikers als guests.

```
Als bezoeker
Wil ik veilig kunnen betalen via Mollie
Zodat ik mijn tickets en producten ontvang na succesvolle betaling
```

## Geïmplementeerde Componenten

### Database (Migration: 20250128100000_f006_checkout_payment.sql + 20260203100000_f006_s4_products_integration.sql)
- `orders.org_id` — server-afgeleid uit event (nooit client-trusted)
- `orders.subtotal_amount` / `discount_amount` — transparante pricing
- `validate_checkout_capacity` RPC — atomische capacity + sales window check (FOR UPDATE SKIP LOCKED)
- `validate_checkout_with_products` RPC — **[S4]** validates tickets AND products atomically
- `handle_payment_webhook` RPC — atomische webhook: ticket_instances + email + overbooked failsafe
- `cleanup_stale_pending_orders` RPC — pending orders older than 1 hour

### Edge Functions
| Function | Purpose | Status |
|----------|---------|--------|
| `create-order-public` | Guest + authenticated checkout (tickets + products) | 🟢 Fully implemented |
| `mollie-webhook` | Webhook handler with idempotency + ticket issuance | 🟢 Fully implemented |
| `create-mollie-payment` | Authenticated-only payment creation | 🟢 Bestaand |
| `get-order-public` | Public order lookup via token | 🟢 Bestaand |
| `issue-tickets` | Ticket issuance (called by webhook RPC + free orders) | 🟢 Bestaand |
| `simulate-payment` | Dev-only payment simulation | 🟢 Bestaand |

### Enforcement Points
| Point | Where | What |
|-------|-------|------|
| Event visibility | create-order-public | events.status = 'published' |
| Sales window | validate_checkout_with_products RPC | sales_start <= now() <= sales_end |
| Ticket capacity | validate_checkout_with_products RPC | FOR UPDATE SKIP LOCKED |
| Product capacity | validate_checkout_with_products RPC | FOR UPDATE SKIP LOCKED |
| Variant capacity | validate_checkout_with_products RPC | FOR UPDATE SKIP LOCKED |
| max_per_order | validate_checkout_with_products RPC | Per-product limit |
| Upgrade restrictions | validate_checkout_with_products RPC | Cart must contain allowed ticket |
| Price integrity | create-order-public | Server-calculated, never client-trusted |
| Webhook verification | mollie-webhook | Re-fetch from Mollie API |
| Idempotency | mollie-webhook | payment_events unique constraint |
| Final capacity | handle_payment_webhook RPC | Atomic check before ticket issuance |
| Overbooked failsafe | handle_payment_webhook RPC | Mark order cancelled if capacity exceeded |
| Email notification | handle_payment_webhook RPC | Queue via email_outbox |

## Flow Diagram

```
[Cart: Tickets + Products] → [Enter Details] → [create-order-public]
                                                      │
                                                      ▼
                                    [validate_checkout_with_products RPC]
                                              │
                                    ┌─────────┴─────────┐
                                    ▼                   ▼
                              [Validation OK]    [Validation Failed]
                                    │                   │
                                    ▼                   ▼
                              [Create Order]     [Return Error]
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

## S4: Products Integration (NEW)

### Request Schema

```typescript
interface CreateOrderPublicRequest {
  event_id?: string
  event_slug?: string
  items: TicketItem[]              // Ticket items
  product_items?: ProductItem[]     // Product items (F015)
  email: string
  purchaser_name?: string
}

interface TicketItem {
  ticket_type_id: string
  quantity: number
}

interface ProductItem {
  product_id: string
  variant_id?: string  // Optional: specific variant
  quantity: number
}
```

### Product Validations
| Rule | Description |
|------|-------------|
| Product active | `is_active = true AND deleted_at IS NULL` |
| Same event | Product must belong to checkout event |
| Sales window | `sales_start ≤ NOW() ≤ sales_end` |
| Product capacity | Atomic lock + count sold |
| Variant capacity | Atomic lock + count sold (if variant specified) |
| max_per_order | Cannot exceed product.max_per_order |
| ticket_upgrade | Cart must contain allowed ticket_type_id |

### Backwards Compatibility
- Empty `product_items` = ticket-only checkout (existing behavior)
- Falls back to old RPC if new one not found (schema cache)

## Test Results
- S1-S3: 25/25 tests passed
- S4: See `tests/s4-products-integration.mjs`
- S7: 16/16 tests passed (`tests/s7-waterdicht-tests.mjs`)
- Coverage: schema, RPCs, edge functions, RLS, capacity validation, products, security

## Mollie Sandbox Testing (S2)

Run the E2E sandbox test:
```bash
node .claude-flow/flows/f006-checkout-payment/tests/e2e-sandbox-test.mjs
```

This will:
1. Find a published event with paid tickets
2. Create an order via create-order-public
3. Return a Mollie checkout URL

Test credentials:
- **Card**: 4543 4740 0224 9996 (any expiry, any CVV)
- **iDEAL**: Select any test bank

## Mollie Best Practices Implemented (S3)

| Practice | Implementation |
|----------|----------------|
| Verify by re-fetch | Always fetch payment from Mollie API, never trust webhook payload |
| Return 200 for unknowns | Return 200 OK for unknown IDs (security: no info leakage) |
| Idempotency | payment_events table with unique constraint |
| Timeout handling | 10s timeout for Mollie API calls (Mollie times out at 15s) |
| Retry support | Return 500 for transient errors → Mollie retries 10x over 26h |

Webhook tests: `tests/webhook-tests.mjs` (5/5 passing)

Sources:
- [Mollie Webhooks](https://docs.mollie.com/reference/webhooks)
- [Mollie Testing](https://docs.mollie.com/reference/testing)

## S6: Subscription-Based Tickets for Clubs (NEW)

Joint sprint with F005 S3. Adds recurring subscription billing via Mollie.

### New Edge Functions
| Function | Purpose | Status |
|----------|---------|--------|
| `create-subscription-checkout` | First payment with Mollie sequenceType "first" | 🟢 |
| `manage-subscription` | Cancel and list user subscriptions | 🟢 |

### Modified Edge Functions
| Function | Change | Status |
|----------|--------|--------|
| `mollie-webhook` | Added subscription payment detection (subscriptionId + metadata) | 🟢 |

### New Shared Helpers
| File | Purpose |
|------|---------|
| `_shared/mollie.ts` | Mollie Customer, Mandate, Subscription CRUD, First Payment |

### Subscription Flow
```
[Select Club Ticket] --> [Login Required] --> [create-subscription-checkout]
       |                                          |
       v                                          v
[First Payment (Mollie)]  <-- sequenceType: "first"
       |                       creates mandate
       v
[Webhook: mandate created] --> [Create Mollie Subscription]
       |
       v
[Mollie auto-charges at interval]
       |
       v
[mollie-webhook receives tr_xxx] --> [detect subscriptionId]
       |                                    |
       v                                    v
[handle_subscription_payment RPC]    [Renew ticket_instance]
```

### Security Review
- All 5 review issues fixed before merge
- RLS deny policies on all write operations
- Role-based authorization (owner/admin) for cancel
- Idempotent webhook handling with ON CONFLICT guards
- See: `f005-ticket-selection/sprints/s3-review.md`

### Tests
- 22/22 integration tests passing
- See: `f005-ticket-selection/tests/s3-subscription-tests.mjs`

## S7: Ticket Flow Waterdicht (Security + Correctness)

Critical fixes to make the ticket flow production-ready.

### P0 Fixes (KRITIEK)
| Fix | Problem | Solution |
|-----|---------|----------|
| QR code generation | token_hash and qr_code from 2 different UUIDs = unscannable | LATERAL subquery: 1 UUID per ticket, both derived |
| void_tickets_for_refund | Wrong enum 'voided', non-existent columns | Fixed to 'void', removed voided_at/voided_reason |
| INSERT RLS lockdown | WITH CHECK (true) = any user can create fake tickets | WITH CHECK (false) on ticket_instances + tickets |
| Transfer Edge Functions | Wrong table (tickets), wrong columns, missing fields | Full rewrite against actual remote schema |

### P1 Fixes (HOOG)
| Fix | Problem | Solution |
|-----|---------|----------|
| Overbooked handling | No email/audit on overbooked order | Added email_outbox INSERT + audit_log |
| Expired transfers | Pending transfers never expire | New cleanup_expired_transfers function |
| Stale orders | cleanup_stale_pending_orders never called | New cleanup-jobs Edge Function |
| Token backfill | Existing tickets had mismatched hashes | Migration backfills 5 existing tickets |

### Security Review
- All 7 review issues found and fixed
- RLS INSERT policies locked (WITH CHECK false)
- Transfer token not leaked to sender
- Recipient email verified on accept
- cleanup-jobs requires service role Bearer token

### New Edge Functions
| Function | Purpose | Status |
|----------|---------|--------|
| `cleanup-jobs` | Periodic cleanup: stale orders + expired transfers | 🟢 |

### Modified Edge Functions
| Function | Change | Status |
|----------|--------|--------|
| `initiate-transfer` | Full rewrite: ticket_instances, token generation, all required fields | 🟢 |
| `accept-transfer` | Full rewrite: correct column names, email verification, user_metadata | 🟢 |

### Tests
- 16/16 integration tests passing
- See: `tests/s7-waterdicht-tests.mjs`

---

*Last updated: 2026-02-20*
