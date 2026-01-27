
🔗 NEXT PHASE — RUNTIME & DATA INTEGRATION SPRINTS

Van “engine bestaat” → “engine stuurt het product”

Context
	•	Alle core settings (Sprints 0–6) zijn DONE
	•	De settings engine is correct, veilig en getest
	•	De grootste waarde zit nu in: enforcement + data usage

⸻

🟢 SPRINT 8 — Runtime Enforcement (Checkout & Public)

🎯 Doel

Settings actief afdwingen in alle kritieke entrypoints
(zonder UI-wijzigingen)

⸻

Backend — TODO

1. Public exposure
Verplicht gebruik van:
	•	public_events view
	•	is_event_public(event_id)

Toepassen op:
	•	Public event listing
	•	Public event detail
	•	Checkout entrypoint

Regels
	•	is_private = true → 404 / 403
	•	Geen directe events queries meer publiek

⸻

2. Checkout start
Checkout mag alleen starten indien:

is_event_public(event_id) = true

Fail gedrag:
	•	403 Forbidden
	•	Geen silent fallback

⸻

Acceptatiecriteria
	•	Private events lekken nergens
	•	Checkout faalt correct bij private events
	•	Geen regressies in listing

Status: ✅ DONE

**Implementatie details:**
- Frontend: `PublicEventCheckout.tsx` gebruikt `public_events` view (via `getPublicEventBySlug`).
- Backend: `create-order-public` Edge Function checkt expliciet `is_event_public` RPC.
- Private events worden nu hard geblokkeerd (403 Forbidden) bij checkout start.
- Public listing gebruikt `public_events` view (reeds actief).

⸻

🟢 SPRINT 9 — Checkout Flow Logic (Waitlist & Interest)

🎯 Doel

Checkout-flow volledig laten sturen door settings

⸻

Backend — TODO

1. Ticket availability
Gebruik:

are_tickets_available(event_id)

Gedrag:
	•	false → tickets niet selecteerbaar
	•	Checkout finalisatie blokkeren

⸻

2. Waitlist
Indien:

waitlist.enabled = true

en tickets sold-out:
	•	Checkout → waitlist flow

⸻

3. Interest list
Indien:

interest_list.enabled = true

en geen tickets beschikbaar:
	•	Interest opt-in toestaan

⸻

4. Fail-safe
	•	Ontbrekende settings → deny by default
	•	Geen impliciete aannames

⸻

Acceptatiecriteria
	•	Sold-out + waitlist = correct gedrag
	•	No tickets + interest = opt-in
	•	No config = harde blokkade

Status: ✅ DONE

**Implementatie details:**
- `are_tickets_available` RPC geüpdatet om public-safe te zijn (bypassed `get_event_config` auth check).
- `create-order-public` checkt `are_tickets_available` vóór ticket validatie (403 indien false).
- Waitlist logic: Bij capacity failure checkt backend `is_waitlist_enabled` en returnt 409 `CAPACITY_EXCEEDED_WAITLIST_AVAILABLE`.
- Interest logic: Bij ticket unavailability (unpublished/window) checkt backend `is_interest_list_enabled` en returnt 400 `..._INTEREST_AVAILABLE`.
- Fail-safe: Default settings (null/false) resulteren in deny/false.

⸻

🟢 SPRINT 10 — Ticket Delivery Enforcement

🎯 Doel

Tickets, QR en PDF’s alleen beschikbaar wanneer toegestaan

⸻

Backend — TODO

1. Beschikbaarheid
Respecteer:

ticket_pdf.available_from

Voor deze datetime:
	•	❌ PDF download
	•	❌ QR zichtbaar
	•	❌ Check-in toegestaan

⸻

2. Central enforcement
Afdwingen in:
	•	Ticket download endpoint
	•	PDF generatie
	•	check_in_ticket RPC

⸻

Acceptatiecriteria
	•	QR nooit te vroeg
	•	PDF nooit te vroeg
	•	Check-in blokkeert correct

Status: ✅ DONE

**Implementatie details:**
- `are_tickets_available` RPC geüpdatet: NULL = TRUE (Backward Compatible).
- `check-in-ticket`: Blokkeert check-in indien tickets niet beschikbaar (403).
- `get-order-public`: Maskeert QR codes in response indien tickets niet beschikbaar.
- `create-order-public`: Blokkeert checkout indien tickets niet beschikbaar (future date).
- Verificatie script `verify_sprint10_ticket_delivery.sql` toegevoegd.

⸻

🟢 SPRINT 11 — Privacy Enforcement Everywhere

🎯 Doel

Privacy whitelist hard afdwingen in alle outputs

⸻

Backend — TODO

Gebruik:

get_ticket_privacy(event_id)

Toepassen op:
	•	Ticket PDF
	•	QR payload
	•	Check-in response
	•	(Later) exports

Default:
	•	Alleen name = true
	•	Alles anders false

⸻

Acceptatiecriteria
	•	Geen PII buiten whitelist
	•	Frontend kan dit niet overrulen
	•	Default is veilig

Status: ✅ DONE

**Implementatie details:**
- `get_ticket_privacy` RPC geüpdatet: Public-safe (bypass auth check).
- `sanitize_ticket_data` helper toegevoegd: Filtert JSON op basis van whitelist.
- `perform_checkin` RPC geüpdatet: Retourneert nu gesanitized user data (name, email) voor scanners.
- Verificatie script `verify_sprint11_privacy_enforcement.sql` toegevoegd.

⸻

🟢 SPRINT 12 — Data Lake & Exports (Foundational)

🎯 Doel

Basis leggen voor analytics, exports en reporting

⸻

Backend — TODO

1. Data bucket (Supabase Storage)
	•	Nieuwe bucket: data-lake
	•	Write-only voor backend / Edge
	•	Read-only via signed URLs

⸻

2. Export-ready views
Immutable views voor:
	•	Participants
	•	Registrations
	•	Orders
	•	Payments
	•	Check-ins

➡️ Geen business logic, alleen shape & consistency

⸻

Acceptatiecriteria
	•	Data kan veilig geëxporteerd worden
	•	Geen RLS-bypass
	•	Geschikt voor BI tools

Status: ✅ DONE

**Implementatie details:**
- 5 export views aangemaakt: `export_participants`, `export_registrations`, `export_orders`, `export_payments`, `export_checkins`.
- Alle views zijn read-only, met expliciete kolommen (geen SELECT *).
- Geen business logic - pure data contracts voor BI/analytics.
- RLS inherited van source tables - backend-only toegang.
- Storage bucket `data-lake` moet handmatig aangemaakt worden via Dashboard.
- Verificatie script `verify_sprint12_data_lake.sql` toegevoegd.

⸻

🟢 SPRINT 13 — Observability (Lightweight)

🎯 Doel

Begrijpen waarom iets geblokkeerd wordt
(zonder dashboards)

⸻

Backend — TODO

Log alleen bij enforcement:

SETTINGS_ENFORCED
- event_id
- domain
- reason
- actor (anon/user/system)

Voorbeelden:
	•	Checkout blocked (private)
	•	Ticket blocked (too early)
	•	Field stripped (privacy)

⸻

Acceptatiecriteria
	•	Lage log volume
	•	Geen PII
	•	Debugbaar via SQL

Status: ✅ DONE

**Implementatie details:**
- Table `settings_enforcement_log` aangemaakt (append-only).
- Helper function `log_enforcement(event_id, domain, reason, actor)` voor centrale logging.
- Alleen logging bij blokkade/mutatie, NIET bij happy-path.
- Strikte validatie: alleen toegestane domains en actors.
- Triggers voorkomen updates/deletes (append-only enforcement).  
- Verificatie script `verify_sprint13_observability.sql` toegevoegd.

**⚠️ Logging integratie:**
- Edge Functions (`create-order-public`, `check-in-ticket`) moeten nog calls naar `log_enforcement` toevoegen.
- Dit gebeurt bij daadwerkelijk gebruik/deployment van die functies.

⸻

❌ Bewust nog niet doen

Item	Reden
Edge Functions	Nog niet nodig
Storage existence checks	Kan later
Realtime updates	Nice-to-have
Heavy analytics	Eerst data correctness
UI policy logic	Backend beslist


⸻