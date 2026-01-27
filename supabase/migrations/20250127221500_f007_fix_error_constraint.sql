-- ===========================================================================
-- F007 Hotfix: Add ERROR to scan_result constraint + enable pgcrypto
-- ===========================================================================
--
-- PROBLEEM 1: EXCEPTION handler probeert 'ERROR' in te voegen maar dat staat
-- niet in de check constraint lijst
--
-- PROBLEEM 2: pgcrypto extensie niet geïnstalleerd, digest() functie bestaat niet
--
-- OPLOSSING:
-- 1. Enable pgcrypto extensie
-- 2. Drop en recreate constraint met 'ERROR' toegevoegd
--
-- ===========================================================================

-- Enable pgcrypto voor token hashing (SHA256)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Drop de oude constraint
ALTER TABLE ticket_scans
DROP CONSTRAINT IF EXISTS ticket_scans_scan_result_check;

-- Recreate met 'ERROR' toegevoegd
ALTER TABLE ticket_scans
ADD CONSTRAINT ticket_scans_scan_result_check CHECK (
  scan_result IN (
    'VALID',
    'INVALID',
    'ALREADY_USED',
    'CANCELLED',
    'REFUNDED',
    'TRANSFER_PENDING',
    'NOT_IN_EVENT',
    'RATE_LIMIT_EXCEEDED',
    'UNDO',
    'ERROR'  -- NIEUW: Voor EXCEPTION handler
  )
);

-- Update comment
COMMENT ON COLUMN ticket_scans.scan_result IS
  'Result of scan: VALID, INVALID, ALREADY_USED, CANCELLED, REFUNDED, TRANSFER_PENDING, NOT_IN_EVENT, RATE_LIMIT_EXCEEDED, UNDO, ERROR';

-- ===========================================================================
-- Verification
-- ===========================================================================

DO $$
BEGIN
  -- Check pgcrypto is installed
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    RAISE EXCEPTION 'pgcrypto extension not installed';
  END IF;

  -- Check constraint exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ticket_scans_scan_result_check'
  ) THEN
    RAISE EXCEPTION 'ticket_scans_scan_result_check constraint not found';
  END IF;

  RAISE NOTICE 'F007 Hotfix: ERROR added to scan_result constraint, pgcrypto enabled';
END $$;
