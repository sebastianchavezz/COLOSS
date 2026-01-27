-- ===========================================================================
-- F007 UPGRADE: Ticket Scanning - Audit Log Table
-- Migration: 20250127210001_f007_ticket_scanning_table.sql
--
-- Purpose:
-- - Create ticket_scans table (append-only audit log)
-- - Track ALL scan attempts (success + failures)
-- - Anti-fraude & compliance
-- ===========================================================================

-- ===========================================================================
-- 0. ENABLE EXTENSIONS
-- ===========================================================================

-- Enable pgcrypto for token hashing (SHA256)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ===========================================================================
-- 1. CREATE TICKET_SCANS TABLE
-- ===========================================================================

CREATE TABLE IF NOT EXISTS ticket_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Context
  ticket_id UUID,  -- NULL if token was invalid
  event_id UUID NOT NULL,

  -- Scanner info
  scanner_user_id UUID NOT NULL,
  device_id TEXT,
  ip_address INET,
  user_agent TEXT,

  -- Scan result
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scan_result TEXT NOT NULL,  -- VALID, INVALID, ALREADY_USED, CANCELLED, etc.
  reason_code TEXT,

  -- Metadata (extra context)
  metadata JSONB DEFAULT '{}',

  -- Foreign keys
  CONSTRAINT ticket_scans_ticket_id_fkey FOREIGN KEY (ticket_id)
    REFERENCES ticket_instances(id) ON DELETE CASCADE,
  CONSTRAINT ticket_scans_event_id_fkey FOREIGN KEY (event_id)
    REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT ticket_scans_scanner_user_id_fkey FOREIGN KEY (scanner_user_id)
    REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Validate scan_result enum
  CONSTRAINT ticket_scans_scan_result_check CHECK (
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
      'ERROR'
    )
  )
);

COMMENT ON TABLE ticket_scans IS
  'Append-only audit log for all ticket scan attempts (success + failures)';

COMMENT ON COLUMN ticket_scans.ticket_id IS
  'Ticket that was scanned (NULL if token invalid)';

COMMENT ON COLUMN ticket_scans.scan_result IS
  'Result of scan: VALID, INVALID, ALREADY_USED, CANCELLED, REFUNDED, TRANSFER_PENDING, NOT_IN_EVENT, RATE_LIMIT_EXCEEDED, UNDO, ERROR';

COMMENT ON COLUMN ticket_scans.reason_code IS
  'Optional machine-readable code for failure reason (e.g., "TOKEN_NOT_FOUND", "STATUS_VOID")';

-- ===========================================================================
-- 2. INDEXES
-- ===========================================================================

CREATE INDEX IF NOT EXISTS idx_ticket_scans_ticket_id
  ON ticket_scans(ticket_id);

CREATE INDEX IF NOT EXISTS idx_ticket_scans_event_id
  ON ticket_scans(event_id);

CREATE INDEX IF NOT EXISTS idx_ticket_scans_scanner_user_id
  ON ticket_scans(scanner_user_id);

CREATE INDEX IF NOT EXISTS idx_ticket_scans_scanned_at
  ON ticket_scans(scanned_at DESC);

-- Composite for rate limiting queries
CREATE INDEX IF NOT EXISTS idx_ticket_scans_device_time
  ON ticket_scans(device_id, scanned_at)
  WHERE device_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ticket_scans_user_time
  ON ticket_scans(scanner_user_id, scanned_at);

-- Composite for event stats
CREATE INDEX IF NOT EXISTS idx_ticket_scans_event_result
  ON ticket_scans(event_id, scan_result, scanned_at DESC);

-- ===========================================================================
-- 3. RLS POLICIES
-- ===========================================================================

ALTER TABLE ticket_scans ENABLE ROW LEVEL SECURITY;

-- Org members can view scans for their events
CREATE POLICY "Org members can view ticket_scans"
  ON ticket_scans
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = ticket_scans.event_id
      AND public.is_org_member(e.org_id)
    )
  );

-- Only via RPC/Edge Functions (service role implicit)
-- Authenticated users CANNOT directly INSERT
CREATE POLICY "Service role can insert ticket_scans"
  ON ticket_scans
  FOR INSERT
  WITH CHECK (false);  -- Blocked, only SECURITY DEFINER functions can insert

-- No UPDATE or DELETE allowed (append-only)
-- RLS defaults to deny

-- ===========================================================================
-- 4. GRANTS
-- ===========================================================================

GRANT SELECT ON ticket_scans TO authenticated;
-- No INSERT/UPDATE/DELETE grants for authenticated

-- ===========================================================================
-- END MIGRATION
-- ===========================================================================
