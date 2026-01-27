🏁 COLOSS — TICKETING & CHECK-IN ROADMAP (POST PAYMENT)

Status:
	•	Backend enforcement & payments: ✅ DONE (Sprints 8–14)
	•	Focus nu: User-facing ticket lifecycle

⸻

🎯 OVERALL GOAL

Een volledig gesloten ticket lifecycle bouwen:
	1.	Gebruiker koopt ticket
	2.	Ziet ticket + QR in phone_ui
	3.	Kan ticket (optioneel) overdragen
	4.	Ticket kan veilig gescand worden
	5.	Organizer ziet realtime correcte status

Alles:
	•	Backend-first
	•	RLS enforced
	•	QR = single source of truth
	•	Geen frontend state hacks

⸻

🟢 SPRINT 15 — Ticket Visibility & Sold Counts ✅ DONE

**Status:** ✅ Geïmplementeerd (21 jan 2025)

**Wat is gebouwd:**

✅ **Database Views**
- `ticket_type_stats` → Organizer OS "Verkocht" kolom werkt correct
- `my_tickets_view` → phone_ui My Tickets lijst

✅ **Frontend — phone_ui**
- `/tickets` route → My Tickets pagina
- `/tickets/:id` route → Ticket detail met QR code
- Bottom navigation → "My Tickets" tab
- QR code alleen zichtbaar bij `status = 'valid'`
- Status badges: groen (VALID) / geel (PENDING)

✅ **Frontend — Organizer OS**
- EventTickets pagina gebruikt `ticket_type_stats` view
- "Verkocht" kolom toont correcte aantallen (valid + pending)
- "Remaining" berekend automatisch

✅ **Database Fix**
- Oude `issued` status → `valid` gemigreerd
- Views gebruiken `tickets` tabel (Layer 4 compatible)

**Bestanden:**
- `supabase/migrations/20240121000018_fix_stats_and_my_tickets.sql`
- `supabase/migrations/20240121000019_fix_ticket_status.sql`
- `phone_ui/src/app/pages/MyTickets.tsx`
- `phone_ui/src/app/pages/TicketDetail.tsx`
- `phone_ui/src/app/components/BottomNav.tsx`
- `web/src/data/tickets.ts` (gebruikt nu `ticket_type_stats`)

**Verificatie:**
```sql
-- Check verkocht aantallen
SELECT * FROM ticket_type_stats;

-- Check my tickets
SELECT * FROM my_tickets_view;
```

⸻

⸻

🔴 SPRINT 16 — Ticket Transfer ⛔ BLOCKED

**Status:** ⛔ BLOCKED (Schema Mismatch)

**Blocker Context:**

Het transfer systeem is gebouwd voor het **toekomstige schema** (`ticket_instances`, `ticket_instance_id`) maar de huidige productie database gebruikt het **oude schema** (`tickets`, geen `ticket_instances` tabel).

**Technisch probleem:**
- `ticket_transfers.ticket_instance_id` → Foreign key naar `public.ticket_instances(id)`
- **Maar:** `ticket_instances` tabel bestaat niet in de huidige database
- De `my_tickets_view` gebruikt `tickets` tabel
- Tijdelijke migraties hebben `issued` → `valid` status mapping gedaan, maar geen `tickets` → `ticket_instances` migratie

**Wat er WEL werkt:**
- ✅ Frontend UI (TransferModal, PendingTransfers pagina)
- ✅ Accept/Reject RPC's (`accept_ticket_transfer`, `reject_ticket_transfer`)
- ✅ RLS policies voor transfers
- ✅ Audit logging infrastructure

**Wat er NIET werkt:**
- ❌ Transfer initiatie (foreign key constraint violation)
- ❌ Insert into `ticket_transfers` tabel

**Oplossing vereist:**

Één van deze twee acties:

**Optie A: Schema migratie** (aanbevolen, grondig)
```sql
-- Migreer tickets → ticket_instances
-- Update alle foreign keys
-- Update views
-- Test end-to-end
```

**Optie B: Quick fix** (tijdelijk, niet schema-compliant)
```sql
-- Wijzig ticket_transfers.ticket_instance_id 
-- om te verwijzen naar tickets(id)
-- Breekt echter de bedoelde architectuur
```

**Aanbeveling:** 
Voer eerst de **volledige `tickets` → `ticket_instances` migratie** uit zoals gedocumenteerd in Layer 4 schema, dan komt Sprint 16 vanzelf beschikbaar.

**Work-around voor nu:**
Transfers kunnen **handmatig** via Supabase dashboard aangemaakt worden voor testing, of gebruik de bestaande RPC's via SQL.

**Bestanden klaar voor deployment (na schema fix):**
- `phone_ui/src/app/components/TransferModal.tsx`
- `phone_ui/src/app/pages/PendingTransfers.tsx`
- `phone_ui/src/app/pages/TicketDetail.tsx` (transfer button)
- RLS policy: `ADD_TRANSFER_INSERT_POLICY.sql`

⸻

⸻

� SPRINT 17 — Check-In App (SCANNER) ⛔ BLOCKED

**Status:** ⛔ BLOCKED (Schema Mismatch - zelfde als Sprint 16)

**Blocker:**
- `perform_checkin` RPC gebruikt `ticket_instances` tabel (regel 162)
- De huidige database heeft alleen `tickets` tabel
- QR codes worden gelezen via `ti.token_hash` op `ticket_instances`

**Afhankelijkheid:**
Sprint 17 is **direct afhankelijk** van dezelfde schema migratie als Sprint 16 (`tickets` → `ticket_instances`).

**Backend is WEL klaar:**
- ✅ `perform_checkin(ticket_raw_token, event_id)` RPC
- ✅ Privacy filtering via `get_ticket_privacy` + `sanitize_ticket_data`
- ✅ Idempotency (double-scan detectie)
- ✅ Audit logging
- ✅ `ticket_checkins` tabel

**Frontend is NOG TE BOUWEN:**
- ❌ Scanner UI (camera + QR decode)
- ❌ Scan result states (Valid/Already/Invalid/Error)
- ❌ Event selector (organizer moet event kiezen)

**Aanbeveling:**
Sprint 17 uitvoeren **direct NA** de `tickets` → `ticket_instances` migratie, omdat de backend volledig klaar is.

⸻

⸻

🟢 SPRINT 18 — User Flows & Polish

Doel

Alles “af” maken zonder nieuwe businesslogica.

⸻

phone_ui
	•	“My Tickets” prominent
	•	Status badges
	•	Empty states
	•	Error copy

Organizer OS
	•	Check-in count
	•	Realtime refresh (polling)
	•	CSV export (Sprint 12 views)

⸻

🧱 ARCHITECTURE RULES (NIET BREKEN)

❌ Geen frontend state machines
❌ Geen duplicatie van status
❌ Geen client-side QR validatie

✅ DB = waarheid
✅ Edge Functions = poort
✅ RLS overal

⸻

EINDRESULTAAT

Na deze sprints heeft COLOSS:
	•	✔️ Betaling → ticket → QR → check-in → audit
	•	✔️ Organizer controle
	•	✔️ Gebruiker autonomie
	•	✔️ Schaalbare basis

⸻

Als volgende stap kunnen we:
	•	🔁 Realtime updates
	•	📊 Organizer analytics dashboards
	•	🎟️ Group tickets / team registrations
	•	🧾 Invoices & payouts

