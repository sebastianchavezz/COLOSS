-- ===========================================================================
-- F005 UPGRADE: Ticket Team Configuration
-- Migration: 20250127200004_f005_ticket_team_config.sql
--
-- Purpose:
-- - Define team settings per ticket type
-- - Min/max team size, captain requirements
-- - Foundation for future team registration flow
-- ===========================================================================

-- ===========================================================================
-- 1. CREATE TABLE
-- ===========================================================================

CREATE TABLE IF NOT EXISTS ticket_team_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_type_id UUID NOT NULL REFERENCES ticket_types(id) ON DELETE CASCADE,

  -- Team settings
  team_required BOOLEAN NOT NULL DEFAULT FALSE,
  team_min_size INTEGER NOT NULL DEFAULT 2,
  team_max_size INTEGER NOT NULL DEFAULT 10,
  allow_incomplete_teams BOOLEAN NOT NULL DEFAULT FALSE,
  captain_required BOOLEAN NOT NULL DEFAULT TRUE,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT ticket_team_config_ticket_type_unique UNIQUE (ticket_type_id),
  CONSTRAINT ticket_team_config_size_check CHECK (team_min_size <= team_max_size),
  CONSTRAINT ticket_team_config_min_check CHECK (team_min_size >= 1),
  CONSTRAINT ticket_team_config_max_check CHECK (team_max_size <= 100)
);

COMMENT ON TABLE ticket_team_config IS
  'Team configuration per ticket type (for relay, team events)';

COMMENT ON COLUMN ticket_team_config.team_required IS
  'If true, ticket can only be purchased as part of a team';
COMMENT ON COLUMN ticket_team_config.team_min_size IS
  'Minimum team members required';
COMMENT ON COLUMN ticket_team_config.team_max_size IS
  'Maximum team members allowed';
COMMENT ON COLUMN ticket_team_config.allow_incomplete_teams IS
  'If true, team can start event without reaching min_size';
COMMENT ON COLUMN ticket_team_config.captain_required IS
  'If true, one member must be designated as captain';

-- ===========================================================================
-- 2. INDEXES
-- ===========================================================================

CREATE INDEX IF NOT EXISTS idx_ticket_team_config_ticket_type
  ON ticket_team_config(ticket_type_id);

-- ===========================================================================
-- 3. RLS POLICIES
-- ===========================================================================

ALTER TABLE ticket_team_config ENABLE ROW LEVEL SECURITY;

-- Org admins/owners can manage team config
CREATE POLICY "Org admins can manage ticket_team_config"
  ON ticket_team_config
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM ticket_types tt
      JOIN events e ON e.id = tt.event_id
      WHERE tt.id = ticket_team_config.ticket_type_id
      AND (public.has_role(e.org_id, 'admin') OR public.has_role(e.org_id, 'owner'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ticket_types tt
      JOIN events e ON e.id = tt.event_id
      WHERE tt.id = ticket_team_config.ticket_type_id
      AND (public.has_role(e.org_id, 'admin') OR public.has_role(e.org_id, 'owner'))
    )
  );

-- Org members can view
CREATE POLICY "Org members can view ticket_team_config"
  ON ticket_team_config
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM ticket_types tt
      JOIN events e ON e.id = tt.event_id
      WHERE tt.id = ticket_team_config.ticket_type_id
      AND public.is_org_member(e.org_id)
    )
  );

-- Public can read team config of published tickets
CREATE POLICY "Public can read ticket_team_config of published tickets"
  ON ticket_team_config
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM ticket_types tt
      JOIN events e ON e.id = tt.event_id
      WHERE tt.id = ticket_team_config.ticket_type_id
      AND e.status = 'published'
      AND tt.status = 'published'
      AND tt.deleted_at IS NULL
    )
  );

-- ===========================================================================
-- 4. TRIGGER FOR UPDATED_AT
-- ===========================================================================

CREATE TRIGGER handle_updated_at_ticket_team_config
  BEFORE UPDATE ON ticket_team_config
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ===========================================================================
-- 5. HELPER FUNCTION: Upsert team config
-- ===========================================================================

CREATE OR REPLACE FUNCTION upsert_ticket_team_config(
  _ticket_type_id UUID,
  _team_required BOOLEAN DEFAULT FALSE,
  _team_min_size INTEGER DEFAULT 2,
  _team_max_size INTEGER DEFAULT 10,
  _allow_incomplete_teams BOOLEAN DEFAULT FALSE,
  _captain_required BOOLEAN DEFAULT TRUE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_org_id UUID;
BEGIN
  -- Security check
  SELECT e.org_id INTO v_org_id
  FROM ticket_types tt
  JOIN events e ON e.id = tt.event_id
  WHERE tt.id = _ticket_type_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'TICKET_TYPE_NOT_FOUND';
  END IF;

  IF NOT (public.has_role(v_org_id, 'admin') OR public.has_role(v_org_id, 'owner')) THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  -- Upsert
  INSERT INTO ticket_team_config (
    ticket_type_id,
    team_required,
    team_min_size,
    team_max_size,
    allow_incomplete_teams,
    captain_required
  )
  VALUES (
    _ticket_type_id,
    _team_required,
    _team_min_size,
    _team_max_size,
    _allow_incomplete_teams,
    _captain_required
  )
  ON CONFLICT (ticket_type_id) DO UPDATE SET
    team_required = EXCLUDED.team_required,
    team_min_size = EXCLUDED.team_min_size,
    team_max_size = EXCLUDED.team_max_size,
    allow_incomplete_teams = EXCLUDED.allow_incomplete_teams,
    captain_required = EXCLUDED.captain_required,
    updated_at = NOW()
  RETURNING id INTO v_id;

  -- Audit log
  INSERT INTO audit_log (org_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_org_id,
    auth.uid(),
    'TICKET_TEAM_CONFIG_UPDATED',
    'ticket_team_config',
    v_id,
    jsonb_build_object(
      'ticket_type_id', _ticket_type_id,
      'team_required', _team_required,
      'team_min_size', _team_min_size,
      'team_max_size', _team_max_size
    )
  );

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION upsert_ticket_team_config IS
  'Create or update team configuration for a ticket type';

GRANT EXECUTE ON FUNCTION upsert_ticket_team_config TO authenticated;

-- ===========================================================================
-- 6. GRANT PERMISSIONS
-- ===========================================================================

GRANT SELECT ON ticket_team_config TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON ticket_team_config TO authenticated;

-- ===========================================================================
-- END MIGRATION
-- ===========================================================================
