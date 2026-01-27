# Project Context & Scope

## Doel
Bouw een **waterdichte backend** voor een modern Nederlands sportevenementen platform.
Focus op schaalbaarheid, veiligheid (RLS), en auditability.

## Scope
**IN SCOPE**
- Supabase Postgres schema (DDL), constraints, indexes
- Supabase Auth model (users/participants)
- RLS policies op **alle** tabellen (default deny)
- Edge Functions voor: checkout, webhooks, ticket transfer, exports, integratie-outbox
- Observability: audit logging, idempotency, retries

**OUT OF SCOPE**
- Frontend/UI (web of app)
- Client-side businesslogica
- “Even snel” oplossingen zonder RLS

## Niet-onderhandelbare Principes
1. **Database is source of truth**: Geen logica in frontend die data integriteit bewaakt.
2. **RLS-first**: Elke tabel heeft RLS aan + expliciete policies.
3. **Multi-tenant isolatie**: Strikte scheiding per organisatie.
4. **Auditability**: Append-only logs voor kritieke acties.
5. **Idempotency**: Exactly-once verwerking voor betalingen.

## Domein Definities
- `registration`: Deelname administratie (inschrijving).
- `ticket`: Entitlement/QR/Startbewijs (los van registratie).
- `order`: Winkelmandje/checkout state.
- `payment`: Provider transactie + webhook events.
- `participant`: Persoon/profiel (Auth user of Guest).
