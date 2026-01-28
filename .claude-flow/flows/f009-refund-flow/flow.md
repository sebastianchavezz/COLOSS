# F009: Refund Flow

## Overview

**Status**: 🟡 Active
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

- [ ] Full refund: volledige orderbedrag terugbetalen
- [ ] Partial refund: gedeeltelijk bedrag terugbetalen
- [ ] Idempotency: geen dubbele refunds
- [ ] Mollie integration: API calls naar Mollie Refunds API
- [ ] Webhook handling: status updates van Mollie
- [ ] Audit logging: alle refund acties gelogd
- [ ] Email notification: bevestiging naar klant
- [ ] RLS: alleen org admins/owners kunnen refunden
- [ ] Ticket voiding: tickets worden ongeldig bij full refund

## Sprints

| Sprint | Focus | Status |
|--------|-------|--------|
| S1 | Database + Mollie Integration | 🟡 Active |
| S2 | UI + Dashboard | 🔴 Planned |

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

*Created: 2026-01-28*
