---
trigger: always_on
---


## 1) Domeinmodel (tabellen) dat alles draagt

**Core**

* `orgs` (organisatie)
* `org_members` (rollen: owner/admin/support/finance)
* `events` (hardloop/fiets/triatlon, status: draft/published/closed)
* `event_settings` (algemene regels, edit windows, transfer rules, btw, etc.)

**Inschrijving & deelnemers**

* `participants` (supabase auth user ↔ profiel; ook “guest” mogelijk)
* `registrations` (inschrijving op event; status: pending/paid/cancelled/refunded/waitlisted)
* `registration_answers` (dynamische vragen per event/ticket)
* `waitlist_entries` + `waitlist_offers` (netjes en auditable)

**Tickets & shop**

* `ticket_types` (startbewijs categorieën, price tiers, capacity, sales windows)
* `tickets` (de “entitlement”, gekoppeld aan registration; unieke QR/claim-code)
* `products` (t-shirt, parking, engraving…)
* `order_items` (ticket + extras als lijnitems)

**Betaling & facturatie (idempotent!)**

* `orders` (cart → checkout → paid)
* `payments` (provider refs, status, raw payload)
* `refunds` / `credit_notes` (als je dat wilt)
* `invoices` (optioneel, maar handig B2B)

**Self-service**

* `ticket_transfers` (from_ticket → to_user/email, status + expiries)
* `audit_log` (wie deed wat, wanneer, vanaf waar)

**Integraties**

* `integrations` (per event: timing/CRM/email)
* `integration_jobs` (queue/outbox pattern)

> Belangrijk: **tickets en registrations scheiden**. Registratie = deelname administratief, ticket = toegang/startbewijs/QR. Dat maakt transfers, refunds en upgrades veel schoner.

---

## 2) Waterdichte Supabase security (RLS-first)

**RLS principes**

* Organizer data alleen via `org_members`.
* End-user ziet enkel eigen `participants`, `registrations`, `orders`, `tickets`.
* PII apart: gevoelige velden (geboortedatum, noodcontact) in aparte table of column-level restrictie via views.

**Must-haves**

* **Row Level Security op álle tabellen** (default deny).
* **Service role alleen in Edge Functions** (nooit in client).
* **Policies per rol**:

  * `org_admin`: CRUD op event config, ticket_types, products
  * `support`: read-only deelnemers + beperkte acties (bv. resend ticket)
  * `finance`: read-only orders/payments + exports

**Extra hardening**

* `audit_log` altijd append-only (alleen insert).
* Soft delete met `deleted_at` (en policies die deleted verbergen).

---

## 3) Betalingen: “exactly-once” verwerking

De grootste bron van ellende is payment-webhooks.

**Aanpak**

* `orders` hebben `idempotency_key` + `checkout_session_id`.
* Webhook handler (Edge Function):

  * verifieert signature
  * schrijft event naar `payment_events` (raw) met unique constraint op provider event id
  * voert “state transition” uit in SQL transaction:

    * order → paid
    * tickets genereren (of bevestigen)
    * capacity decrement (met locking/constraints)
* “Outbox” tabel (`outbox_events`) voor e-mails/exports/integrations zodat je retries veilig zijn.

---

## 4) Capaciteit, race conditions en integriteit

**DB-constraints die je wil**

* Unieke ticket code/QR.
* Capacity: verkoop nooit boven limiet:

  * ofwel met `ticket_types.capacity_remaining` + transaction lock
  * of met `tickets` count constraint via stored procedure (meestal lock-based het praktischst)
* Status transitions afdwingen (bv. order kan niet van refunded → paid).

---

## 5) API-laag: PostgREST vs Edge Functions

**Gebruik PostgREST (Supabase auto-API) voor**

* simpele reads (event listing, user’s registrations)
* organizer dashboards (met views)

**Gebruik Edge Functions voor**

* checkout start (payment provider)
* webhook verwerking
* ticket transfer (met e-mail claim flow)
* exports genereren
* integratie pushes (timing/marketing)

---

## 6) Minimale “backend-only” milestone (snel waarde)

Als je nu alleen backend bouwt, zou ik MVP opleveren in deze volgorde:

1. **Orgs + roles + events**
2. **Ticket types + products**
3. **Cart/order model**
4. **Payment flow + webhook (idempotent)**
5. **Ticket issuance + QR/claim**
6. **Self-service: wijziging profiel + ticket transfer**
7. **Waitlist**
8. **Integratie outbox**

---