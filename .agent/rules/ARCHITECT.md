---
trigger: always_on
---

# Build Hierarchy & Development Order

**Sport Event Registration & Ticketing Platform (Supabase)**

Dit document beschrijft **de hiërarchie van het systeem** en de **verplichte bouwvolgorde**.
Elke laag bouwt voort op de vorige. Lagen mogen **nooit** afhankelijk zijn van lagen erboven.

Deze hiërarchie is bindend voor:

* menselijke ontwikkelaars
* LLM’s (Antigravity / agents)
* code reviews en architectuurkeuzes

---

## Laag 0 — Project Constitution (fundament)

**Doel:** spelregels, scope en kwaliteitsnormen vastleggen.

### Inhoud

* Project Constitution
* Terminologiecontract
* Security- en RLS-principes
* Temp-directory regel voor test/spike code
* Commenting & documentation standaard

### Status

* ✅ **Moet volledig bestaan vóór enige code**
* ❌ Geen implementatie zonder deze laag

---

## Laag 1 — Identiteit & Multi-Tenant Isolatie

**Doel:** wie mag wat zien en beheren?

### Kerncomponenten

* `orgs`
* `org_members`
* Rollen: `owner`, `admin`, `support`, `finance`
* Supabase Auth ↔ organisatie-mapping
* Row Level Security voor org-isolatie

### Belang

* Absolute fundering van het platform
* Fouten hier zijn later **niet veilig te herstellen**

### Output

* SQL DDL
* RLS policies
* Basis audit logging

---

## Laag 2 — Event Core

**Doel:** object waarvoor alles gebeurt.

### Kerncomponenten

* `events`
* `event_settings`
* Event lifecycle:

  * `draft`
  * `published`
  * `closed`
* Publieke vs interne zichtbaarheid

### Regels

* Alleen organisatieleden mogen events beheren
* Geen registraties zonder event

---

## Laag 3 — Participants & Registrations (zonder geld)

**Doel:** wie doet mee, los van betalingen.

### Kerncomponenten

* `participants` (auth + guest)
* `registrations`
* Status:

  * `pending`
  * `paid`
  * `cancelled`
  * `waitlist`
* Dynamische velden:

  * `registration_questions`
  * `registration_answers`

### Waarom zonder geld?

* Validatie van RLS en dataflows
* Minder complexiteit
* Betere foutisolatie

---

## Laag 4 — Tickets & Capaciteit

**Doel:** wat koopt / ontvangt een deelnemer?

### Kerncomponenten

* `ticket_types`
* Capaciteit & verkoopvensters
* `tickets` (entitlements)
* Unieke QR / claim codes

### Technische eisen

* Harde database-constraints
* Concurrency-safe capaciteit
* Ticket ≠ registratie (strikt gescheiden)

---

## Laag 5 — Orders & Betalingen

**Doel:** geldstromen correct en veilig verwerken.

### Kerncomponenten

* `orders`
* `order_items`
* `payments`
* `payment_events` (raw webhooks)
* Idempotency keys

### Verplicht

* Edge Functions voor:

  * checkout
  * webhook verwerking
* Exactly-once verwerking
* Volledige audit trail

---

## Laag 6 — Self-Service & Mutaties

**Doel:** deelnemers autonomie geven zonder databeveiliging te breken.

### Kerncomponenten

* Profielwijzigingen
* Ticket transfers
* Annulaties / refunds (policy-based)
* `audit_log` (append-only)

### Regel

* Elke mutatie is traceerbaar
* Geen “silent” state changes

---

## Laag 7 — Integraties & Uitbreidingen

**Doel:** externe systemen koppelen zonder core te vervuilen.

### Voorbeelden

* Tijdregistratie
* Marketing tools
* Exports
* **Fundraising (bv. Supporta)**

### Architectuur

* Outbox pattern
* Asynchroon
* Retry-safe
* Nooit core-blocking

---

## Fundraising (bewust laat)

Fundraising is **geen core feature** maar een **decorator** bovenop:

* events
* tickets
* registrations
* self-service

Daarom:

* ❌ Niet bouwen vóór Laag 6
* ✅ Volledig optioneel en isoleerbaar

---

## Verplichte ontwikkelvolgorde

Elke feature of uitbreiding volgt **altijd** deze volgorde:

1. Datamodel & relaties
2. Constraints & indexes
3. RLS policies
4. Edge Functions (server-side)
5. Failure scenarios & edge cases
6. Pas daarna API usage / queries

---

## Samenvatting

* Bouw **van binnen naar buiten**
* Fundering eerst, features later
* Database en RLS zijn leidend
* Integraties zijn altijd optioneel

**Afwijken van deze hiërarchie vereist expliciete architecturale goedkeuring.**
