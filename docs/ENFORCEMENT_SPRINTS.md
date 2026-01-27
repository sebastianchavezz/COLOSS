
🔗 SETTINGS INTEGRATION ROADMAP

Van configuratie → afdwingbaar productbeleid

Context:
Alle settings-sprints (0–6) zijn DONE.
De settings-engine is veilig, gevalideerd en RBAC-correct, maar moet nu actief gebruikt worden in runtime flows.

⸻

🟢 INTEGRATIE SPRINT 8 — Public Exposure & Governance Enforcement

🎯 Doel

Garanderen dat private events nergens publiek lekken en dat governance altijd wordt afgedwongen.

⸻

Backend — ⏳ TODO

1. Publieke event listing
	•	Verplicht gebruik van:
	•	public_events view
of
	•	is_event_public(event_id)
	•	❌ Geen directe events table queries meer in publieke context

2. Event detail (public)
	•	Event detail endpoint:
	•	Returnt 404 indien is_private = true
	•	Geen informatielekken via slug of ID

3. Checkout entrypoint
	•	Checkout mag enkel starten indien:

is_event_public(event_id) = true


	•	Private event → 403 Forbidden

⸻

Acceptatiecriteria
	•	Private event verschijnt nergens publiek
	•	Checkout van private event faalt hard
	•	Geen regressies in event listing

Status: ✅ DONE

**Implementatie details:**
- `public_events` view en `is_event_public` functie zijn actief (uit Sprint 1).
- Frontend (`PublicEventCheckout.tsx`) gebruikt nu `getPublicEventBySlug` die queryt op `public_events`.
- Private events returnen `null` in de data layer, waardoor de checkout flow stopt met "Event niet gevonden of niet beschikbaar".
- Geen directe `events` table queries meer in de publieke checkout flow.

⸻

🟢 INTEGRATIE SPRINT 9 — Checkout Flow Enforcement

🎯 Doel

Checkout flow volledig laten sturen door settings:
	•	governance
	•	waitlist
	•	interest list
	•	availability

⸻

Backend — ⏳ TODO

1. Ticket beschikbaarheid
	•	Gebruik:

are_tickets_available(event_id)


	•	Indien false:
	•	❌ tickets niet selecteerbaar
	•	❌ checkout finalisatie blokkeren

2. Wachtlijst
	•	Indien:

waitlist.enabled = true

én tickets sold-out:
	•	checkout → waitlist flow

3. Interesselijst
	•	Indien:

interest_list.enabled = true

én geen tickets beschikbaar:
	•	interest opt-in toestaan

4. Fail-safe
	•	Ontbrekende settings:
	•	checkout blokkeert
	•	geen silent fallback

⸻

Acceptatiecriteria
	•	Sold-out + waitlist → correcte flow
	•	Geen tickets + interest list → opt-in mogelijk
	•	Geen tickets + geen settings → harde blokkade

Status: ⏳ TODO

⸻

🟢 INTEGRATIE SPRINT 10 — Ticket & PDF Availability

🎯 Doel

Tickets, QR-codes en PDF’s alleen tonen wanneer toegestaan.

⸻

Backend — ⏳ TODO

1. Beschikbaarheid
	•	Respecteer:

ticket_pdf.available_from


	•	Voor deze datetime:
	•	❌ QR-code niet zichtbaar
	•	❌ PDF niet downloadbaar
	•	❌ check-in weigert

2. Central enforcement
	•	Enforcement in:
	•	ticket download endpoint
	•	PDF generatie
	•	check-in RPC

⸻

Acceptatiecriteria
	•	Tickets vóór tijdstip onzichtbaar
	•	QR nooit voortijdig uitleesbaar
	•	Check-in faalt vóór beschikbaarheid

Status: ⏳ TODO

⸻

🟢 INTEGRATIE SPRINT 11 — Privacy Enforcement (Tickets & Check-In)

🎯 Doel

Persoonsgegevens alleen tonen indien expliciet toegestaan.

⸻

Backend — ⏳ TODO

1. Privacy whitelist
Gebruik:

get_ticket_privacy(event_id)

2. Enforcement scope
Whitelist afdwingen op:
	•	Ticket PDF
	•	QR payload
	•	Check-in response
	•	Organizer exports (later)

3. Default gedrag
	•	Ontbrekende config:
	•	toon enkel naam
	•	niets anders

⸻

Acceptatiecriteria
	•	Alleen whitelisted velden zichtbaar
	•	Geen frontend trust
	•	Geen privacy regressies

Status: ⏳ TODO

⸻

🟢 INTEGRATIE SPRINT 12 — Hardening & Guardrails

🎯 Doel

Onmogelijk maken om in een ongeldige state te belanden.

⸻

Backend — ⏳ TODO

1. Consistentie checks
Blokkeer:
	•	published event zonder governance
	•	ticket delivery zonder ticket_pdf config

2. Fail-safe defaults
	•	Bij ontbrekende settings:
	•	veiligste gedrag (deny by default)

3. Error discipline
	•	403 → policy violation
	•	422 → invalid state
	•	Geen “silent success”

⸻

Acceptatiecriteria
	•	Geen undefined gedrag
	•	Geen half-geldige flows
	•	Errors zijn expliciet en verklaarbaar

Status: ⏳ TODO

⸻

🟢 INTEGRATIE SPRINT 13 — Observability (Light)

🎯 Doel

Zicht krijgen op waarom iets geblokkeerd wordt (zonder heavy analytics).

⸻

Backend — ⏳ TODO

Logging events
Log enkel bij enforcement:

SETTINGS_ENFORCED
- event_id
- domain
- reason
- actor (anon/user/system)

Voorbeelden:
	•	checkout blocked (private event)
	•	ticket blocked (not available yet)
	•	privacy field stripped

⸻

Acceptatiecriteria
	•	Logs zijn laag volume
	•	Geen PII in logs
	•	Debugging mogelijk zonder dashboard

Status: ⏳ TODO

⸻

❌ Bewust uitgesloten uit Integratie

Feature	Reden
Edge Functions	Nog niet nodig
Storage existence checks	Later
Realtime updates	Nice-to-have
Frontend policy logic	Backend beslist
Analytics dashboards	Post-MVP


⸻

🧠 Strategische Conclusie

Na deze integratie-sprints:
	•	Settings zijn geen configuratie meer
	•	Settings zijn productbeleid
	•	Elk kritisch pad is:
	•	afdwingbaar
	•	verklaarbaar
	•	auditbaar

👉 Dit is het punt waar jullie structureel sterker worden dan Atleta.

⸻