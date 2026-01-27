-- ===========================================================================
-- F007 UPGRADE: Support RPCs for Scanning
-- Migration: 20250127210004_f007_scan_support_rpcs.sql
--
-- Purpose:
-- - undo_check_in: Admin-only revert check-in
-- - get_scan_stats: Real-time scanning statistics
-- ===========================================================================

-- ===========================================================================
-- 1. UNDO CHECK-IN (Admin Only)
-- ===========================================================================

CREATE OR REPLACE FUNCTION undo_check_in(
  _ticket_id UUID,
  _reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket RECORD;
  v_org_id UUID;
  v_settings JSONB;
  v_allow_undo BOOLEAN;
BEGIN
  -- Get ticket
  SELECT * INTO v_ticket
  FROM ticket_instances
  WHERE id = _ticket_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'TICKET_NOT_FOUND');
  END IF;

  -- Get event org_id
  SELECT org_id INTO v_org_id FROM events WHERE id = v_ticket.event_id;

  -- Check admin/owner role
  IF NOT (public.has_role(v_org_id, 'admin') OR public.has_role(v_org_id, 'owner')) THEN
    RETURN jsonb_build_object('error', 'UNAUTHORIZED', 'message', 'Only admins can undo check-ins');
  END IF;

  -- Check settings
  SELECT setting_value INTO v_settings
  FROM event_settings
  WHERE event_id = v_ticket.event_id AND domain = 'scanning';

  IF v_settings IS NULL THEN
    v_settings := (SELECT get_default_settings()->'scanning');
  END IF;

  v_allow_undo := COALESCE((v_settings->>'allow_undo_checkin')::boolean, false);

  IF NOT v_allow_undo THEN
    RETURN jsonb_build_object('error', 'UNDO_NOT_ALLOWED', 'message', 'Undo check-in is disabled for this event');
  END IF;

  -- Check if ticket is checked_in
  IF v_ticket.status != 'checked_in' THEN
    RETURN jsonb_build_object('error', 'NOT_CHECKED_IN', 'message', 'Ticket is not checked in');
  END IF;

  -- Revert to issued
  UPDATE ticket_instances
  SET status = 'issued',
      checked_in_at = NULL,
      checked_in_by = NULL,
      updated_at = NOW()
  WHERE id = _ticket_id;

  -- Audit log
  INSERT INTO ticket_scans (
    ticket_id, event_id, scanner_user_id, scan_result, reason_code, metadata
  ) VALUES (
    _ticket_id,
    v_ticket.event_id,
    auth.uid(),
    'UNDO',
    'ADMIN_UNDO',
    jsonb_build_object('reason', _reason, 'previous_checked_in_by', v_ticket.checked_in_by)
  );

  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', _ticket_id,
    'message', 'Check-in undone successfully'
  );
END;
$$;

COMMENT ON FUNCTION undo_check_in IS
  'Admin-only: Undo a check-in. Requires allow_undo_checkin setting enabled.';

GRANT EXECUTE ON FUNCTION undo_check_in TO authenticated;

-- ===========================================================================
-- 2. GET SCAN STATISTICS
-- ===========================================================================

CREATE OR REPLACE FUNCTION get_scan_stats(
  _event_id UUID,
  _time_window_minutes INTEGER DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_total_scans INTEGER;
  v_valid_scans INTEGER;
  v_invalid_scans INTEGER;
  v_already_used_scans INTEGER;
  v_scans_in_window INTEGER;
  v_scans_per_minute NUMERIC;
  v_unique_scanners INTEGER;
  v_total_tickets INTEGER;
  v_checked_in_tickets INTEGER;
BEGIN
  -- Get org_id
  SELECT org_id INTO v_org_id FROM events WHERE id = _event_id;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('error', 'EVENT_NOT_FOUND');
  END IF;

  -- Check org membership
  IF NOT public.is_org_member(v_org_id) THEN
    RETURN jsonb_build_object('error', 'UNAUTHORIZED');
  END IF;

  -- Total scans (all time)
  SELECT COUNT(*) INTO v_total_scans
  FROM ticket_scans
  WHERE event_id = _event_id;

  -- Valid scans
  SELECT COUNT(*) INTO v_valid_scans
  FROM ticket_scans
  WHERE event_id = _event_id
    AND scan_result = 'VALID';

  -- Invalid scans
  SELECT COUNT(*) INTO v_invalid_scans
  FROM ticket_scans
  WHERE event_id = _event_id
    AND scan_result IN ('INVALID', 'NOT_IN_EVENT');

  -- Already used scans
  SELECT COUNT(*) INTO v_already_used_scans
  FROM ticket_scans
  WHERE event_id = _event_id
    AND scan_result = 'ALREADY_USED';

  -- Scans in time window
  SELECT COUNT(*) INTO v_scans_in_window
  FROM ticket_scans
  WHERE event_id = _event_id
    AND scanned_at > NOW() - INTERVAL '1 minute' * _time_window_minutes;

  -- Scans per minute average
  IF _time_window_minutes > 0 THEN
    v_scans_per_minute := v_scans_in_window::numeric / _time_window_minutes::numeric;
  ELSE
    v_scans_per_minute := 0;
  END IF;

  -- Unique scanners
  SELECT COUNT(DISTINCT scanner_user_id) INTO v_unique_scanners
  FROM ticket_scans
  WHERE event_id = _event_id;

  -- Total tickets for event
  SELECT COUNT(*) INTO v_total_tickets
  FROM ticket_instances
  WHERE event_id = _event_id
    AND status != 'void';

  -- Checked-in tickets
  SELECT COUNT(*) INTO v_checked_in_tickets
  FROM ticket_instances
  WHERE event_id = _event_id
    AND status = 'checked_in';

  RETURN jsonb_build_object(
    'event_id', _event_id,
    'total_scans', v_total_scans,
    'valid_scans', v_valid_scans,
    'invalid_scans', v_invalid_scans,
    'already_used_scans', v_already_used_scans,
    'scans_last_window', v_scans_in_window,
    'scans_per_minute_avg', ROUND(v_scans_per_minute, 2),
    'unique_scanners', v_unique_scanners,
    'total_tickets', v_total_tickets,
    'checked_in_tickets', v_checked_in_tickets,
    'check_in_percentage', CASE
      WHEN v_total_tickets > 0 THEN ROUND((v_checked_in_tickets::numeric / v_total_tickets::numeric) * 100, 2)
      ELSE 0
    END
  );
END;
$$;

COMMENT ON FUNCTION get_scan_stats IS
  'Returns real-time scanning statistics for an event.';

GRANT EXECUTE ON FUNCTION get_scan_stats TO authenticated;

-- ===========================================================================
-- 3. GET RECENT SCANS (for scan history log)
-- ===========================================================================

CREATE OR REPLACE FUNCTION get_recent_scans(
  _event_id UUID,
  _limit INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_scans JSONB;
BEGIN
  -- Get org_id
  SELECT org_id INTO v_org_id FROM events WHERE id = _event_id;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('error', 'EVENT_NOT_FOUND');
  END IF;

  -- Check org membership
  IF NOT public.is_org_member(v_org_id) THEN
    RETURN jsonb_build_object('error', 'UNAUTHORIZED');
  END IF;

  -- Get recent scans
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'ticket_id', s.ticket_id,
      'scan_result', s.scan_result,
      'scanned_at', s.scanned_at,
      'scanner_email', u.email,
      'device_id', s.device_id
    ) ORDER BY s.scanned_at DESC
  ), '[]'::jsonb) INTO v_scans
  FROM ticket_scans s
  LEFT JOIN auth.users u ON u.id = s.scanner_user_id
  WHERE s.event_id = _event_id
  ORDER BY s.scanned_at DESC
  LIMIT _limit;

  RETURN jsonb_build_object(
    'event_id', _event_id,
    'scans', v_scans
  );
END;
$$;

COMMENT ON FUNCTION get_recent_scans IS
  'Returns recent scan attempts for an event (for scan history display).';

GRANT EXECUTE ON FUNCTION get_recent_scans TO authenticated;

-- ===========================================================================
-- END MIGRATION
-- ===========================================================================
