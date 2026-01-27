-- ===========================================================================
-- F005 UPGRADE: Ticket Type Internationalization (i18n)
-- Migration: 20250127200002_f005_ticket_type_i18n.sql
--
-- Purpose:
-- - Store translated ticket names, descriptions, and instructions
-- - Support multiple locales per ticket type
-- ===========================================================================

-- ===========================================================================
-- 1. CREATE TABLE
-- ===========================================================================

CREATE TABLE IF NOT EXISTS ticket_type_i18n (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_type_id UUID NOT NULL REFERENCES ticket_types(id) ON DELETE CASCADE,

  -- Locale identifier
  locale TEXT NOT NULL,  -- 'nl', 'en', 'de', 'fr', etc.

  -- Translated content
  name TEXT NOT NULL,
  description TEXT,
  instructions TEXT,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One translation per locale per ticket type
  CONSTRAINT ticket_type_i18n_unique UNIQUE (ticket_type_id, locale)
);

COMMENT ON TABLE ticket_type_i18n IS
  'Internationalized content for ticket types (name, description, instructions per locale)';

-- ===========================================================================
-- 2. INDEXES
-- ===========================================================================

CREATE INDEX IF NOT EXISTS idx_ticket_type_i18n_ticket_type
  ON ticket_type_i18n(ticket_type_id);

CREATE INDEX IF NOT EXISTS idx_ticket_type_i18n_locale
  ON ticket_type_i18n(locale);

-- ===========================================================================
-- 3. RLS POLICIES
-- ===========================================================================

ALTER TABLE ticket_type_i18n ENABLE ROW LEVEL SECURITY;

-- Org admins/owners can manage i18n content
CREATE POLICY "Org admins can manage ticket_type_i18n"
  ON ticket_type_i18n
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM ticket_types tt
      JOIN events e ON e.id = tt.event_id
      WHERE tt.id = ticket_type_i18n.ticket_type_id
      AND (public.has_role(e.org_id, 'admin') OR public.has_role(e.org_id, 'owner'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ticket_types tt
      JOIN events e ON e.id = tt.event_id
      WHERE tt.id = ticket_type_i18n.ticket_type_id
      AND (public.has_role(e.org_id, 'admin') OR public.has_role(e.org_id, 'owner'))
    )
  );

-- Org members can view
CREATE POLICY "Org members can view ticket_type_i18n"
  ON ticket_type_i18n
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM ticket_types tt
      JOIN events e ON e.id = tt.event_id
      WHERE tt.id = ticket_type_i18n.ticket_type_id
      AND public.is_org_member(e.org_id)
    )
  );

-- Public can read i18n of published tickets
CREATE POLICY "Public can read ticket_type_i18n of published tickets"
  ON ticket_type_i18n
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM ticket_types tt
      JOIN events e ON e.id = tt.event_id
      WHERE tt.id = ticket_type_i18n.ticket_type_id
      AND e.status = 'published'
      AND tt.status = 'published'
      AND tt.deleted_at IS NULL
      AND tt.visibility = 'visible'
    )
  );

-- ===========================================================================
-- 4. TRIGGER FOR UPDATED_AT
-- ===========================================================================

CREATE TRIGGER handle_updated_at_ticket_type_i18n
  BEFORE UPDATE ON ticket_type_i18n
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ===========================================================================
-- 5. GRANT PERMISSIONS
-- ===========================================================================

GRANT SELECT ON ticket_type_i18n TO authenticated;
GRANT INSERT, UPDATE, DELETE ON ticket_type_i18n TO authenticated;

-- ===========================================================================
-- END MIGRATION
-- ===========================================================================
