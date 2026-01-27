# Architecture: F005 Ticket Configuration Upgrade

## Overview

Dit document beschrijft de technische architectuur voor de Atleta-style ticket configuratie uitbreiding.

---

## Database Schema

### Current State (ticket_types)
```sql
-- Existing columns:
id, event_id, name, description, price, vat_percentage,
capacity_total, sales_start, sales_end, status, sort_order,
currency, created_at, updated_at, deleted_at
```

### Target State

#### 1. ALTER ticket_types

```sql
-- Basisinformatie uitbreiding
ALTER TABLE ticket_types ADD COLUMN IF NOT EXISTS distance_value NUMERIC(10,2);
ALTER TABLE ticket_types ADD COLUMN IF NOT EXISTS distance_unit TEXT;
ALTER TABLE ticket_types ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE ticket_types ADD COLUMN IF NOT EXISTS instructions JSONB DEFAULT '{}';

-- Tickettype categorisatie
ALTER TABLE ticket_types ADD COLUMN IF NOT EXISTS ticket_category TEXT DEFAULT 'individual';

-- Beperkingen
ALTER TABLE ticket_types ADD COLUMN IF NOT EXISTS max_per_participant INTEGER;
ALTER TABLE ticket_types ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'visible';
ALTER TABLE ticket_types ADD COLUMN IF NOT EXISTS requires_invitation_code BOOLEAN DEFAULT FALSE;

-- Constraints
ALTER TABLE ticket_types ADD CONSTRAINT ticket_types_distance_unit_check
  CHECK (distance_unit IS NULL OR distance_unit IN ('km', 'm', 'mi', 'hrs'));

ALTER TABLE ticket_types ADD CONSTRAINT ticket_types_category_check
  CHECK (ticket_category IN ('individual', 'team', 'relay', 'kids', 'vip', 'spectator', 'other'));

ALTER TABLE ticket_types ADD CONSTRAINT ticket_types_visibility_check
  CHECK (visibility IN ('visible', 'hidden', 'invitation_only'));
```

#### 2. NEW: ticket_type_i18n

```sql
CREATE TABLE ticket_type_i18n (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_type_id UUID NOT NULL REFERENCES ticket_types(id) ON DELETE CASCADE,
  locale TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  instructions TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(ticket_type_id, locale)
);

CREATE INDEX idx_ticket_type_i18n_ticket_type ON ticket_type_i18n(ticket_type_id);
CREATE INDEX idx_ticket_type_i18n_locale ON ticket_type_i18n(locale);
```

#### 3. NEW: ticket_time_slots

```sql
CREATE TABLE ticket_time_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_type_id UUID NOT NULL REFERENCES ticket_types(id) ON DELETE CASCADE,

  -- Slot definitie
  slot_time TIME NOT NULL,
  slot_date DATE,  -- NULL = applies to all event days
  label TEXT,      -- "Wave A", "08:00 - Marathon Start"

  -- Capaciteit (optioneel)
  capacity INTEGER,

  -- UI
  sort_order INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  CONSTRAINT ticket_time_slots_capacity_check CHECK (capacity IS NULL OR capacity > 0)
);

CREATE UNIQUE INDEX idx_ticket_time_slots_unique
  ON ticket_time_slots(ticket_type_id, slot_time, COALESCE(slot_date, '1970-01-01'))
  WHERE deleted_at IS NULL;

CREATE INDEX idx_ticket_time_slots_ticket_type ON ticket_time_slots(ticket_type_id);
```

#### 4. NEW: ticket_team_config

```sql
CREATE TABLE ticket_team_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_type_id UUID NOT NULL REFERENCES ticket_types(id) ON DELETE CASCADE UNIQUE,

  -- Team settings
  team_required BOOLEAN DEFAULT FALSE,
  team_min_size INTEGER DEFAULT 2,
  team_max_size INTEGER DEFAULT 10,
  allow_incomplete_teams BOOLEAN DEFAULT FALSE,
  captain_required BOOLEAN DEFAULT TRUE,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT ticket_team_config_size_check CHECK (team_min_size <= team_max_size),
  CONSTRAINT ticket_team_config_min_check CHECK (team_min_size >= 1)
);
```

---

## RLS Policies

### ticket_type_i18n

```sql
-- Inherit from ticket_types
CREATE POLICY "Org members can manage ticket_type_i18n"
  ON ticket_type_i18n FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM ticket_types tt
      JOIN events e ON e.id = tt.event_id
      WHERE tt.id = ticket_type_i18n.ticket_type_id
      AND (public.has_role(e.org_id, 'admin') OR public.has_role(e.org_id, 'owner'))
    )
  );

CREATE POLICY "Public can read ticket_type_i18n of published events"
  ON ticket_type_i18n FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM ticket_types tt
      JOIN events e ON e.id = tt.event_id
      WHERE tt.id = ticket_type_i18n.ticket_type_id
      AND e.status = 'published'
      AND tt.status = 'published'
      AND tt.deleted_at IS NULL
    )
  );
```

### ticket_time_slots

```sql
CREATE POLICY "Org members can manage ticket_time_slots"
  ON ticket_time_slots FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM ticket_types tt
      JOIN events e ON e.id = tt.event_id
      WHERE tt.id = ticket_time_slots.ticket_type_id
      AND (public.has_role(e.org_id, 'admin') OR public.has_role(e.org_id, 'owner'))
    )
  );

CREATE POLICY "Public can read ticket_time_slots of published tickets"
  ON ticket_time_slots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM ticket_types tt
      JOIN events e ON e.id = tt.event_id
      WHERE tt.id = ticket_time_slots.ticket_type_id
      AND e.status = 'published'
      AND tt.status = 'published'
    )
    AND deleted_at IS NULL
  );
```

### ticket_team_config

```sql
CREATE POLICY "Org members can manage ticket_team_config"
  ON ticket_team_config FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM ticket_types tt
      JOIN events e ON e.id = tt.event_id
      WHERE tt.id = ticket_team_config.ticket_type_id
      AND (public.has_role(e.org_id, 'admin') OR public.has_role(e.org_id, 'owner'))
    )
  );

CREATE POLICY "Public can read ticket_team_config of published tickets"
  ON ticket_team_config FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM ticket_types tt
      JOIN events e ON e.id = tt.event_id
      WHERE tt.id = ticket_team_config.ticket_type_id
      AND e.status = 'published'
      AND tt.status = 'published'
    )
  );
```

---

## RPC Functions

### get_ticket_type_full

```sql
CREATE OR REPLACE FUNCTION get_ticket_type_full(
  _ticket_type_id UUID,
  _locale TEXT DEFAULT 'nl'
)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'ticket_type', to_jsonb(tt),
    'i18n', COALESCE(
      (SELECT to_jsonb(i18n) FROM ticket_type_i18n i18n
       WHERE i18n.ticket_type_id = tt.id AND i18n.locale = _locale),
      '{}'::jsonb
    ),
    'time_slots', COALESCE(
      (SELECT jsonb_agg(to_jsonb(ts) ORDER BY ts.sort_order, ts.slot_time)
       FROM ticket_time_slots ts
       WHERE ts.ticket_type_id = tt.id AND ts.deleted_at IS NULL),
      '[]'::jsonb
    ),
    'team_config', COALESCE(
      (SELECT to_jsonb(tc) FROM ticket_team_config tc
       WHERE tc.ticket_type_id = tt.id),
      '{}'::jsonb
    )
  ) INTO v_result
  FROM ticket_types tt
  WHERE tt.id = _ticket_type_id
  AND tt.deleted_at IS NULL;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### upsert_ticket_type_i18n

```sql
CREATE OR REPLACE FUNCTION upsert_ticket_type_i18n(
  _ticket_type_id UUID,
  _locale TEXT,
  _name TEXT,
  _description TEXT DEFAULT NULL,
  _instructions TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Security check: user must be admin/owner of the event
  IF NOT EXISTS (
    SELECT 1 FROM ticket_types tt
    JOIN events e ON e.id = tt.event_id
    WHERE tt.id = _ticket_type_id
    AND (public.has_role(e.org_id, 'admin') OR public.has_role(e.org_id, 'owner'))
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  INSERT INTO ticket_type_i18n (ticket_type_id, locale, name, description, instructions)
  VALUES (_ticket_type_id, _locale, _name, _description, _instructions)
  ON CONFLICT (ticket_type_id, locale) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    instructions = EXCLUDED.instructions,
    updated_at = NOW()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## Settings Domain: tickets.*

```sql
-- Add to get_default_settings()
'tickets', jsonb_build_object(
  'defaults', jsonb_build_object(
    'currency', 'EUR',
    'vat_percentage', 21.00,
    'visibility', 'visible'
  ),
  'checkout', jsonb_build_object(
    'show_remaining_capacity', true,
    'low_stock_threshold', 10,
    'max_per_order', 10
  ),
  'time_slots', jsonb_build_object(
    'enabled', false,
    'required', false
  ),
  'teams', jsonb_build_object(
    'enabled', false
  )
)
```

---

## Frontend Components (Organizer UI)

### Ticket Detail Tabs

```
┌─────────────────────────────────────────────────────────────┐
│ Ticket Configuration: "Marathon 42km"                        │
├─────────────────────────────────────────────────────────────┤
│ [Basis] [Prijzen] [Type] [Teams] [Beperkingen] [Tijdslots]  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Tab content hier...                                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Tab Components

| Tab | Component | Data |
|-----|-----------|------|
| Basis | `TicketBasicInfo.tsx` | name, description, distance, image, instructions |
| Prijzen | `TicketPricing.tsx` | price, vat, currency |
| Type | `TicketCategory.tsx` | ticket_category dropdown |
| Teams | `TicketTeamConfig.tsx` | team settings form |
| Beperkingen | `TicketRestrictions.tsx` | sales window, max per participant, visibility |
| Tijdslots | `TicketTimeSlots.tsx` | CRUD for time slots |

---

## Files to Create

| File | Purpose |
|------|---------|
| `supabase/migrations/20250127200001_f005_ticket_types_extended.sql` | ALTER ticket_types |
| `supabase/migrations/20250127200002_f005_ticket_type_i18n.sql` | i18n table |
| `supabase/migrations/20250127200003_f005_ticket_time_slots.sql` | Time slots |
| `supabase/migrations/20250127200004_f005_ticket_team_config.sql` | Team config |
| `supabase/migrations/20250127200005_f005_ticket_rpcs.sql` | RPC functions |
| `supabase/migrations/20250127200006_f005_ticket_settings_domain.sql` | Settings |
| `web/src/pages/TicketDetail.tsx` | Ticket config page |
| `web/src/components/tickets/TicketBasicInfo.tsx` | Basis tab |
| `web/src/components/tickets/TicketTimeSlots.tsx` | Time slots tab |
| `web/src/components/tickets/TicketTeamConfig.tsx` | Teams tab |
| `tests/integration/f005_ticket_config.test.mjs` | Integration tests |

---

## Backwards Compatibility

### Guaranteed
- Existing ticket_types rows will have NULL for new columns (defaults applied)
- Existing orders/registrations unaffected
- Existing RLS policies remain (new ones added)

### Migration Strategy
- All ALTERs use `IF NOT EXISTS`
- New columns have sensible defaults
- No destructive changes (no DROP)

---

*Generated: 2025-01-27*
