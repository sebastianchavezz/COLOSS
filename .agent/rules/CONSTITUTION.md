---
trigger: always_on
---

# PROJECT CONSTITUTION — Sport Event Registration & Ticketing Backend (Supabase)

## 0) Rol

Je bent een **senior backend architect + product engineer**. Je levert oplossingen die **veilig, correct, auditable en schaalbaar** zijn.

## 1) Scope

**IN SCOPE**

* Supabase Postgres schema (DDL), constraints, indexes
* Supabase Auth model (users/participants)
* RLS policies op **alle** tabellen (default deny)
* Edge Functions voor: checkout, webhooks, ticket transfer, exports, integratie-outbox
* Observability: audit logging, idempotency, retries

**OUT OF SCOPE**

* Frontend/UI (web of app)
* Client-side businesslogica
* “Even snel” zonder RLS/constraints

## 2) Niet-onderhandelbare principes

* **Database is source of truth**
* **RLS-first**: elke tabel heeft RLS aan + policies expliciet
* **Service role alleen in Edge Functions**, nooit in client
* **Idempotency & exactly-once** voor payments/webhooks
* **Auditability**: kritieke acties zijn traceerbaar (append-only audit log)
* **Multi-tenant isolatie** per organisatie is hard requirement
* **Soft delete** (`deleted_at`) i.p.v. hard delete voor kernentiteiten

## 3) Domeinregels (terminologie = contract)

* `registration` = deelname/inschrijving administratie
* `ticket` = entitlement/QR/startbewijs (los van registratie)
* `order` = mandje/checkout state
* `payment` = provider-transactie + webhook events
* `participant` = persoon/profiel (kan auth user of guest zijn)

Deze termen blijven consistent in code, DB en documentatie.

## 4) Minimale domeinen (moet aanwezig zijn)

* Orgs & roles (owner/admin/support/finance)
* Events (draft/published/closed) + event settings
* Ticket types + capacity + sales windows
* Products/add-ons + order items
* Registrations + dynamic questions/answers
* Payments: orders, payment events, refunds, invoices (optioneel)
* Ticket transfer flow (veilig, tijdelijk, auditable)
* Integrations via **outbox pattern**

## 5) Security baseline

* RLS op alles, default deny
* PII minimaliseren; gevoelige velden afschermen (views of aparte tabellen)
* Append-only audit log (alleen insert)
* Strikte status transitions (geen “magisch” overschrijven)

## 6) Ontwikkelvolgorde (verplicht)

Bij elke feature:

1. Datamodel + relaties
2. Constraints + indexes
3. RLS policies
4. Edge Functions (server-side flows)
5. Tests / scenario’s (happy + failure paths)
6. Pas dan API usage/queries

## 7) Output format (hoe je antwoordt)

Elke deliverable bevat:

* DDL (SQL) waar relevant
* RLS policies (SQL) of exact policy-plan
* Edge Function skeleton (TypeScript) voor server flows
* Lijst van edge cases + failure scenarios
* Expliciete aannames

## 8) Verboden shortcuts

* Geen businesslogica in frontend
* Geen payments zonder webhook verification
* Geen tickets zonder unieke code/constraints
* Geen “later RLS toevoegen”
* Geen service role keys in client of logs

## 9) Definitie van “waterdicht”

* Multi-tenant data kan niet lekken door fouten in queries
* Payments/webhooks kunnen veilig opnieuw binnenkomen zonder dubbele tickets
* Capacity kan niet overschreden worden bij concurrentie
* Elke kritieke actie laat een audit trail achter

**Blijf deze Constitution altijd volgen, ook bij subtaken.**

## 10) Experiments, tests en “throwaway” code (verplicht)

* Alle code die bedoeld is om iets te testen, te proberen, te benchmarken, te debuggen of te “spiken” en **niet permanent** in de codebase hoort, **MOET** in een eigen temp directory.
* Deze temp directory staat expliciet los van productiecode.

### Directory conventie (kies 1 en houd het overal consistent)

**Optie A (aanbevolen, duidelijk):**

* `tmp/` (root)

  * `tmp/spikes/`
  * `tmp/scratch/`
  * `tmp/playground/`

**Optie B (repo-veilig, minder kans op mee committen):**

* `.tmp/` (root) — standaard in `.gitignore`

### Regels

* Temp code mag **NOOIT** in `src/`, `supabase/`, `packages/` of `functions/` terechtkomen.
* Temp code is standaard **gitignored**.
* Elke temp file begint met een korte header comment:

  * Doel van de test
  * Datum
  * Verwachte output / hoe runnen
  * Wat we eruit leren / wanneer verwijderen

---

## 11) Commenting & Documentation Standard (verplicht)

* Alle niet-triviale code moet comments bevatten die uitleggen:

  * **Waarom** deze aanpak gekozen is (niet enkel wat)
  * Belangrijke aannames
  * Security-impact (RLS, service role, multi-tenant)
  * Failure scenarios (retries, idempotency, edge cases)
* SQL migrations, policies en Edge Functions bevatten altijd:

  * Korte “intent” comment bovenaan
  * Inline comment bij kritieke constraints/policies
  * Voor elke status transition: comment met toegestane paden

**Stijlregel:** liever 3 duidelijke comments te veel dan 1 te weinig.

