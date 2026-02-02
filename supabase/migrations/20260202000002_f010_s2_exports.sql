-- F010 S2: EXCEL EXPORT + BULK CHECK-IN
-- Migration: 20260202000002_f010_s2_exports.sql
--
-- Adds:
-- 1. export_registrations_xlsx_data RPC for client-side Excel generation
-- 2. bulk_checkin_participants RPC for multi-select check-in

-- ============================================
-- 1. EXCEL EXPORT RPC
-- ============================================

CREATE OR REPLACE FUNCTION public.export_registrations_xlsx_data(
  _event_id UUID,
  _filters JSONB DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_org_id UUID;
  v_role TEXT;
  v_event_name TEXT;
  v_max_rows INTEGER := 10000;
  v_columns JSONB;
  v_rows JSONB;
  v_total INTEGER;
BEGIN
  -- 1. Verify event exists and get org_id
  SELECT e.org_id, e.name INTO v_org_id, v_event_name
  FROM events e
  WHERE e.id = _event_id AND e.deleted_at IS NULL;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'NOT_FOUND',
      'message', 'Event not found'
    );
  END IF;

  -- 2. Verify org membership + admin role
  SELECT om.role INTO v_role
  FROM org_members om
  WHERE om.org_id = v_org_id AND om.user_id = auth.uid();

  IF v_role IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'NOT_AUTHORIZED',
      'message', 'Not a member of this organization'
    );
  END IF;

  IF v_role NOT IN ('owner', 'admin') THEN
    RETURN jsonb_build_object(
      'error', 'FORBIDDEN',
      'message', 'Admin role required for export'
    );
  END IF;

  -- 3. Define columns
  v_columns := '["email", "first_name", "last_name", "ticket_type", "registration_status", "payment_status", "assignment_status", "has_discount", "bib_number", "created_at", "checked_in_at"]'::jsonb;

  -- 4. Get data rows
  SELECT
    COUNT(*)::integer,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'email', rl.email,
        'first_name', rl.first_name,
        'last_name', rl.last_name,
        'ticket_type', rl.ticket_type_name,
        'registration_status', rl.registration_status,
        'payment_status', rl.payment_status,
        'assignment_status', rl.assignment_status,
        'has_discount', rl.has_discount,
        'bib_number', rl.bib_number,
        'created_at', to_char(rl.created_at, 'YYYY-MM-DD HH24:MI:SS'),
        'checked_in_at', CASE
          WHEN rl.checked_in_at IS NOT NULL
          THEN to_char(rl.checked_in_at, 'YYYY-MM-DD HH24:MI:SS')
          ELSE NULL
        END
      )
      ORDER BY rl.created_at DESC
    ), '[]'::jsonb)
  INTO v_total, v_rows
  FROM registrations_list_v rl
  WHERE rl.event_id = _event_id
    -- Apply filters
    AND ((_filters->>'ticket_type_id') IS NULL
         OR rl.ticket_type_id = (_filters->>'ticket_type_id')::uuid)
    AND ((_filters->>'registration_status') IS NULL
         OR rl.registration_status::text = (_filters->>'registration_status'))
    AND ((_filters->>'payment_status') IS NULL
         OR rl.payment_status = (_filters->>'payment_status'))
    AND ((_filters->>'assignment_status') IS NULL
         OR rl.assignment_status = (_filters->>'assignment_status'))
    AND ((_filters->>'search') IS NULL OR (
         rl.email ILIKE '%' || (_filters->>'search') || '%'
         OR rl.first_name ILIKE '%' || (_filters->>'search') || '%'
         OR rl.last_name ILIKE '%' || (_filters->>'search') || '%'))
  LIMIT v_max_rows;

  -- 5. Return structured data for client-side xlsx generation
  RETURN jsonb_build_object(
    'event_name', v_event_name,
    'export_date', to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
    'total_rows', COALESCE(v_total, 0),
    'columns', v_columns,
    'rows', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.export_registrations_xlsx_data IS
  'Returns structured JSONB data for client-side Excel generation. Requires admin role.';

GRANT EXECUTE ON FUNCTION public.export_registrations_xlsx_data(UUID, JSONB) TO authenticated;


-- ============================================
-- 2. BULK CHECK-IN RPC
-- ============================================

CREATE OR REPLACE FUNCTION public.bulk_checkin_participants(
  _event_id UUID,
  _ticket_instance_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_success_count INTEGER := 0;
  v_failed_count INTEGER := 0;
  v_failures JSONB := '[]'::jsonb;
  v_ticket_id UUID;
  v_ticket_status TEXT;
  v_ticket_event_id UUID;
BEGIN
  -- 1. Verify event exists and get org_id
  SELECT e.org_id INTO v_org_id
  FROM events e
  WHERE e.id = _event_id AND e.deleted_at IS NULL;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'NOT_FOUND',
      'message', 'Event not found'
    );
  END IF;

  -- 2. Verify org membership
  IF NOT public.is_org_member(v_org_id) THEN
    RETURN jsonb_build_object(
      'error', 'NOT_AUTHORIZED',
      'message', 'Not a member of this organization'
    );
  END IF;

  -- 3. Process each ticket
  FOREACH v_ticket_id IN ARRAY _ticket_instance_ids
  LOOP
    -- Get ticket status and event
    SELECT ti.status, ti.event_id
    INTO v_ticket_status, v_ticket_event_id
    FROM ticket_instances ti
    WHERE ti.id = v_ticket_id;

    -- Validate ticket
    IF v_ticket_event_id IS NULL THEN
      v_failed_count := v_failed_count + 1;
      v_failures := v_failures || jsonb_build_object(
        'id', v_ticket_id,
        'reason', 'NOT_FOUND'
      );
      CONTINUE;
    END IF;

    IF v_ticket_event_id != _event_id THEN
      v_failed_count := v_failed_count + 1;
      v_failures := v_failures || jsonb_build_object(
        'id', v_ticket_id,
        'reason', 'WRONG_EVENT'
      );
      CONTINUE;
    END IF;

    IF v_ticket_status = 'checked_in' THEN
      v_failed_count := v_failed_count + 1;
      v_failures := v_failures || jsonb_build_object(
        'id', v_ticket_id,
        'reason', 'ALREADY_CHECKED_IN'
      );
      CONTINUE;
    END IF;

    IF v_ticket_status = 'void' THEN
      v_failed_count := v_failed_count + 1;
      v_failures := v_failures || jsonb_build_object(
        'id', v_ticket_id,
        'reason', 'TICKET_VOID'
      );
      CONTINUE;
    END IF;

    -- Check in the ticket
    UPDATE ticket_instances
    SET
      status = 'checked_in',
      checked_in_at = now(),
      checked_in_by = auth.uid(),
      updated_at = now()
    WHERE id = v_ticket_id;

    -- Create check-in record
    INSERT INTO ticket_checkins (
      org_id,
      event_id,
      ticket_instance_id,
      checked_in_at,
      checked_in_by,
      source,
      metadata
    )
    VALUES (
      v_org_id,
      _event_id,
      v_ticket_id,
      now(),
      auth.uid(),
      'bulk',
      jsonb_build_object('method', 'bulk_checkin')
    )
    ON CONFLICT (ticket_instance_id) DO NOTHING;

    v_success_count := v_success_count + 1;
  END LOOP;

  -- 4. Return results
  RETURN jsonb_build_object(
    'success_count', v_success_count,
    'failed_count', v_failed_count,
    'failures', v_failures,
    'total_processed', array_length(_ticket_instance_ids, 1)
  );
END;
$$;

COMMENT ON FUNCTION public.bulk_checkin_participants IS
  'Checks in multiple tickets at once. Returns success/failure counts. Requires org membership.';

GRANT EXECUTE ON FUNCTION public.bulk_checkin_participants(UUID, UUID[]) TO authenticated;
