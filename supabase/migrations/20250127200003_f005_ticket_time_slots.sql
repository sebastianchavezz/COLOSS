-- ===========================================================================
-- F005 UPGRADE: Ticket Time Slots
-- Migration: 20250127200003_f005_ticket_time_slots.sql
--
-- Purpose:
-- - Define start time slots (waves) per ticket type
-- - Selectable during checkout
-- - Optional capacity per slot
-- ===========================================================================

-- ===========================================================================
-- 1. CREATE TABLE
-- ===========================================================================

CREATE TABLE IF NOT EXISTS ticket_time_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_type_id UUID NOT NULL REFERENCES ticket_types(id) ON DELETE CASCADE,

  -- Slot definition
  slot_time TIME NOT NULL,           -- e.g., '08:00:00'
  slot_date DATE,                    -- NULL = applies to all event days / default
  label TEXT,                        -- "Wave A", "08:00 - Marathon Start"

  -- Optional capacity limit per slot
  capacity INTEGER,

  -- UI ordering
  sort_order INTEGER NOT NULL DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,            -- Soft delete

  -- Constraints
  CONSTRAINT ticket_time_slots_capacity_check CHECK (capacity IS NULL OR capacity > 0)
);

COMMENT ON TABLE ticket_time_slots IS
  'Start time slots (waves) for ticket types, selectable during checkout';

COMMENT ON COLUMN ticket_time_slots.slot_time IS 'Time of the slot (e.g., 08:00)';
COMMENT ON COLUMN ticket_time_slots.slot_date IS 'Date for this slot, NULL means default/all days';
COMMENT ON COLUMN ticket_time_slots.label IS 'Display label like "Wave A" or "Early Start"';
COMMENT ON COLUMN ticket_time_slots.capacity IS 'Max participants in this slot (NULL = unlimited)';

-- ===========================================================================
-- 2. INDEXES
-- ===========================================================================

CREATE INDEX IF NOT EXISTS idx_ticket_time_slots_ticket_type
  ON ticket_time_slots(ticket_type_id);

CREATE INDEX IF NOT EXISTS idx_ticket_time_slots_active
  ON ticket_time_slots(ticket_type_id, sort_order)
  WHERE deleted_at IS NULL;

-- Unique constraint: one slot per time/date combo per ticket type
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_time_slots_unique
  ON ticket_time_slots(ticket_type_id, slot_time, COALESCE(slot_date, '1970-01-01'))
  WHERE deleted_at IS NULL;

-- ===========================================================================
-- 3. RLS POLICIES
-- ===========================================================================

ALTER TABLE ticket_time_slots ENABLE ROW LEVEL SECURITY;

-- Org admins/owners can manage time slots
CREATE POLICY "Org admins can manage ticket_time_slots"
  ON ticket_time_slots
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM ticket_types tt
      JOIN events e ON e.id = tt.event_id
      WHERE tt.id = ticket_time_slots.ticket_type_id
      AND (public.has_role(e.org_id, 'admin') OR public.has_role(e.org_id, 'owner'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ticket_types tt
      JOIN events e ON e.id = tt.event_id
      WHERE tt.id = ticket_time_slots.ticket_type_id
      AND (public.has_role(e.org_id, 'admin') OR public.has_role(e.org_id, 'owner'))
    )
  );

-- Org members can view
CREATE POLICY "Org members can view ticket_time_slots"
  ON ticket_time_slots
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM ticket_types tt
      JOIN events e ON e.id = tt.event_id
      WHERE tt.id = ticket_time_slots.ticket_type_id
      AND public.is_org_member(e.org_id)
    )
  );

-- Public can read time slots of published tickets
CREATE POLICY "Public can read ticket_time_slots of published tickets"
  ON ticket_time_slots
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM ticket_types tt
      JOIN events e ON e.id = tt.event_id
      WHERE tt.id = ticket_time_slots.ticket_type_id
      AND e.status = 'published'
      AND tt.status = 'published'
      AND tt.deleted_at IS NULL
    )
    AND deleted_at IS NULL
  );

-- ===========================================================================
-- 4. TRIGGER FOR UPDATED_AT
-- ===========================================================================

CREATE TRIGGER handle_updated_at_ticket_time_slots
  BEFORE UPDATE ON ticket_time_slots
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ===========================================================================
-- 5. HELPER FUNCTION: Get available slots for a ticket type
-- ===========================================================================

CREATE OR REPLACE FUNCTION get_ticket_time_slots(
  _ticket_type_id UUID
)
RETURNS TABLE (
  id UUID,
  slot_time TIME,
  slot_date DATE,
  label TEXT,
  capacity INTEGER,
  sold INTEGER,
  available INTEGER,
  sort_order INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ts.id,
    ts.slot_time,
    ts.slot_date,
    ts.label,
    ts.capacity,
    COALESCE(
      (SELECT COUNT(*)::integer FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.ticket_type_id = _ticket_type_id
       AND oi.metadata->>'time_slot_id' = ts.id::text
       AND o.status IN ('pending', 'paid')),
      0
    ) as sold,
    CASE
      WHEN ts.capacity IS NULL THEN NULL
      ELSE ts.capacity - COALESCE(
        (SELECT COUNT(*)::integer FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE oi.ticket_type_id = _ticket_type_id
         AND oi.metadata->>'time_slot_id' = ts.id::text
         AND o.status IN ('pending', 'paid')),
        0
      )
    END as available,
    ts.sort_order
  FROM ticket_time_slots ts
  WHERE ts.ticket_type_id = _ticket_type_id
  AND ts.deleted_at IS NULL
  ORDER BY ts.sort_order, ts.slot_time;
END;
$$;

COMMENT ON FUNCTION get_ticket_time_slots IS
  'Returns available time slots for a ticket type with current availability';

GRANT EXECUTE ON FUNCTION get_ticket_time_slots TO authenticated, anon;

-- ===========================================================================
-- 6. GRANT PERMISSIONS
-- ===========================================================================

GRANT SELECT ON ticket_time_slots TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON ticket_time_slots TO authenticated;

-- ===========================================================================
-- END MIGRATION
-- ===========================================================================
