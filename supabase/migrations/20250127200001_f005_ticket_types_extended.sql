-- ===========================================================================
-- F005 UPGRADE: Ticket Types Extended Configuration
-- Migration: 20250127200001_f005_ticket_types_extended.sql
--
-- Purpose:
-- - Add Atleta-style ticket configuration fields
-- - Distance/sport info, image, instructions
-- - Ticket category (individual, team, relay, etc.)
-- - Visibility and restriction settings
--
-- Backwards Compatible: All new columns have defaults or allow NULL
-- ===========================================================================

-- ===========================================================================
-- 1. BASISINFORMATIE VELDEN
-- ===========================================================================

-- Distance value (for running/cycling events)
ALTER TABLE ticket_types ADD COLUMN IF NOT EXISTS distance_value NUMERIC(10,2);
COMMENT ON COLUMN ticket_types.distance_value IS 'Distance for this ticket type (e.g., 42.195 for marathon)';

-- Distance unit
ALTER TABLE ticket_types ADD COLUMN IF NOT EXISTS distance_unit TEXT;
COMMENT ON COLUMN ticket_types.distance_unit IS 'Unit of distance: km, m, mi, or hrs (for time-based)';

-- Add constraint for distance_unit (only if column exists and constraint doesn't)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ticket_types_distance_unit_check'
  ) THEN
    ALTER TABLE ticket_types ADD CONSTRAINT ticket_types_distance_unit_check
      CHECK (distance_unit IS NULL OR distance_unit IN ('km', 'm', 'mi', 'hrs'));
  END IF;
END $$;

-- Image URL for checkout thumbnail
ALTER TABLE ticket_types ADD COLUMN IF NOT EXISTS image_url TEXT;
COMMENT ON COLUMN ticket_types.image_url IS 'Thumbnail image URL (2:1 ratio recommended) for checkout display';

-- Instructions (i18n JSONB: {"nl": "...", "en": "..."})
ALTER TABLE ticket_types ADD COLUMN IF NOT EXISTS instructions JSONB DEFAULT '{}';
COMMENT ON COLUMN ticket_types.instructions IS 'Instructions shown in confirmation email (i18n JSONB)';

-- ===========================================================================
-- 2. TICKETTYPE CATEGORISATIE
-- ===========================================================================

-- Semantic ticket category
ALTER TABLE ticket_types ADD COLUMN IF NOT EXISTS ticket_category TEXT DEFAULT 'individual';
COMMENT ON COLUMN ticket_types.ticket_category IS 'Semantic type: individual, team, relay, kids, vip, spectator, other';

-- Add constraint for ticket_category
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ticket_types_category_check'
  ) THEN
    ALTER TABLE ticket_types ADD CONSTRAINT ticket_types_category_check
      CHECK (ticket_category IN ('individual', 'team', 'relay', 'kids', 'vip', 'spectator', 'other'));
  END IF;
END $$;

-- ===========================================================================
-- 3. BEPERKINGEN VELDEN
-- ===========================================================================

-- Max tickets per participant (NULL = unlimited)
ALTER TABLE ticket_types ADD COLUMN IF NOT EXISTS max_per_participant INTEGER;
COMMENT ON COLUMN ticket_types.max_per_participant IS 'Maximum tickets one participant can buy (NULL = unlimited)';

-- Visibility control
ALTER TABLE ticket_types ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'visible';
COMMENT ON COLUMN ticket_types.visibility IS 'Visibility: visible, hidden, or invitation_only';

-- Add constraint for visibility
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ticket_types_visibility_check'
  ) THEN
    ALTER TABLE ticket_types ADD CONSTRAINT ticket_types_visibility_check
      CHECK (visibility IN ('visible', 'hidden', 'invitation_only'));
  END IF;
END $$;

-- Requires invitation code flag
ALTER TABLE ticket_types ADD COLUMN IF NOT EXISTS requires_invitation_code BOOLEAN DEFAULT FALSE;
COMMENT ON COLUMN ticket_types.requires_invitation_code IS 'If true, only accessible via invitation code';

-- ===========================================================================
-- 4. INDEXES
-- ===========================================================================

CREATE INDEX IF NOT EXISTS idx_ticket_types_category
  ON ticket_types(event_id, ticket_category);

CREATE INDEX IF NOT EXISTS idx_ticket_types_visibility
  ON ticket_types(event_id, visibility)
  WHERE deleted_at IS NULL;

-- ===========================================================================
-- 5. UPDATE RLS POLICY FOR VISIBILITY
-- ===========================================================================

-- Drop existing public policy if exists and recreate with visibility check
DROP POLICY IF EXISTS "Public can view ticket types of published events" ON ticket_types;

CREATE POLICY "Public can view ticket types of published events"
  ON ticket_types
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = ticket_types.event_id
      AND e.status = 'published'
      AND e.deleted_at IS NULL
    )
    AND deleted_at IS NULL
    AND status = 'published'
    AND visibility = 'visible'  -- NEW: respect visibility setting
  );

-- ===========================================================================
-- END MIGRATION
-- ===========================================================================
