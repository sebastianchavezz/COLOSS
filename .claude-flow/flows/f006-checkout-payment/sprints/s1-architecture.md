# Architecture: F006 Checkout & Payment

## Data Flow

```
Client → create-order-public → DB (validate + create order)
                              → Mollie API (create payment)
                              → Client (checkout_url)

Mollie → mollie-webhook → Mollie API (verify)
                        → DB (idempotency check)
                        → DB RPC handle_payment_webhook
                            → Update order status
                            → Issue ticket_instances
                            → Queue email via email_outbox
                        → 200 OK (Mollie stops retrying)
```

## Key Enforcement Points

| Point | Where | What |
|-------|-------|------|
| Event visibility | create-order-public | events.status = 'published' |
| Sales window | create-order-public | sales_start <= now() <= sales_end |
| Capacity pre-check | create-order-public | FOR UPDATE SKIP LOCKED |
| Price integrity | create-order-public | Server-calculated, not client-trusted |
| Webhook verification | mollie-webhook | Re-fetch from Mollie API |
| Idempotency | mollie-webhook | payment_events unique constraint |
| Final capacity | handle_payment_webhook | Atomic check before ticket issuance |
| Overbooked failsafe | handle_payment_webhook | Mark overbooked, skip issuance |

## Migration: 20250128100000_f006_checkout_payment.sql

1. Add `org_id`, `subtotal_amount` to orders (IF NOT EXISTS)
2. Rewrite `handle_payment_webhook` RPC:
   - Updates payment status
   - On 'paid': final capacity check → issue ticket_instances → queue email
   - On failure: mark order failed
3. Add `validate_checkout_capacity` RPC for atomic pre-check

## Edge Function: create-order-public/index.ts

```
POST { event_id, items: [{ticket_type_id, quantity}], email, purchaser_name?, user_token? }

1. Parse & validate input
2. Resolve user_id from optional Bearer token (not required)
3. Fetch event → verify published + sales window
4. Fetch ticket_types → verify belong to event
5. Atomic capacity pre-check (FOR UPDATE)
6. Server-side price calculation
7. Derive org_id from event.org_id
8. Generate public_token → hash
9. INSERT order (with org_id, public_token_hash)
10. INSERT order_items
11. If total == 0: call issue-tickets → return success
12. If total > 0: create Mollie payment → return {checkout_url, public_token}
```
