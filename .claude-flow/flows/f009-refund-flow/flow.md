# F009: Refund Flow

## Overview

**Status**: 🟢 Done
**Priority**: High
**Dependencies**: F006 (Checkout/Payment) ✅

## Description

Implementeer een waterdichte refund flow die organizers in staat stelt om bestellingen (deels) terug te betalen via Mollie. De flow moet voldoen aan GDPR, audit requirements, en Mollie best practices.

## User Stories

1. **Als organizer** wil ik een bestelling volledig kunnen terugbetalen zodat deelnemers hun geld terugkrijgen bij annulering.
2. **Als organizer** wil ik een bestelling gedeeltelijk kunnen terugbetalen zodat ik flexibel kan zijn met klantverzoeken.
3. **Als organizer** wil ik zien welke refunds er zijn uitgevoerd zodat ik overzicht heb van financiën.
4. **Als deelnemer** wil ik email ontvangen wanneer mijn refund is verwerkt zodat ik weet dat het geregeld is.

## Acceptance Criteria

- [x] Full refund: volledige orderbedrag terugbetalen
- [x] Partial refund: gedeeltelijk bedrag terugbetalen
- [x] Idempotency: geen dubbele refunds
- [x] Mollie integration: API calls naar Mollie Refunds API
- [x] Webhook handling: status updates van Mollie
- [x] Audit logging: alle refund acties gelogd
- [x] Email notification: bevestiging naar klant
- [x] RLS: alleen org admins/owners kunnen refunden
- [x] Ticket voiding: tickets worden ongeldig bij full refund

## Sprints

| Sprint | Focus | Status |
|--------|-------|--------|
| S1 | Database + Mollie Integration | 🟢 Done |
| S2 | Refund Flow Waterdicht | 🟢 Done |

## Implemented Components

### Database (20250128152000_f009_refunds_v2.sql)
- `refund_status` enum: pending, queued, processing, refunded, failed, canceled
- `refunds` table: full refund tracking with Mollie integration
- `refund_items` table: partial refund item tracking
- Indexes for performance
- RLS policies: org admins/owners only

### RPCs (20250128220000_f009_refund_rpcs.sql)
- `get_order_refund_summary()`: Get refundable amount for an order
- `void_tickets_for_refund()`: Void tickets when full refund completes
- `handle_refund_webhook()`: Process Mollie status updates

### Edge Functions
- `create-refund`: Create refund via Mollie API
- `mollie-webhook`: Extended to handle refund webhooks

### Tests
- S1: 10/10 integration tests passing
- S2: 13/13 waterdicht tests passing

## Technical Design

### Database
- `refunds` table met status tracking
- `refund_items` voor partial refunds per order_item
- Triggers voor ticket voiding

### Edge Functions
- `create-refund`: initiate refund via Mollie
- `mollie-webhook`: handle refund status updates (extend existing)

### Security
- RLS: org admins/owners only
- Idempotency via refund_idempotency_key
- Rate limiting

---

## S2 Waterdicht Fixes (2026-02-20)

### Critical Fix: Mollie API Endpoint
- `mollie-webhook/handleRefundWebhook` used `GET /v2/refunds/{id}` which does NOT exist
- Fixed to: DB lookup first → `GET /v2/payments/{paymentId}/refunds/{refundId}`
- **Without this fix, every refund webhook silently failed with 404**

### Order Status Transition
- `handle_refund_webhook` RPC now updates order status `paid → refunded` on full refund
- Previously, orders stayed on `paid` even after full refund

### Status Mapping Fix
- `create-refund` now correctly maps Mollie `failed` and `canceled` statuses
- Previously both were mapped to `processing`

### Complete Chain (Fixed)
```
Organizer → create-refund → Mollie API → webhook →
  DB lookup (get paymentId) → Mollie verify →
  handle_refund_webhook RPC → void tickets + update order →
  queue_refund_confirmation_email → process-outbox → email sent
```

---

*Created: 2026-01-28*
*Updated: 2026-02-20 (S2 Waterdicht)*
