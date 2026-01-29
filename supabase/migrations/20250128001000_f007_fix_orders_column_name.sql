-- ===========================================================================
-- F007 Hotfix: Fix column name in scan_ticket (customer_name → purchaser_name)
-- ===========================================================================
--
-- ERROR: column o.customer_name does not exist
--
-- De orders tabel heeft:
--   - purchaser_name (NIET customer_name)
--   - email (correct)
--
-- ===========================================================================

DROP FUNCTION IF EXISTS public.scan_ticket(UUID, TEXT, TEXT, INET, TEXT);

CREATE OR REPLACE FUNCTION public.scan_ticket(
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
  v_ticket_id UUID;
  v_ticket_type_id UUID;
  v_ticket_type_name TEXT;
  v_ticket_status TEXT;
  v_ticket RECORD;
  v_token_hash TEXT;
  v_org_id UUID;
  v_settings JSONB;
  v_rate_limit_per_minute INT;
  v_rate_limit_per_device INT;
  v_require_device_id BOOLEAN;
  v_pii_level TEXT;
  v_user_count INT;
  v_device_count INT;
  v_result TEXT;
  v_participant_name TEXT;
  v_participant_email TEXT;
  v_found_via_fallback BOOLEAN := FALSE;
BEGIN
  -- Hash the token
  v_token_hash := encode(
    extensions.digest(_token::bytea, 'sha256'::text),
    'hex'
  );

  -- STRATEGY 1: Find ticket by token_hash (fast, indexed lookup)
  SELECT
    ti.id,
    ti.ticket_type_id,
    ti.event_id,
    ti.status,
    ti.order_id,
    e.org_id
  INTO v_ticket
  FROM ticket_instances ti
  JOIN events e ON e.id = ti.event_id
  WHERE ti.token_hash = v_token_hash
    AND ti.event_id = _event_id
  FOR UPDATE SKIP LOCKED;

  -- STRATEGY 2: Fallback to plaintext qr_code for legacy tickets
  IF NOT FOUND THEN
    SELECT
      ti.id,
      ti.ticket_type_id,
      ti.event_id,
      ti.status,
      ti.order_id,
      e.org_id
    INTO v_ticket
    FROM ticket_instances ti
    JOIN events e ON e.id = ti.event_id
    WHERE ti.qr_code = _token
      AND ti.event_id = _event_id
      AND ti.token_hash IS NULL  -- Only legacy tickets
    FOR UPDATE SKIP LOCKED;

    IF FOUND THEN
      -- Auto-fix: Update token_hash for future scans
      UPDATE ticket_instances
      SET token_hash = v_token_hash
      WHERE id = v_ticket.id;

      v_found_via_fallback := TRUE;
      RAISE NOTICE 'Legacy ticket % auto-fixed with token_hash', v_ticket.id;
    END IF;
  END IF;

  -- Still not found? Token is invalid
  IF NOT FOUND THEN
    -- Log failed scan
    INSERT INTO ticket_scans (
      event_id, scanner_user_id, device_id, ip_address, user_agent,
      scan_result, reason_code
    ) VALUES (
      _event_id, auth.uid(), _device_id, _ip_address, _user_agent,
      'INVALID', 'TOKEN_NOT_FOUND'
    );

    RETURN jsonb_build_object(
      'result', 'INVALID',
      'message', 'Invalid ticket token'
    );
  END IF;

  v_ticket_id := v_ticket.id;
  v_org_id := v_ticket.org_id;

  -- Auth check
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'UNAUTHORIZED', 'message', 'Authentication required');
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

  -- Rate limiting (per user)
  SELECT COUNT(*) INTO v_user_count
  FROM ticket_scans
  WHERE scanner_user_id = auth.uid()
    AND event_id = _event_id
    AND scanned_at > NOW() - INTERVAL '1 minute';

  IF v_user_count >= v_rate_limit_per_minute THEN
    INSERT INTO ticket_scans (
      ticket_id, event_id, scanner_user_id, device_id, ip_address, user_agent,
      scan_result, reason_code
    ) VALUES (
      v_ticket_id, _event_id, auth.uid(), _device_id, _ip_address, _user_agent,
      'RATE_LIMIT_EXCEEDED', 'USER_RATE_LIMIT'
    );

    RETURN jsonb_build_object(
      'result', 'RATE_LIMIT_EXCEEDED',
      'message', 'Too many scans. Please wait.'
    );
  END IF;

  -- Rate limiting (per device)
  IF _device_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_device_count
    FROM ticket_scans
    WHERE device_id = _device_id
      AND event_id = _event_id
      AND scanned_at > NOW() - INTERVAL '1 minute';

    IF v_device_count >= v_rate_limit_per_device THEN
      INSERT INTO ticket_scans (
        ticket_id, event_id, scanner_user_id, device_id, ip_address, user_agent,
        scan_result, reason_code
      ) VALUES (
        v_ticket_id, _event_id, auth.uid(), _device_id, _ip_address, _user_agent,
        'RATE_LIMIT_EXCEEDED', 'DEVICE_RATE_LIMIT'
      );

      RETURN jsonb_build_object(
        'result', 'RATE_LIMIT_EXCEEDED',
        'message', 'Device scan limit exceeded.'
      );
    END IF;
  END IF;

  -- ===================================================================
  -- Map ticket status to scan result (ONLY valid enum values)
  -- ===================================================================
  v_result := CASE v_ticket.status::TEXT
    WHEN 'issued' THEN 'VALID'
    WHEN 'checked_in' THEN 'ALREADY_USED'
    WHEN 'void' THEN 'CANCELLED'
    ELSE 'INVALID'
  END;

  -- ===================================================================
  -- FIX: Get participant info using CORRECT column names
  -- orders.purchaser_name (NOT customer_name)
  -- orders.email (correct)
  -- ===================================================================
  SELECT o.purchaser_name, o.email
  INTO v_participant_name, v_participant_email
  FROM orders o
  WHERE o.id = v_ticket.order_id;

  -- Apply PII masking
  IF v_pii_level = 'masked' THEN
    v_participant_name := mask_participant_name(v_participant_name);
    v_participant_email := mask_email(v_participant_email);
  ELSIF v_pii_level = 'none' THEN
    v_participant_name := NULL;
    v_participant_email := NULL;
  END IF;

  -- Atomic update if valid
  IF v_result = 'VALID' THEN
    UPDATE ticket_instances
    SET status = 'checked_in',
        checked_in_at = NOW()
    WHERE id = v_ticket_id;
  END IF;

  -- Log scan
  INSERT INTO ticket_scans (
    ticket_id, event_id, scanner_user_id, device_id, ip_address, user_agent,
    scan_result, reason_code
  ) VALUES (
    v_ticket_id, _event_id, auth.uid(), _device_id, _ip_address, _user_agent,
    v_result, CASE WHEN v_found_via_fallback THEN 'LEGACY_TICKET_AUTO_FIXED' ELSE NULL END
  );

  -- Get ticket type name
  SELECT tt.name INTO v_ticket_type_name
  FROM ticket_types tt
  WHERE tt.id = v_ticket.ticket_type_id;

  -- Return result
  RETURN jsonb_build_object(
    'result', v_result,
    'ticket', jsonb_build_object(
      'id', v_ticket_id,
      'type_name', v_ticket_type_name,
      'participant_name', v_participant_name,
      'participant_email', v_participant_email,
      'checked_in_at', CASE WHEN v_result = 'VALID' THEN NOW() ELSE NULL END
    ),
    'message', CASE
      WHEN v_result = 'ALREADY_USED' THEN 'Ticket already scanned'
      WHEN v_result = 'CANCELLED' THEN 'Ticket has been voided/cancelled'
      WHEN v_found_via_fallback THEN 'Legacy ticket (auto-fixed)'
      ELSE NULL
    END
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Log error
    INSERT INTO ticket_scans (
      ticket_id, event_id, scanner_user_id, device_id, ip_address, user_agent,
      scan_result, reason_code
    ) VALUES (
      v_ticket_id, _event_id, auth.uid(), _device_id, _ip_address, _user_agent,
      'ERROR', SQLERRM
    );

    RETURN jsonb_build_object('error', 'ERROR', 'message', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.scan_ticket IS
  'F007: Professional ticket scanning - Fixed column names (purchaser_name, email)';

-- ===========================================================================
-- Verificatie
-- ===========================================================================

DO $$
BEGIN
  RAISE NOTICE '✓ F007: scan_ticket fixed - using correct column names';
  RAISE NOTICE '  orders.purchaser_name (was: customer_name)';
  RAISE NOTICE '  orders.email (correct)';
END $$;
