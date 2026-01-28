-- F005 S2: Ticket Availability & Order Validation RPCs
--
-- Provides real-time availability tracking and pre-checkout validation.

-- ============================================================================
-- RPC: get_ticket_availability
-- ============================================================================
-- Returns all visible ticket types for an event with sold/available counts.

CREATE OR REPLACE FUNCTION public.get_ticket_availability(_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Check event exists
  IF NOT EXISTS (
    SELECT 1 FROM events
    WHERE id = _event_id
      AND status = 'published'
      AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('error', 'EVENT_NOT_FOUND');
  END IF;

  SELECT jsonb_build_object(
    'status', 'OK',
    'event_id', _event_id,
    'ticket_types', COALESCE(jsonb_agg(ticket_row ORDER BY sort_order NULLS LAST, price), '[]'::jsonb)
  ) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', tt.id,
      'name', tt.name,
      'description', tt.description,
      'price', tt.price,
      'currency', COALESCE(tt.currency, 'EUR'),
      'vat_percentage', tt.vat_percentage,
      'capacity_total', tt.capacity_total,
      'sold_count', COALESCE(sold.count, 0),
      'available_count', GREATEST(tt.capacity_total - COALESCE(sold.count, 0), 0),
      'is_sold_out', tt.capacity_total <= COALESCE(sold.count, 0),
      'distance_value', tt.distance_value,
      'distance_unit', tt.distance_unit,
      'ticket_category', tt.ticket_category,
      'max_per_participant', tt.max_per_participant,
      'image_url', tt.image_url,
      'sales_start', tt.sales_start,
      'sales_end', tt.sales_end,
      'on_sale', (
        (tt.sales_start IS NULL OR tt.sales_start <= now())
        AND (tt.sales_end IS NULL OR tt.sales_end > now())
      ),
      'sort_order', tt.sort_order,
      'time_slots', COALESCE(slots.slots, '[]'::jsonb)
    ) as ticket_row,
    tt.sort_order,
    tt.price
    FROM ticket_types tt
    LEFT JOIN LATERAL (
      SELECT COUNT(*) as count
      FROM ticket_instances ti
      WHERE ti.ticket_type_id = tt.id
        AND ti.status != 'void'
    ) sold ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', ts.id,
          'slot_time', ts.slot_time,
          'slot_date', ts.slot_date,
          'label', ts.label,
          'capacity', ts.capacity,
          'sort_order', ts.sort_order
        ) ORDER BY ts.sort_order NULLS LAST, ts.slot_date NULLS FIRST, ts.slot_time
      ) as slots
      FROM ticket_time_slots ts
      WHERE ts.ticket_type_id = tt.id
        AND ts.deleted_at IS NULL
    ) slots ON true
    WHERE tt.event_id = _event_id
      AND tt.deleted_at IS NULL
      AND tt.status = 'published'
      AND tt.visibility = 'visible'
  ) sub;

  IF v_result IS NULL THEN
    v_result := jsonb_build_object('status', 'OK', 'event_id', _event_id, 'ticket_types', '[]'::jsonb);
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_ticket_availability(uuid) IS
  'Returns all visible ticket types for an event with real-time availability counts.';

GRANT EXECUTE ON FUNCTION public.get_ticket_availability(uuid) TO anon, authenticated;

-- ============================================================================
-- RPC: validate_ticket_order
-- ============================================================================
-- Pre-validates an order before checkout submission.

CREATE OR REPLACE FUNCTION public.validate_ticket_order(
  _event_id uuid,
  _items jsonb  -- [{ticket_type_id: uuid, quantity: int}]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item record;
  v_ticket record;
  v_errors jsonb := '[]'::jsonb;
  v_sold int;
  v_available int;
BEGIN
  -- Validate input
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RETURN jsonb_build_object('valid', false, 'errors', jsonb_build_array(
      jsonb_build_object('error', 'NO_ITEMS')
    ));
  END IF;

  -- Check event exists and is published
  IF NOT EXISTS (
    SELECT 1 FROM events
    WHERE id = _event_id
      AND status = 'published'
      AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('valid', false, 'errors', jsonb_build_array(
      jsonb_build_object('error', 'EVENT_NOT_FOUND')
    ));
  END IF;

  -- Validate each item
  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(ticket_type_id uuid, quantity int)
  LOOP
    -- Skip zero quantity items
    IF v_item.quantity <= 0 THEN
      CONTINUE;
    END IF;

    -- Get ticket type
    SELECT * INTO v_ticket
    FROM ticket_types
    WHERE id = v_item.ticket_type_id
      AND event_id = _event_id
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
      v_errors := v_errors || jsonb_build_object(
        'ticket_type_id', v_item.ticket_type_id,
        'error', 'TICKET_TYPE_NOT_FOUND'
      );
      CONTINUE;
    END IF;

    -- Check status
    IF v_ticket.status != 'published' THEN
      v_errors := v_errors || jsonb_build_object(
        'ticket_type_id', v_item.ticket_type_id,
        'error', 'TICKET_NOT_PUBLISHED'
      );
      CONTINUE;
    END IF;

    -- Check visibility
    IF v_ticket.visibility != 'visible' THEN
      v_errors := v_errors || jsonb_build_object(
        'ticket_type_id', v_item.ticket_type_id,
        'error', 'TICKET_NOT_VISIBLE'
      );
      CONTINUE;
    END IF;

    -- Check sales window
    IF v_ticket.sales_start IS NOT NULL AND v_ticket.sales_start > now() THEN
      v_errors := v_errors || jsonb_build_object(
        'ticket_type_id', v_item.ticket_type_id,
        'error', 'SALES_NOT_STARTED',
        'sales_start', v_ticket.sales_start
      );
      CONTINUE;
    END IF;

    IF v_ticket.sales_end IS NOT NULL AND v_ticket.sales_end < now() THEN
      v_errors := v_errors || jsonb_build_object(
        'ticket_type_id', v_item.ticket_type_id,
        'error', 'SALES_ENDED',
        'sales_end', v_ticket.sales_end
      );
      CONTINUE;
    END IF;

    -- Get sold count
    SELECT COUNT(*) INTO v_sold
    FROM ticket_instances ti
    WHERE ti.ticket_type_id = v_item.ticket_type_id
      AND ti.status != 'void';

    v_available := v_ticket.capacity_total - v_sold;

    -- Check capacity
    IF v_item.quantity > v_available THEN
      v_errors := v_errors || jsonb_build_object(
        'ticket_type_id', v_item.ticket_type_id,
        'ticket_name', v_ticket.name,
        'error', 'INSUFFICIENT_CAPACITY',
        'requested', v_item.quantity,
        'available', v_available
      );
      CONTINUE;
    END IF;

    -- Check max per participant
    IF v_ticket.max_per_participant IS NOT NULL AND v_item.quantity > v_ticket.max_per_participant THEN
      v_errors := v_errors || jsonb_build_object(
        'ticket_type_id', v_item.ticket_type_id,
        'ticket_name', v_ticket.name,
        'error', 'EXCEEDS_MAX_PER_PARTICIPANT',
        'requested', v_item.quantity,
        'max_allowed', v_ticket.max_per_participant
      );
      CONTINUE;
    END IF;
  END LOOP;

  IF jsonb_array_length(v_errors) > 0 THEN
    RETURN jsonb_build_object('valid', false, 'errors', v_errors);
  END IF;

  RETURN jsonb_build_object('valid', true, 'errors', '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.validate_ticket_order(uuid, jsonb) IS
  'Pre-validates an order against availability and limits before checkout.';

GRANT EXECUTE ON FUNCTION public.validate_ticket_order(uuid, jsonb) TO anon, authenticated;

-- ============================================================================
-- RPC: get_ticket_type_with_availability
-- ============================================================================
-- Returns a single ticket type with full details and availability.

CREATE OR REPLACE FUNCTION public.get_ticket_type_with_availability(_ticket_type_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket record;
  v_sold int;
  v_slots jsonb;
BEGIN
  -- Get ticket type
  SELECT
    tt.*,
    e.status as event_status
  INTO v_ticket
  FROM ticket_types tt
  JOIN events e ON tt.event_id = e.id
  WHERE tt.id = _ticket_type_id
    AND tt.deleted_at IS NULL
    AND e.deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'TICKET_TYPE_NOT_FOUND');
  END IF;

  -- Check visibility for public access
  IF v_ticket.event_status != 'published' OR v_ticket.visibility != 'visible' THEN
    RETURN jsonb_build_object('error', 'TICKET_NOT_AVAILABLE');
  END IF;

  -- Get sold count
  SELECT COUNT(*) INTO v_sold
  FROM ticket_instances ti
  WHERE ti.ticket_type_id = _ticket_type_id
    AND ti.status != 'void';

  -- Get time slots
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', ts.id,
      'slot_time', ts.slot_time,
      'slot_date', ts.slot_date,
      'label', ts.label,
      'capacity', ts.capacity,
      'sort_order', ts.sort_order
    ) ORDER BY ts.sort_order NULLS LAST, ts.slot_date NULLS FIRST, ts.slot_time
  ), '[]'::jsonb) INTO v_slots
  FROM ticket_time_slots ts
  WHERE ts.ticket_type_id = _ticket_type_id
    AND ts.deleted_at IS NULL;

  RETURN jsonb_build_object(
    'status', 'OK',
    'ticket_type', jsonb_build_object(
      'id', v_ticket.id,
      'event_id', v_ticket.event_id,
      'name', v_ticket.name,
      'description', v_ticket.description,
      'price', v_ticket.price,
      'currency', COALESCE(v_ticket.currency, 'EUR'),
      'vat_percentage', v_ticket.vat_percentage,
      'capacity_total', v_ticket.capacity_total,
      'sold_count', v_sold,
      'available_count', GREATEST(v_ticket.capacity_total - v_sold, 0),
      'is_sold_out', v_ticket.capacity_total <= v_sold,
      'distance_value', v_ticket.distance_value,
      'distance_unit', v_ticket.distance_unit,
      'ticket_category', v_ticket.ticket_category,
      'max_per_participant', v_ticket.max_per_participant,
      'image_url', v_ticket.image_url,
      'instructions', v_ticket.instructions,
      'sales_start', v_ticket.sales_start,
      'sales_end', v_ticket.sales_end,
      'on_sale', (
        (v_ticket.sales_start IS NULL OR v_ticket.sales_start <= now())
        AND (v_ticket.sales_end IS NULL OR v_ticket.sales_end > now())
      ),
      'time_slots', v_slots
    )
  );
END;
$$;

COMMENT ON FUNCTION public.get_ticket_type_with_availability(uuid) IS
  'Returns a single ticket type with full details and availability counts.';

GRANT EXECUTE ON FUNCTION public.get_ticket_type_with_availability(uuid) TO anon, authenticated;
