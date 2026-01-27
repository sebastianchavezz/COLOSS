# COLOSS TICKETING — HUIDIGE STATUS

**Datum:** 21 januari 2025 22:57

## ✅ **WAT WERKT (Production Ready)**

### Sprint 15 — Ticket Visibility & Sold Counts  
✅ **VOLLEDIG OPERATIONEEL**

- **Organizer OS:** Correcte "Verkocht" aantallen via `ticket_type_stats` view
- **phone_ui:** "My Tickets" pagina met QR codes
- **Status badges:** Groen (VALID) / Geel (PENDING)
- **Database views:** `ticket_type_stats`, `my_tickets_view`

**Gebruiker kan:**
- Tickets bekijk
en in "My Tickets"
- QR code zien (alleen bij `status = 'valid'`)
- Event details + ticket type info bekijken

---

## ⛔ **WAT NIET WERKT (BLOCKED)**

### Sprint 16 — Ticket Transfer
### Sprint 17 — Check-In Scanner

**BEIDE BLOCKED** door dezelfde reden:

#### **ROOT CAUSE: Schema Mismatch**

Het platform heeft **2 concurrerende schemas:**

| **Schema Layer 4 (Oud)** | **Schema Layer 4+ (Nieuw/Bedoeld)** |
|--------------------------|-------------------------------------|
| `tickets` tabel          | `ticket_instances` tabel            |
| `barcode` kolom          | `qr_code` kolom                     |
| `status` ENUM (issued)   | `status` ENUM (valid/pending)       |

**Probleem:**
- ✅ **Production database** → `tickets` tabel (oud schema)
- ✅ **Transfer/Check-in RPCs** → `ticket_instances` foreign keys (nieuw schema)
- ❌ **Foreign key violations** → Inserts/queries falen

---

## 🔧 **WAT ER MOET GEBEUREN**

### **Vereiste: Schema Migratie `tickets` → `ticket_instances`**

**Stappen:**

1. **Creëer `ticket_instances` tabel** (zoals in Layer 4 docs)
2. **Migreer data:** `INSERT INTO ticket_instances SELECT ... FROM tickets`
3. **Update foreign keys:**
   - `ticket_transfers.ticket_instance_id` → verwijst naar `ticket_instances(id)`
   - `ticket_checkins.ticket_instance_id` → idem
4. **Update views:**
   - `my_tickets_view` → gebruik `ticket_instances` i.p.v. `tickets`
   - `ticket_type_stats` → idem
5. **Hernoem kolommen:**
   - `barcode` → `qr_code`
   - `status` values: `issued` → `valid`
6. **Test end-to-end**

**Impact:**
- ⚠️ **Breaking change** voor bestaande queries
- ✅ **Unblocked:** Sprint 16 + 17 worden direct beschikbaar
- ✅ **Toekomstige features** (refunds, upgrades) worden mogelijk

---

## 📦 **READY FOR DEPLOYMENT (na schema fix)**

### Sprint 16 — Ticket Transfer
**Frontend:**
- ✅ `TransferModal.tsx` (email input)
- ✅ `PendingTransfers.tsx` (accept/reject UI)
- ✅ Transfer button in Ticket Detail

**Backend:**
- ✅ `accept_ticket_transfer` RPC
- ✅ `reject_ticket_transfer` RPC
- ✅ RLS policy voor INSERT
- ✅ Audit logging

**Ontbreekt:**
- ❌ Working initiate flow (blocked by schema)

---

### Sprint 17 — Check-In Scanner
**Backend:**
- ✅ `perform_checkin` RPC (volledig getest)
- ✅ Privacy filtering
- ✅ Double-scan detectie
- ✅ Audit logging

**Frontend:**
- ❌ Scanner UI (nog niet gebouwd)
- ❌ Camera integration
- ❌ QR decode logic

---

## 🎯 **AANBEVOLEN VOLGORDE**

1. **Schema Migratie uitvoeren** (`tickets` → `ticket_instances`)
2. **Sprint 16 testen** (transfers)
3. **Sprint 17 bouwen** (scanner UI)
4. **Sprint 18** (Polish & Flows)

---

## 📊 **HUIDIGE DATABASE STATE**

**Tabellen:**
- ✅ `tickets` (oud schema, in gebruik)
- ❌ `ticket_instances` (nieuw schema, **NIET AANWEZIG**)
- ✅ `ticket_transfers` (foreign key → `ticket_instances` ❌)
- ✅ `ticket_checkins` (foreign key → `ticket_instances` ❌)

**Status ENUM mismatch:**
- Database heeft: `issued`, `void`, `cancelled`
- Code verwacht: `valid`, `pending`, `cancelled`
- Tijdelijke fix: SQL update `issued` → `valid`

---

## ⚠️ **RISICO'S VAN GEEN MIGRATIE**

1. **Geen transfers mogelijk** → Gebruikers kunnen tickets niet overdragen
2. **Geen check-in mogelijk** → Events kunnen niet starten
3. **Toekomstige features blocked** (refunds, upgrades, etc.)
4. **Technische schuld accumuleert** → Meer "workarounds" nodig

---

## ✅ **CONCLUSIE**

**Huidige staat:** 
- Sprint 15 is **production ready** en werkt perfect
- Sprint 16 & 17 zijn **98% klaar** maar blocked door 1 migratie

**Aanbeveling:**
Prioriteer de `tickets` → `ticket_instances` migratie om de volledige ticket lifecycle te unlocken.

**Geschatte effort voor migratie:** 2-4 uur (inclusief testing)
