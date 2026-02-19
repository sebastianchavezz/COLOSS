-- ===========================================================================
-- F015 S3: scan_ticket uitbreiden met order_products
-- Migration: 20260219500000_f015_s3_scanner_products.sql
--
-- Purpose:
-- - Bij VALID en ALREADY_USED scans worden nu alle producten uit de
--   bestelling meegestuurd in het response object (order_products array).
-- - Dit geeft event staff direct inzicht in welke extra's de deelnemer
--   heeft besteld (t-shirts, lunch, etc.).
--
-- Security: Functie is al SECURITY DEFINER + verifieert org membership.
--           Product-data is geen PII.
-- ===========================================================================

CREATE OR REPLACE FUNCTION scan_ticket(
  _event_id UUID,
  _token TEXT,
  _device_id TEXT DEFAULT NULL,
  _ip_address INET DEFAULT NULL,
  _user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_scanner_user_id UUID;
  v_settings JSONB;
  v_rate_limit_per_minute INTEGER;
  v_rate_limit_per_device INTEGER;
  v_require_device_id BOOLEAN;
  v_pii_level TEXT;
  v_scan_count_user INTEGER;
  v_scan_count_device INTEGER;
  v_ticket RECORD;
  v_participant RECORD;
  v_result JSONB;
  v_scan_result TEXT;
  v_reason_code TEXT;
  v_token_hash TEXT;
  v_order_products JSONB;
BEGIN
  -- Get current user
  v_scanner_user_id := auth.uid();

  IF v_scanner_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'UNAUTHORIZED', 'message', 'Authentication required');
  END IF;

  -- Get event org_id
  SELECT org_id INTO v_org_id FROM events WHERE id = _event_id;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('error', 'EVENT_NOT_FOUND');
  END IF;

  -- Check org membership (scanner permission)
  IF NOT public.is_org_member(v_org_id) THEN
    RETURN jsonb_build_object('error', 'UNAUTHORIZED', 'message', 'Must be org member to scan tickets');
  END IF;

  -- Get scanning settings
  SELECT setting_value INTO v_settings
  FROM event_settings
  WHERE event_id = _event_id AND domain = 'scanning';

  IF v_settings IS NULL THEN
    -- Use defaults
    v_settings := (SELECT get_default_settings()->'scanning');
  END IF;

  -- Check if scanning enabled
  IF (v_settings->>'enabled')::boolean = false THEN
    RETURN jsonb_build_object('error', 'SCANNING_DISABLED', 'message', 'Scanning is disabled for this event');
  END IF;

  -- Get rate limits
  v_rate_limit_per_minute := COALESCE((v_settings->'rate_limit'->>'per_minute')::integer, 60);
  v_rate_limit_per_device := COALESCE((v_settings->'rate_limit'->>'per_device_per_minute')::integer, 30);
  v_require_device_id := COALESCE((v_settings->>'require_device_id')::boolean, false);
  v_pii_level := COALESCE(v_settings->'response'->>'pii_level', 'masked');

  -- Check device_id requirement
  IF v_require_device_id AND _device_id IS NULL THEN
    RETURN jsonb_build_object('error', 'DEVICE_ID_REQUIRED', 'message', 'Device ID is required for scanning');
  END IF;

  -- Rate limit check: user
  SELECT COUNT(*) INTO v_scan_count_user
  FROM ticket_scans
  WHERE scanner_user_id = v_scanner_user_id
    AND scanned_at > NOW() - INTERVAL '1 minute';

  IF v_scan_count_user >= v_rate_limit_per_minute THEN
    -- Log rate limit hit
    INSERT INTO ticket_scans (
      ticket_id, event_id, scanner_user_id, device_id, ip_address, user_agent,
      scan_result, reason_code, metadata
    ) VALUES (
      NULL, _event_id, v_scanner_user_id, _device_id, _ip_address, _user_agent,
      'RATE_LIMIT_EXCEEDED', 'USER_LIMIT', jsonb_build_object('scans_last_minute', v_scan_count_user)
    );

    RETURN jsonb_build_object(
      'result', 'RATE_LIMIT_EXCEEDED',
      'message', format('Rate limit exceeded: %s scans in last minute', v_scan_count_user)
    );
  END IF;

  -- Rate limit check: device (if device_id provided)
  IF _device_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_scan_count_device
    FROM ticket_scans
    WHERE device_id = _device_id
      AND scanned_at > NOW() - INTERVAL '1 minute';

    IF v_scan_count_device >= v_rate_limit_per_device THEN
      INSERT INTO ticket_scans (
        ticket_id, event_id, scanner_user_id, device_id, ip_address, user_agent,
        scan_result, reason_code, metadata
      ) VALUES (
        NULL, _event_id, v_scanner_user_id, _device_id, _ip_address, _user_agent,
        'RATE_LIMIT_EXCEEDED', 'DEVICE_LIMIT', jsonb_build_object('scans_last_minute', v_scan_count_device)
      );

      RETURN jsonb_build_object(
        'result', 'RATE_LIMIT_EXCEEDED',
        'message', format('Device rate limit exceeded: %s scans in last minute', v_scan_count_device)
      );
    END IF;
  END IF;

  -- Hash token (simple SHA256 for now, could use bcrypt)
  v_token_hash := encode(extensions.digest(_token::bytea, 'sha256'::text), 'hex');

  -- Lookup ticket (with row locking for concurrency safety)
  SELECT * INTO v_ticket
  FROM ticket_instances
  WHERE token_hash = v_token_hash
  FOR UPDATE SKIP LOCKED;  -- Skip if already being scanned

  -- Check if ticket found
  IF NOT FOUND THEN
    v_scan_result := 'INVALID';
    v_reason_code := 'TOKEN_NOT_FOUND';

    INSERT INTO ticket_scans (
      ticket_id, event_id, scanner_user_id, device_id, ip_address, user_agent,
      scan_result, reason_code
    ) VALUES (
      NULL, _event_id, v_scanner_user_id, _device_id, _ip_address, _user_agent,
      v_scan_result, v_reason_code
    );

    RETURN jsonb_build_object('result', v_scan_result, 'message', 'Invalid token');
  END IF;

  -- Check event match
  IF v_ticket.event_id != _event_id THEN
    v_scan_result := 'NOT_IN_EVENT';
    v_reason_code := 'EVENT_MISMATCH';

    INSERT INTO ticket_scans (
      ticket_id, event_id, scanner_user_id, device_id, ip_address, user_agent,
      scan_result, reason_code, metadata
    ) VALUES (
      v_ticket.id, _event_id, v_scanner_user_id, _device_id, _ip_address, _user_agent,
      v_scan_result, v_reason_code, jsonb_build_object('ticket_event_id', v_ticket.event_id)
    );

    RETURN jsonb_build_object('result', v_scan_result, 'message', 'Ticket is for a different event');
  END IF;

  -- Check ticket status
  IF v_ticket.status = 'void' THEN
    v_scan_result := 'CANCELLED';
    v_reason_code := 'STATUS_VOID';
  ELSIF v_ticket.status = 'checked_in' THEN
    v_scan_result := 'ALREADY_USED';
    v_reason_code := 'STATUS_CHECKED_IN';
  ELSE
    v_scan_result := 'VALID';
    v_reason_code := NULL;

    -- Atomic update: issue -> checked_in
    UPDATE ticket_instances
    SET status = 'checked_in',
        checked_in_at = NOW(),
        checked_in_by = v_scanner_user_id,
        updated_at = NOW()
    WHERE id = v_ticket.id;
  END IF;

  -- Insert audit log
  INSERT INTO ticket_scans (
    ticket_id, event_id, scanner_user_id, device_id, ip_address, user_agent,
    scan_result, reason_code
  ) VALUES (
    v_ticket.id, _event_id, v_scanner_user_id, _device_id, _ip_address, _user_agent,
    v_scan_result, v_reason_code
  );

  -- Get participant info for response (if VALID or ALREADY_USED)
  IF v_scan_result IN ('VALID', 'ALREADY_USED') THEN
    -- Get participant via order
    SELECT
      p.name,
      p.email,
      tt.name as ticket_type_name
    INTO v_participant
    FROM orders o
    LEFT JOIN participants p ON p.id = o.participant_id
    JOIN ticket_types tt ON tt.id = v_ticket.ticket_type_id
    WHERE o.id = v_ticket.order_id;

    -- Get order products (all products from the entire order)
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'product_name', pr.name,
        'product_category', pr.category,
        'variant_name', pv.name,
        'quantity', oi.quantity,
        'instructions', pr.instructions
      ) ORDER BY oi.id
    ), '[]'::jsonb)
    INTO v_order_products
    FROM order_items oi
    JOIN products pr ON pr.id = oi.product_id
    LEFT JOIN product_variants pv ON pv.id = oi.product_variant_id
    WHERE oi.order_id = v_ticket.order_id
      AND oi.product_id IS NOT NULL;

    -- Build response with PII masking
    v_result := jsonb_build_object(
      'result', v_scan_result,
      'ticket', jsonb_build_object(
        'id', v_ticket.id,
        'type_name', v_participant.ticket_type_name,
        'participant_name', CASE
          WHEN v_pii_level = 'none' THEN NULL
          WHEN v_pii_level = 'masked' THEN mask_participant_name(v_participant.name)
          WHEN v_pii_level = 'full-for-admin' AND (public.has_role(v_org_id, 'admin') OR public.has_role(v_org_id, 'owner')) THEN v_participant.name
          ELSE mask_participant_name(v_participant.name)
        END,
        'participant_email', CASE
          WHEN v_pii_level = 'none' THEN NULL
          WHEN v_pii_level = 'masked' THEN mask_email(v_participant.email)
          WHEN v_pii_level = 'full-for-admin' AND (public.has_role(v_org_id, 'admin') OR public.has_role(v_org_id, 'owner')) THEN v_participant.email
          ELSE mask_email(v_participant.email)
        END,
        'checked_in_at', v_ticket.checked_in_at,
        'checked_in_by', v_ticket.checked_in_by,
        'order_products', v_order_products
      )
    );
  ELSE
    -- Failed scan
    v_result := jsonb_build_object('result', v_scan_result);
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION scan_ticket IS
  'Scan a ticket token for check-in. Idempotent, atomic, rate-limited, auditable. Includes order products.';

GRANT EXECUTE ON FUNCTION scan_ticket TO authenticated;

-- ===========================================================================
-- Verificatie
-- ===========================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'scan_ticket'
    ) THEN
        RAISE EXCEPTION 'scan_ticket() NOT FOUND after migration';
    END IF;
    RAISE NOTICE 'OK: scan_ticket() updated with order_products support';
    RAISE NOTICE '=== F015 S3: Scanner Products - Migration Complete ===';
END$$;
