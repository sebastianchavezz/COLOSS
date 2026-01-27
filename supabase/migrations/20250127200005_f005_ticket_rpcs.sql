-- ===========================================================================
-- F005 UPGRADE: Ticket Configuration RPC Functions
-- Migration: 20250127200005_f005_ticket_rpcs.sql
--
-- Purpose:
-- - RPC for getting full ticket type configuration
-- - RPC for updating ticket configuration
-- - RPC for i18n management
-- ===========================================================================

-- ===========================================================================
-- 1. GET FULL TICKET TYPE CONFIGURATION
-- ===========================================================================

CREATE OR REPLACE FUNCTION get_ticket_type_full(
  _ticket_type_id UUID,
  _locale TEXT DEFAULT 'nl'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_org_id UUID;
  v_is_public BOOLEAN;
BEGIN
  -- Get org_id and check if published
  SELECT
    e.org_id,
    (e.status = 'published' AND tt.status = 'published' AND tt.visibility = 'visible')
  INTO v_org_id, v_is_public
  FROM ticket_types tt
  JOIN events e ON e.id = tt.event_id
  WHERE tt.id = _ticket_type_id
  AND tt.deleted_at IS NULL;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('error', 'TICKET_TYPE_NOT_FOUND');
  END IF;

  -- Check access: either public or org member
  IF NOT v_is_public AND NOT public.is_org_member(v_org_id) THEN
    RETURN jsonb_build_object('error', 'UNAUTHORIZED');
  END IF;

  -- Build full response
  SELECT jsonb_build_object(
    'ticket_type', (
      SELECT to_jsonb(tt.*)
      FROM ticket_types tt
      WHERE tt.id = _ticket_type_id
    ),
    'i18n', COALESCE(
      (SELECT jsonb_object_agg(i18n.locale, jsonb_build_object(
        'name', i18n.name,
        'description', i18n.description,
        'instructions', i18n.instructions
      ))
      FROM ticket_type_i18n i18n
      WHERE i18n.ticket_type_id = _ticket_type_id),
      '{}'::jsonb
    ),
    'current_locale', COALESCE(
      (SELECT to_jsonb(i18n.*)
       FROM ticket_type_i18n i18n
       WHERE i18n.ticket_type_id = _ticket_type_id
       AND i18n.locale = _locale),
      '{}'::jsonb
    ),
    'time_slots', COALESCE(
      (SELECT jsonb_agg(to_jsonb(ts.*) ORDER BY ts.sort_order, ts.slot_time)
       FROM ticket_time_slots ts
       WHERE ts.ticket_type_id = _ticket_type_id
       AND ts.deleted_at IS NULL),
      '[]'::jsonb
    ),
    'team_config', COALESCE(
      (SELECT to_jsonb(tc.*)
       FROM ticket_team_config tc
       WHERE tc.ticket_type_id = _ticket_type_id),
      jsonb_build_object(
        'team_required', false,
        'team_min_size', 2,
        'team_max_size', 10,
        'allow_incomplete_teams', false,
        'captain_required', true
      )
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_ticket_type_full IS
  'Returns complete ticket type configuration including i18n, time slots, and team config';

GRANT EXECUTE ON FUNCTION get_ticket_type_full TO authenticated, anon;

-- ===========================================================================
-- 2. UPDATE TICKET TYPE BASE INFO
-- ===========================================================================

CREATE OR REPLACE FUNCTION update_ticket_type_extended(
  _ticket_type_id UUID,
  _updates JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  -- Get org_id
  SELECT e.org_id INTO v_org_id
  FROM ticket_types tt
  JOIN events e ON e.id = tt.event_id
  WHERE tt.id = _ticket_type_id;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('error', 'TICKET_TYPE_NOT_FOUND');
  END IF;

  -- Check admin/owner
  IF NOT (public.has_role(v_org_id, 'admin') OR public.has_role(v_org_id, 'owner')) THEN
    RETURN jsonb_build_object('error', 'UNAUTHORIZED');
  END IF;

  -- Update ticket_types
  UPDATE ticket_types SET
    -- Basisinformatie
    distance_value = COALESCE((_updates->>'distance_value')::numeric, distance_value),
    distance_unit = COALESCE(_updates->>'distance_unit', distance_unit),
    image_url = COALESCE(_updates->>'image_url', image_url),
    instructions = COALESCE(_updates->'instructions', instructions),
    -- Tickettype
    ticket_category = COALESCE(_updates->>'ticket_category', ticket_category),
    -- Beperkingen
    max_per_participant = CASE
      WHEN _updates ? 'max_per_participant' THEN (_updates->>'max_per_participant')::integer
      ELSE max_per_participant
    END,
    visibility = COALESCE(_updates->>'visibility', visibility),
    requires_invitation_code = COALESCE((_updates->>'requires_invitation_code')::boolean, requires_invitation_code),
    -- Standard fields
    name = COALESCE(_updates->>'name', name),
    description = COALESCE(_updates->>'description', description),
    price = COALESCE((_updates->>'price')::numeric, price),
    vat_percentage = COALESCE((_updates->>'vat_percentage')::numeric, vat_percentage),
    capacity_total = COALESCE((_updates->>'capacity_total')::integer, capacity_total),
    sales_start = CASE
      WHEN _updates ? 'sales_start' THEN (_updates->>'sales_start')::timestamptz
      ELSE sales_start
    END,
    sales_end = CASE
      WHEN _updates ? 'sales_end' THEN (_updates->>'sales_end')::timestamptz
      ELSE sales_end
    END,
    status = COALESCE(_updates->>'status', status),
    updated_at = NOW()
  WHERE id = _ticket_type_id;

  -- Audit log
  INSERT INTO audit_log (org_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_org_id,
    auth.uid(),
    'TICKET_TYPE_UPDATED',
    'ticket_type',
    _ticket_type_id,
    _updates
  );

  RETURN jsonb_build_object('success', true, 'ticket_type_id', _ticket_type_id);
END;
$$;

COMMENT ON FUNCTION update_ticket_type_extended IS
  'Update ticket type configuration (extended fields included)';

GRANT EXECUTE ON FUNCTION update_ticket_type_extended TO authenticated;

-- ===========================================================================
-- 3. UPSERT I18N
-- ===========================================================================

CREATE OR REPLACE FUNCTION upsert_ticket_type_i18n(
  _ticket_type_id UUID,
  _locale TEXT,
  _name TEXT,
  _description TEXT DEFAULT NULL,
  _instructions TEXT DEFAULT NULL
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
  INSERT INTO ticket_type_i18n (ticket_type_id, locale, name, description, instructions)
  VALUES (_ticket_type_id, _locale, _name, _description, _instructions)
  ON CONFLICT (ticket_type_id, locale) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    instructions = EXCLUDED.instructions,
    updated_at = NOW()
  RETURNING id INTO v_id;

  -- Audit log
  INSERT INTO audit_log (org_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_org_id,
    auth.uid(),
    'TICKET_TYPE_I18N_UPDATED',
    'ticket_type_i18n',
    v_id,
    jsonb_build_object(
      'ticket_type_id', _ticket_type_id,
      'locale', _locale
    )
  );

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION upsert_ticket_type_i18n IS
  'Create or update i18n content for a ticket type';

GRANT EXECUTE ON FUNCTION upsert_ticket_type_i18n TO authenticated;

-- ===========================================================================
-- 4. MANAGE TIME SLOTS
-- ===========================================================================

CREATE OR REPLACE FUNCTION upsert_ticket_time_slot(
  _ticket_type_id UUID,
  _slot_time TIME,
  _slot_date DATE DEFAULT NULL,
  _label TEXT DEFAULT NULL,
  _capacity INTEGER DEFAULT NULL,
  _sort_order INTEGER DEFAULT 0,
  _id UUID DEFAULT NULL  -- Pass existing ID to update
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

  IF _id IS NOT NULL THEN
    -- Update existing
    UPDATE ticket_time_slots SET
      slot_time = _slot_time,
      slot_date = _slot_date,
      label = _label,
      capacity = _capacity,
      sort_order = _sort_order,
      updated_at = NOW()
    WHERE id = _id
    AND ticket_type_id = _ticket_type_id
    RETURNING id INTO v_id;
  ELSE
    -- Insert new
    INSERT INTO ticket_time_slots (ticket_type_id, slot_time, slot_date, label, capacity, sort_order)
    VALUES (_ticket_type_id, _slot_time, _slot_date, _label, _capacity, _sort_order)
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION upsert_ticket_time_slot IS
  'Create or update a time slot for a ticket type';

GRANT EXECUTE ON FUNCTION upsert_ticket_time_slot TO authenticated;

-- Delete time slot
CREATE OR REPLACE FUNCTION delete_ticket_time_slot(_slot_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  -- Security check
  SELECT e.org_id INTO v_org_id
  FROM ticket_time_slots ts
  JOIN ticket_types tt ON tt.id = ts.ticket_type_id
  JOIN events e ON e.id = tt.event_id
  WHERE ts.id = _slot_id;

  IF v_org_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF NOT (public.has_role(v_org_id, 'admin') OR public.has_role(v_org_id, 'owner')) THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  -- Soft delete
  UPDATE ticket_time_slots SET deleted_at = NOW() WHERE id = _slot_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_ticket_time_slot TO authenticated;

-- ===========================================================================
-- 5. LIST TICKET TYPES FOR EVENT (with counts)
-- ===========================================================================

CREATE OR REPLACE FUNCTION get_event_ticket_types(
  _event_id UUID,
  _include_hidden BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_is_org_member BOOLEAN;
  v_result JSONB;
BEGIN
  -- Get org_id
  SELECT org_id INTO v_org_id FROM events WHERE id = _event_id;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('error', 'EVENT_NOT_FOUND');
  END IF;

  v_is_org_member := public.is_org_member(v_org_id);

  -- Get ticket types
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', tt.id,
      'name', tt.name,
      'description', tt.description,
      'price', tt.price,
      'currency', tt.currency,
      'vat_percentage', tt.vat_percentage,
      'capacity_total', tt.capacity_total,
      'sold', COALESCE(
        (SELECT COUNT(*)::integer FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE oi.ticket_type_id = tt.id
         AND o.status IN ('pending', 'paid')),
        0
      ),
      'available', tt.capacity_total - COALESCE(
        (SELECT COUNT(*)::integer FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE oi.ticket_type_id = tt.id
         AND o.status IN ('pending', 'paid')),
        0
      ),
      'sales_start', tt.sales_start,
      'sales_end', tt.sales_end,
      'status', tt.status,
      'visibility', tt.visibility,
      'ticket_category', tt.ticket_category,
      'distance_value', tt.distance_value,
      'distance_unit', tt.distance_unit,
      'image_url', tt.image_url,
      'has_time_slots', EXISTS (SELECT 1 FROM ticket_time_slots ts WHERE ts.ticket_type_id = tt.id AND ts.deleted_at IS NULL),
      'has_team_config', EXISTS (SELECT 1 FROM ticket_team_config tc WHERE tc.ticket_type_id = tt.id AND tc.team_required = true),
      'sort_order', tt.sort_order
    ) ORDER BY tt.sort_order, tt.name
  ), '[]'::jsonb) INTO v_result
  FROM ticket_types tt
  WHERE tt.event_id = _event_id
  AND tt.deleted_at IS NULL
  AND (
    v_is_org_member  -- Org members see all
    OR (
      tt.status = 'published'
      AND (_include_hidden = FALSE AND tt.visibility = 'visible' OR _include_hidden = TRUE)
    )
  );

  RETURN jsonb_build_object(
    'event_id', _event_id,
    'ticket_types', v_result
  );
END;
$$;

COMMENT ON FUNCTION get_event_ticket_types IS
  'Returns all ticket types for an event with availability counts';

GRANT EXECUTE ON FUNCTION get_event_ticket_types TO authenticated, anon;

-- ===========================================================================
-- END MIGRATION
-- ===========================================================================
