# Sprint S1: Atleta-style Ticket Configuration

**Flow**: F005 Ticket Selection
**Type**: UPGRADE (not new)
**Date**: 2025-01-27
**Status**: 🟡 Active

---

## Context

### Huidige Staat
- `ticket_types` tabel bestaat met: name, description, price, vat_percentage, capacity_total, sales_start, sales_end, status, sort_order, currency
- `ticket_instances` tabel bestaat voor verkochte tickets met QR codes
- Basis RLS policies voor org members en public access

### Doel
Breid ticket configuratie uit naar Atleta-niveau met 6 subtab-domeinen:
1. **Basisinformatie** - i18n naam, beschrijving, afstand, afbeelding, instructies
2. **Prijzen** - bedrag, BTW, toekomstige pricing tiers
3. **Tickettype** - semantisch type (individueel, team, relay, kids)
4. **Teams** - team settings (min/max size, captain logic)
5. **Beperkingen** - verkoopvenster, max per deelnemer, zichtbaarheid
6. **Tijdslots** - start waves/slots selecteerbaar in checkout

---

## Scope

### IN SCOPE
- Nieuwe kolommen op `ticket_types` voor basis velden
- Nieuwe tabellen: `ticket_type_i18n`, `ticket_time_slots`, `ticket_team_config`
- Settings domain: `tickets.*`
- RPC's voor CRUD operaties
- Validatie triggers

### OUT OF SCOPE
- Consumer-side teams UX
- Scanning/timing integraties
- Kortingen/coupons (apart)
- Reporting dashboards

---

## Database Changes

### 1. ALTER ticket_types (bestaande tabel)
```sql
-- Basisinformatie
ADD COLUMN distance_value NUMERIC(10,2)
ADD COLUMN distance_unit TEXT CHECK (unit IN ('km', 'm', 'mi', 'hrs'))
ADD COLUMN image_url TEXT
ADD COLUMN instructions JSONB  -- i18n: {"nl": "...", "en": "..."}

-- Tickettype
ADD COLUMN ticket_category TEXT CHECK (category IN ('individual', 'team', 'relay', 'kids', 'vip', 'other'))

-- Beperkingen
ADD COLUMN max_per_participant INTEGER DEFAULT NULL
ADD COLUMN visibility TEXT CHECK (visibility IN ('visible', 'hidden', 'invitation_only'))
ADD COLUMN requires_invitation_code BOOLEAN DEFAULT FALSE
```

### 2. CREATE ticket_type_i18n (nieuwe tabel)
```sql
CREATE TABLE ticket_type_i18n (
  id UUID PRIMARY KEY,
  ticket_type_id UUID REFERENCES ticket_types(id),
  locale TEXT NOT NULL,  -- 'nl', 'en', etc.
  name TEXT NOT NULL,
  description TEXT,
  instructions TEXT,
  UNIQUE(ticket_type_id, locale)
);
```

### 3. CREATE ticket_time_slots (nieuwe tabel)
```sql
CREATE TABLE ticket_time_slots (
  id UUID PRIMARY KEY,
  ticket_type_id UUID REFERENCES ticket_types(id),
  slot_time TIME NOT NULL,
  slot_date DATE,  -- NULL = elke eventdag
  label TEXT,      -- "Wave A", "08:00 Start"
  capacity INTEGER,
  sort_order INTEGER DEFAULT 0,
  UNIQUE(ticket_type_id, slot_time, slot_date)
);
```

### 4. CREATE ticket_team_config (nieuwe tabel)
```sql
CREATE TABLE ticket_team_config (
  id UUID PRIMARY KEY,
  ticket_type_id UUID REFERENCES ticket_types(id) UNIQUE,
  team_required BOOLEAN DEFAULT FALSE,
  team_min_size INTEGER DEFAULT 2,
  team_max_size INTEGER DEFAULT 10,
  allow_incomplete BOOLEAN DEFAULT FALSE,  -- Kan team starten zonder vol te zijn?
  captain_required BOOLEAN DEFAULT TRUE
);
```

### 5. Settings Domain: tickets.*
```
tickets.defaults.currency
tickets.defaults.vat_percentage
tickets.checkout.show_remaining_capacity
tickets.checkout.low_stock_threshold
tickets.time_slots.enabled
tickets.teams.enabled
```

---

## Implementation Order

1. **Migration 1**: ALTER ticket_types + nieuwe kolommen
2. **Migration 2**: CREATE ticket_type_i18n + RLS
3. **Migration 3**: CREATE ticket_time_slots + RLS
4. **Migration 4**: CREATE ticket_team_config + RLS
5. **Migration 5**: Settings domain extension
6. **Migration 6**: RPC functions voor ticket configuratie

---

## Acceptance Criteria

- [ ] ticket_types heeft alle nieuwe velden
- [ ] i18n werkt voor naam/beschrijving/instructies
- [ ] Time slots kunnen geconfigureerd worden
- [ ] Team config werkt per ticket type
- [ ] RLS voorkomt cross-org access
- [ ] Bestaande tickets/orders blijven werken (backwards compatible)
- [ ] Audit log bij wijzigingen

---

## Test Scenarios

| ID | Scenario | Expected |
|----|----------|----------|
| T1 | Add distance to ticket type | Saved correctly |
| T2 | Create i18n variant | NL + EN beschikbaar |
| T3 | Add time slot | Slot in checkout selecteerbaar |
| T4 | Configure team settings | Team rules enforced |
| T5 | Set max per participant | Over-ordering blocked |
| T6 | Hide ticket | Not visible in public API |
| T7 | Existing orders intact | No data loss |

---

*Generated: 2025-01-27*
