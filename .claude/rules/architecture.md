# Architecture & Build Hierarchy

Dit document beschrijft de **verplichte bouwvolgorde** en lagenstructuur.
Elke laag bouwt voort op de vorige. Lagen mogen **nooit** afhankelijk zijn van lagen erboven.

## Laag 0 — Project Constitution (Fundament)
Spelregels, scope, security principes, en kwaliteitsnormen. Moet bestaan vóór enige code.

## Laag 1 — Identiteit & Multi-Tenant Isolatie
**Doel**: Wie mag wat zien en beheren?
- `orgs`, `org_members`
- Rollen (owner, admin, support, finance)
- RLS voor org-isolatie (CRITICAL)

## Laag 2 — Event Core
**Doel**: Het object waarvoor alles gebeurt.
- `events`, `event_settings`
- Lifecycle: draft -> published -> closed

## Laag 3 — Participants & Registrations (Zonder geld)
**Doel**: Wie doet mee?
- `participants`, `registrations`
- Status: pending, paid, cancelled, waitlist
- Dynamische vragen

## Laag 4 — Tickets & Capaciteit
**Doel**: Wat koopt men?
- `ticket_types`, `tickets` (entitlements)
- Capaciteit & verkoopvensters
- Unieke QR codes

## Laag 5 — Orders & Betalingen
**Doel**: Geldstromen veilig verwerken.
- `orders`, `order_items`, `payments`
- Edge Functions voor checkout & webhooks
- Idempotency & Exactly-once verwerking

## Laag 6 — Self-Service & Mutaties
**Doel**: Autonomie voor deelnemers.
- Ticket transfers, refunds, profielwijzigingen
- Audit log (append-only)

## Laag 7 — Integraties & Uitbreidingen
**Doel**: Externe systemen koppelen.
- Outbox pattern
- Asynchroon & Retry-safe

## Verplichte Ontwikkelvolgorde (Per Feature)
1. **Datamodel & Relaties**
2. **Constraints & Indexes**
3. **RLS Policies**
4. **Edge Functions** (Server-side logic)
5. **Failure Scenarios** (Tests)
6. **API Usage** (Client integration)
