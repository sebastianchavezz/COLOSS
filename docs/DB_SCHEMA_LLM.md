# COLOSS — DB SCHEMA (LLM QUICK CONTEXT)

**Doel:**  
Snelle, correcte oriëntatie voor een LLM over de COLOSS database.  
Gebruik dit document vóór het schrijven van SQL, RPC’s of flow-logica.

---

## 1. Architectuur (mentaal model)

COLOSS is een **multi-tenant event platform** met harde backend-enforcement.

Lagen:
1. Identity & Orgs
2. Events & Settings
3. Participants & Registrations
4. Tickets & Capacity
5. Orders & Payments
6. Self-service (Transfers)
7. Integraties (Exports, Data Lake)
8. Observability (Audit & Enforcement logs)

**Belangrijk:**  
Frontend beslist niets → **backend enforceert altijd**.

---

## 2. Kritieke entrypoints (runtime)

### Public / End-User
- **Public events list/detail** → `public_events` view  
- **Checkout start** → Edge Function `create-order-public`
- **Order ophalen (public)** → `get-order-public`
- **Ticket toegang (QR/PDF)** → backend endpoints
- **Check-in** → RPC `check_in_ticket` / `perform_checkin`

### Organizer OS
- Events, tickets, orders → RLS-gated tables & RPCs
- Transfers → transfer RPCs
- Exports → `export_*` views

---

## 3. Core tables (essentie)

### Identity & Orgs
- **orgs** (`id`, `name`)
- **org_members** (`org_id`, `user_id`, `role`)
  - roles: `owner | admin | support | finance`
- **profiles** (`id`, `email`, `name`)

---

### Events & Settings
- **events**
  - `id`, `org_id`, `slug`, `status`, `starts_at`
- **public_events (VIEW)**
  - veilige publieke subset van `events`
- **event_settings**
  - (`event_id`, `domain`, `config jsonb`)
- **org_settings**
  - (`org_id`, `domain`, `config jsonb`)

**Settings hiërarchie:**  
`Event > Org > Default`  
**Fail-safe:** missing = deny

---

### Participants & Registrations
- **participants**
  - `id`, `user_id?`, `name`, `email`
- **registrations**
  - `event_id`, `participant_id`, `status`

---

### Tickets & Capacity
- **ticket_types**
  - `event_id`, `price`, `capacity`, `sales_window`
- **ticket_instances**
  - `ticket_type_id`, `registration_id`, `owner_user_id`, `qr_code`

---

### Orders & Payments
- **orders**
  - `event_id`, `email`, `status`, `total`
- **order_items**
  - `order_id`, `item_type`, `ticket_type_id?`, `qty`
- **payments**
  - `order_id`, `provider`, `status`
- **payment_events**
  - append-only webhook log

---

### Transfers (Self-service)
- **ticket_transfers**
  - `ticket_instance_id`, `to_email`, `status`
  - status: `pending | accepted | rejected | cancelled | expired`

---

### Check-in
- **ticket_checkins**
  - append-only (`ticket_instance_id`, `checked_in_at`)

---

### Audit & Observability
- **audit_log**
  - append-only actor actions
- **settings_enforcement_log** (Sprint 13)
  - `event_id`, `domain`, `reason`, `actor`
  - domain: `governance | ticket_pdf | ticket_privacy | waitlist | interest_list | capacity`
  - actor: `anon | user | system`
  - **NO PII**

---

## 4. Belangrijke enums (state machines)

- **event_status**: `draft | published | closed`
- **registration_status**: `pending | paid | cancelled | refunded | waitlisted`
- **transfer_status**: `pending | accepted | rejected | cancelled | expired`
- **payment_status**: provider-specific (see payments)

---

## 5. Publieke helpers / RPCs (contract)

### Public-safe helpers
- `is_event_public(event_id) → bool`
- `are_tickets_available(event_id) → bool`
- `is_waitlist_enabled(event_id) → bool`
- `is_interest_list_enabled(event_id) → bool`
- `get_ticket_privacy(event_id) → jsonb`
- `sanitize_ticket_data(payload, privacy) → jsonb`

### Enforcement / observability
- `log_enforcement(event_id, domain, reason, actor)`
  - **service role only**

### Organizer / internal
- `get_event_config`
- `set_event_config`
- `reset_event_config_domain`
- Transfer RPCs (initiate / accept / reject / cancel)
- Check-in RPCs

---

## 6. Exports & Data Lake (Sprint 12)

### Export views (read-only)
- `export_participants`
- `export_registrations`
- `export_orders`
- `export_payments`
- `export_checkins`

Rules:
- expliciete kolommen
- geen business logic
- RLS blijft actief

### Storage
- Bucket: `data-lake`
- Write: backend / Edge
- Read: signed URLs

---

## 7. Enforcement regels (samengevat)

- ❌ Private events → nooit zichtbaar, nooit checkout
- ❌ Tickets niet beschikbaar → geen QR / PDF / check-in
- ❌ Privacy whitelist → geen PII buiten configuratie
- ❌ Missing config → deny by default
- ✅ Enforcement → altijd gelogd in `settings_enforcement_log`

---

## 8. LLM rules (belangrijk)

- Gebruik **NOOIT** `events` publiek → alleen `public_events`
- Ga ervan uit dat **RLS altijd actief is**
- Mutaties alleen via RPC of expliciete toestemming
- Geen frontend-logica dupliceren
- Enforcement gebeurt backend-first

---

**Dit document is voldoende om:**
- flows te testen
- SQL te schrijven
- bugs te debuggen
- nieuwe features veilig te ontwerpen