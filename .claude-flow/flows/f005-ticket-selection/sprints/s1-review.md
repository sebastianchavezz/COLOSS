# F005 Ticket Selection Upgrade - Review Document

**Sprint**: S1 - Atleta-style Ticket Configuration
**Status**: ✅ GOEDGEKEURD
**Reviewer**: Claude Code (Automated)
**Datum**: 2025-01-27

---

## Overzicht Migraties

| # | Bestand | Doel |
|---|---------|------|
| 1 | `20250127200001_f005_ticket_types_extended.sql` | Uitbreiding ticket_types tabel |
| 2 | `20250127200002_f005_ticket_type_i18n.sql` | Internationalisatie tabel |
| 3 | `20250127200003_f005_ticket_time_slots.sql` | Starttijden/waves tabel |
| 4 | `20250127200004_f005_ticket_team_config.sql` | Team configuratie tabel |
| 5 | `20250127200005_f005_ticket_rpcs.sql` | RPC functies |
| 6 | `20250127200006_f005_ticket_settings_domain.sql` | Settings domain uitbreiding |

---

## Security Review

### RLS Policies ✅

**ticket_type_i18n**
- ✅ Org admins kunnen CRUD
- ✅ Org members kunnen SELECT
- ✅ Public kan SELECT voor published tickets met visibility='visible'

**ticket_time_slots**
- ✅ Org admins kunnen CRUD
- ✅ Org members kunnen SELECT
- ✅ Public kan SELECT voor published tickets (met deleted_at IS NULL)

**ticket_team_config**
- ✅ Org admins kunnen CRUD
- ✅ Org members kunnen SELECT
- ✅ Public kan SELECT voor published tickets

**RPC Functions (SECURITY DEFINER)**
- ✅ `get_ticket_type_full`: Checked org member OR public published
- ✅ `update_ticket_type_extended`: Checked admin/owner role
- ✅ `upsert_ticket_type_i18n`: Checked admin/owner role
- ✅ `upsert_ticket_time_slot`: Checked admin/owner role
- ✅ `delete_ticket_time_slot`: Checked admin/owner role
- ✅ `get_event_ticket_types`: Public access met visibility filter

### Multi-Tenant Isolatie ✅
Alle policies checken org_id via JOIN naar events tabel.

---

## Backwards Compatibility ✅

### ticket_types uitbreiding
- ✅ Alle nieuwe kolommen hebben DEFAULT of zijn NULL-baar:
  - `distance_value` - NULL (optional)
  - `distance_unit` - NULL (optional)
  - `image_url` - NULL (optional)
  - `instructions` - DEFAULT '{}'
  - `ticket_category` - DEFAULT 'individual'
  - `max_per_participant` - NULL (unlimited)
  - `visibility` - DEFAULT 'visible'
  - `requires_invitation_code` - DEFAULT FALSE

### RLS Policy Update
- ⚠️ `visibility = 'visible'` toegevoegd aan public policy
- ✅ Geen impact: bestaande data heeft default 'visible'

---

## Data Integriteit ✅

### Constraints
- ✅ `ticket_types_distance_unit_check`: ('km', 'm', 'mi', 'hrs')
- ✅ `ticket_types_category_check`: ('individual', 'team', 'relay', 'kids', 'vip', 'spectator', 'other')
- ✅ `ticket_types_visibility_check`: ('visible', 'hidden', 'invitation_only')
- ✅ `ticket_team_config_size_check`: min <= max
- ✅ `ticket_team_config_min_check`: min >= 1
- ✅ `ticket_team_config_max_check`: max <= 100
- ✅ `ticket_time_slots_capacity_check`: capacity > 0 OR NULL
- ✅ `ticket_type_i18n_unique`: (ticket_type_id, locale)
- ✅ `ticket_time_slots_unique`: (ticket_type_id, slot_time, slot_date)

### Foreign Keys
- ✅ Alle nieuwe tabellen: `ON DELETE CASCADE` naar ticket_types

---

## Performance ✅

### Indexes
- ✅ `idx_ticket_types_category` - (event_id, ticket_category)
- ✅ `idx_ticket_types_visibility` - partial index
- ✅ `idx_ticket_type_i18n_ticket_type`
- ✅ `idx_ticket_type_i18n_locale`
- ✅ `idx_ticket_time_slots_ticket_type`
- ✅ `idx_ticket_time_slots_active` - partial index
- ✅ `idx_ticket_time_slots_unique` - unique partial index
- ✅ `idx_ticket_team_config_ticket_type`

---

## Audit Logging ✅

Alle mutaties worden gelogd in `audit_log`:
- `TICKET_TYPE_UPDATED`
- `TICKET_TYPE_I18N_UPDATED`
- `TICKET_TEAM_CONFIG_UPDATED`

---

## Idempotency ✅

- ✅ `CREATE TABLE IF NOT EXISTS`
- ✅ `ADD COLUMN IF NOT EXISTS`
- ✅ `CREATE INDEX IF NOT EXISTS`
- ✅ Constraint checks via `pg_constraint`
- ✅ `DROP POLICY IF EXISTS` before recreate

---

## Issues Gevonden

Geen blokkerende issues gevonden.

### Minor Observations (non-blocking)
1. `get_event_ticket_types` doet COUNT subqueries voor sold/available - bij hoge volumes kan dit traag worden. Overweeg later materialized views.
2. `ticket_time_slots` unique index gebruikt COALESCE hack voor NULL dates - functioneel correct.

---

## Conclusie

**Status**: ✅ GOEDGEKEURD VOOR DEPLOYMENT

De F005 upgrade migraties zijn:
- ✅ Backwards compatible
- ✅ Security-compliant (RLS + role checks)
- ✅ Multi-tenant isolated
- ✅ Idempotent
- ✅ Audit-logged
- ✅ Geïndexeerd voor performance

Klaar voor FASE 5: Tests.
