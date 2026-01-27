-- ===========================================================================
-- F005 FIX: Add metadata column to order_items
-- Migration: 20250127200007_f005_fix_order_items_metadata.sql
--
-- Purpose:
-- - Add metadata JSONB column to order_items if missing
-- - Required for time_slot_id storage in ticket time slots feature
-- ===========================================================================

-- Add metadata column if it doesn't exist
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

COMMENT ON COLUMN order_items.metadata IS
  'Additional order item data (time_slot_id, team_id, etc.)';

-- ===========================================================================
-- END MIGRATION
-- ===========================================================================
