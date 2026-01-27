# COLOSS Platform - Feature Implementation Status

**Laatste update:** 2026-01-21  
**Database migrations:** Sprints 0-13 DONE  
**Status:** Backend infrastructure compleet, frontend features variabel

---

## ✅ 1) Event aanmaken → publiceren → activeren

**Status: ✅ VOLLEDIG (Backend)**

**Wat werkt:**
- ✅ Events table met status enum: `draft`, `published`, `closed`
- ✅ Event settings (via settings hierarchy)
- ✅ Governance settings (is_private toggle)
- ✅ Basic info (naam, beschrijving, locatie, start_time)
- ✅ RLS policies (org members only)

**Backend files:**
- `20240119000002_layer_2_events.sql`
- `20240121000004_sprint1_governance_legal.sql`

**Frontend status:** ❓ Te verifiëren

---

## ✅ 2) Ticketcatalogus beheren

**Status: ✅ VOLLEDIG (Backend)**

**Wat werkt:**
- ✅ `ticket_types` table (name, price, currency, capacity, status)
- ✅ Sales windows (sales_start, sales_end)
- ✅ Status toggle: `draft`, `published`, `archived`
- ✅ Capacity management (capacity_total, capacity_remaining)
- ✅ RLS policies (org members CRUD)

**Backend files:**
- `20240119000004_layer_4_tickets.sql`
- `20240120000003_ticket_types_improvements.sql`

**Frontend status:** ❓ Te verifiëren

---

## ❌ 3) Producten/add-ons beheren

**Status: ❌ NIET GEÏMPLEMENTEERD**

**Wat ontbreekt:**
- ❌ `products` table (t-shirt, parking, etc.)
- ❌ Product-ticket koppeling
- ❌ Stock/limieten
- ❌ Order items voor non-ticket products

**Note:** `order_items` table bestaat wel, maar is nu alleen voor tickets.

**Prioriteit:** Medium (nice-to-have voor volledig platform)

---

## ❌ 4) Codes & gating (distributie)

**Status: ❌ NIET GEÏMPLEMENTEERD**

**Wat ontbreekt:**
- ❌ Invitation codes table
- ❌ Kortingscodes/coupons table
- ❌ Redemption tracking
- ❌ Rules engine (scope, usage limits, combinaties)

**Prioriteit:** Medium-High (belangrijk voor marketing/distributie)

---

## ✅ 5) Inschrijvingen & deelnemersbeheer

**Status: ✅ VOLLEDIG (Backend)**

**Wat werkt:**
- ✅ `participants` table (profielen)
- ✅ `registrations` table (event-participant koppeling)
- ✅ Registration status: `pending`, `confirmed`, `waitlist`, `cancelled`
- ✅ Registration questions/answers (dynamische velden)
- ✅ RLS policies
- ✅ Export view: `export_participants`, `export_registrations`

**Backend files:**
- `20240119000003_layer_3_registrations.sql`
- `20240120000018_registration_system.sql`

**Frontend status:** ❓ Te verifiëren (lijsten, filters, acties)

---

## ✅ 6) Payments setup & financiële status

**Status: ✅ VOLLEDIG (Backend)**

**Wat werkt:**
- ✅ `orders` table (status flow: pending → paid → failed/cancelled/refunded)
- ✅ `payments` table (provider, amount, status)
- ✅ `payment_events` table (webhook audit trail)
- ✅ Payment provider settings (via settings hierarchy)
- ✅ Idempotency (checkout_session_id, idempotency_key)
- ✅ Export view: `export_orders`, `export_payments`

**Backend files:**
- `20240119000005_layer_5_orders.sql`
- `20240120000012_payments_webhooks.sql`

**Refunds:** ⚠️ Partieel (payment_status enum heeft 'refunded', maar geen separate refunds table)

**Frontend status:** ❓ Te verifiëren (orders overzicht, exports)

---

## ✅ 7) Communicatie flows

**Status: ✅ VOLLEDIG (Backend)**

**Wat werkt:**
- ✅ Communication settings (reply_to_email, default_locale)
- ✅ Content communication settings (checkout_message, email_subject, email_body)
- ✅ Multi-locale support (nl, en, fr)
- ✅ Extra recipients (max 5 emails)
- ✅ Settings hierarchy (Event > Org > Default)

**Backend files:**
- `20240121000001_settings_mvp.sql`
- `20240121000006_sprint2_content_communication.sql`

**Bulk mail:** ❌ Niet geïmplementeerd

**Frontend status:** ❓ Te verifiëren (template editor)

---

## ⚠️ 8) Waitlist flow

**Status: ⚠️ PARTIEEL**

**Wat werkt:**
- ✅ Waitlist settings (enabled toggle via settings hierarchy)
- ✅ Waitlist enforcement (Sprint 9)
- ✅ Registration status 'waitlist'

**Wat ontbreekt:**
- ❌ `waitlist_entries` table (niet gevonden)
- ❌ `waitlist_offers` table (niet gevonden)
- ❌ Offer uitsturen flow
- ❌ Accept/expire logic

**Backend files:**
- `20240121000008_sprint4_waitlist_interest.sql` (settings only)
- `20240121000010_sprint9_enforcement.sql` (enforcement helpers)

**Note:** Settings infrastructuur bestaat, maar flow tabellen ontbreken.

**Prioriteit:** High (als waitlist feature belangrijk is)

---

## ✅ 9) Ticket PDF / QR / scanning

**Status: ✅ VOLLEDIG (Backend)**

**Wat werkt:**
- ✅ `ticket_instances` table (QR codes, token_hash)
- ✅ Ticket PDF settings (available_from, banner_image_id)
- ✅ Ticket privacy settings (whitelist PII velden)
- ✅ QR generation (secure random tokens)
- ✅ Check-in RPC (`perform_checkin`)
- ✅ Ticket delivery enforcement (Sprint 10)
- ✅ Privacy sanitization (Sprint 11)

**Backend files:**
- `20240120000004_ticket_instances.sql`
- `20240120000017_checkin_rpc.sql`
- `20240121000009_sprint6_ticket_pdf_privacy.sql`
- `20240121000010_sprint10_enforcement.sql`

**Frontend status:** ❓ Scanner app nog te bouwen

---

## ✅ 10) Transfers / resale

**Status: ✅ VOLLEDIG (Backend)**

**Wat werkt:**
- ✅ `ticket_transfers` table (from_ticket, to_user/email, status)
- ✅ Transfer status: `pending`, `accepted`, `cancelled`, `expired`, `rejected`
- ✅ Transfer RPCs (`initiate_transfer`, `accept_transfer`, `cancel_transfer`)
- ✅ Ownership updates + audit trail
- ✅ Expiry handling (transfer_expiry_hours setting)
- ✅ Transfer settings (enabled toggle, cancel_roles)

**Backend files:**
- `20240120000020_ticket_transfers.sql`
- `20240120000025_transfer_lifecycle.sql`
- `20240120000029_accept_reject_transfers.sql`

**Frontend status:** ❓ Te verifiëren (initiate/accept flows)

---

## ✅ 11) Reporting & attribution

**Status: ✅ VOLLEDIG (Backend)**

**Wat werkt:**
- ✅ Export views (Sprint 12):
  - `export_participants`
  - `export_registrations`
  - `export_orders`
  - `export_payments`
  - `export_checkins`
- ✅ Audit logging (`audit_log` table)
- ✅ Enforcement logging (`settings_enforcement_log` - Sprint 13)
- ✅ CSV/Parquet export ready
- ✅ BI tool compatible

**Backend files:**
- `20240121000013_sprint12_data_lake.sql`
- `20240121000014_sprint13_observability.sql`

**Dashboards:** ❌ Niet geïmplementeerd (frontend)

**Prioriteit:** Medium (data is er, UI moet gebouwd worden)

---

## ✅ 12) Rollen & permissies

**Status: ✅ VOLLEDIG (Backend)**

**Wat werkt:**
- ✅ `org_members` table (user_id, org_id, role)
- ✅ Roles: `owner`, `admin`, `support`, `finance`
- ✅ RBAC via settings:
  - Payments: owner/admin/finance
  - Transfers: owner/admin/support
  - Governance/Legal: owner/admin only
  - Check-in: owner/admin/support (finance blocked)
- ✅ RLS policies per role
- ✅ `get_event_config_permissions` RPC

**Backend files:**
- `20240119000001_layer_1_identity.sql`
- `20240121000001_settings_mvp.sql` (RBAC per domain)

**Frontend status:** ❓ Te verifiëren (org members admin UI)

---

## 📊 Samenvatting

| Feature | Backend | Frontend | Prioriteit |
|---------|---------|----------|------------|
| 1. Events | ✅ Compleet | ❓ Check | - |
| 2. Tickets | ✅ Compleet | ❓ Check | - |
| 3. Products | ❌ Ontbreekt | ❌ | Medium |
| 4. Codes | ❌ Ontbreekt | ❌ | Medium-High |
| 5. Deelnemers | ✅ Compleet | ❓ Check | - |
| 6. Payments | ✅ Compleet | ❓ Check | - |
| 7. Communicatie | ✅ Compleet | ❓ Check | - |
| 8. Waitlist | ⚠️ Partieel | ❌ | High |
| 9. Tickets/QR | ✅ Compleet | ⚠️ Scanner | - |
| 10. Transfers | ✅ Compleet | ❓ Check | - |
| 11. Reporting | ✅ Compleet | ❌ Dashboards | Medium |
| 12. RBAC | ✅ Compleet | ❓ Check | - |

**Legenda:**
- ✅ Compleet = Database + RPCs + RLS + Enforcement
- ⚠️ Partieel = Basis bestaat, maar niet alle features
- ❌ Ontbreekt = Nog niet geïmplementeerd
- ❓ Check = Backend klaar, frontend status onbekend

---

## 🎯 Aanbevelingen

### Kortetermijn (Must-have voor MVP):
1. **Verifieer frontend status** van compleet gemarkeerde features
2. **Implementeer Waitlist tabellen** (`waitlist_entries`, `waitlist_offers`)
3. **Implementeer Codes/Coupons** (als marketing/distributie belangrijk is)

### Middellange termijn (Nice-to-have):
4. **Products/Add-ons** (t-shirts, parking, etc.)
5. **Refunds table** (nu alleen status enum)
6. **Dashboards** (data is er via export views)

### Langetermijn (Optioneel):
7. **Bulk mail** systeem
8. **Advanced analytics** bovenop export views
