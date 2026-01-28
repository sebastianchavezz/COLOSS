-- F004: Event Discovery
--
-- Enable public browsing of published events with search/filter capabilities.
-- Creates view and RPCs for efficient event listing and detail retrieval.
--
-- Note: event_settings uses domain/JSONB pattern (see settings_mvp migration)

-- ============================================================================
-- VIEW: public_events_v
-- ============================================================================
-- Optimized view for public event listing with ticket info aggregated.
-- Joins to event_settings via domain='payments' for currency.

CREATE OR REPLACE VIEW public.public_events_v AS
SELECT
  e.id,
  e.slug,
  e.name,
  e.description,
  e.location_name,
  e.start_time,
  e.end_time,
  e.status,
  e.created_at,
  o.id as org_id,
  o.slug as org_slug,
  o.name as org_name,
  -- Get currency from payments settings (JSONB)
  COALESCE(
    (es_pay.setting_value->>'currency'),
    'EUR'
  ) as currency,
  -- Aggregated ticket info
  COALESCE(t.min_price, 0) as min_price,
  COALESCE(t.max_price, 0) as max_price,
  COALESCE(t.total_capacity, 0) as total_capacity,
  COALESCE(t.tickets_sold, 0) as tickets_sold,
  GREATEST(COALESCE(t.total_capacity, 0) - COALESCE(t.tickets_sold, 0), 0) as tickets_available,
  COALESCE(t.ticket_type_count, 0) as ticket_type_count
FROM public.events e
JOIN public.orgs o ON e.org_id = o.id
LEFT JOIN public.event_settings es_pay ON e.id = es_pay.event_id AND es_pay.domain = 'payments'
LEFT JOIN LATERAL (
  SELECT
    MIN(tt.price) as min_price,
    MAX(tt.price) as max_price,
    SUM(tt.capacity_total) as total_capacity,
    COUNT(tt.id) as ticket_type_count,
    COALESCE((
      SELECT COUNT(*)
      FROM public.ticket_instances ti
      WHERE ti.ticket_type_id = ANY(ARRAY_AGG(tt.id))
        AND ti.status != 'void'
    ), 0) as tickets_sold
  FROM public.ticket_types tt
  WHERE tt.event_id = e.id
    AND tt.deleted_at IS NULL
) t ON true
WHERE e.status = 'published'
  AND e.deleted_at IS NULL;

COMMENT ON VIEW public.public_events_v IS
  'Public view of published events with aggregated ticket information for listing pages.';

-- ============================================================================
-- RPC: get_public_events
-- ============================================================================
-- Search and filter public events with pagination.

CREATE OR REPLACE FUNCTION public.get_public_events(
  _search text DEFAULT NULL,
  _from_date timestamptz DEFAULT NULL,
  _to_date timestamptz DEFAULT NULL,
  _org_slug text DEFAULT NULL,
  _limit int DEFAULT 20,
  _offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int;
  v_events jsonb;
BEGIN
  -- Validate pagination
  IF _limit < 1 OR _limit > 100 THEN
    _limit := 20;
  END IF;
  IF _offset < 0 THEN
    _offset := 0;
  END IF;

  -- Count total matching events
  SELECT COUNT(*) INTO v_total
  FROM public_events_v pev
  WHERE
    (_search IS NULL OR pev.name ILIKE '%' || _search || '%' OR pev.location_name ILIKE '%' || _search || '%')
    AND (_from_date IS NULL OR pev.start_time >= _from_date)
    AND (_to_date IS NULL OR pev.start_time <= _to_date)
    AND (_org_slug IS NULL OR pev.org_slug = _org_slug);

  -- Get paginated events
  SELECT COALESCE(jsonb_agg(event_row), '[]'::jsonb) INTO v_events
  FROM (
    SELECT jsonb_build_object(
      'id', pev.id,
      'slug', pev.slug,
      'name', pev.name,
      'description', LEFT(pev.description, 200),
      'location_name', pev.location_name,
      'start_time', pev.start_time,
      'end_time', pev.end_time,
      'org_slug', pev.org_slug,
      'org_name', pev.org_name,
      'currency', pev.currency,
      'min_price', pev.min_price,
      'max_price', pev.max_price,
      'tickets_available', pev.tickets_available,
      'ticket_type_count', pev.ticket_type_count
    ) as event_row
    FROM public_events_v pev
    WHERE
      (_search IS NULL OR pev.name ILIKE '%' || _search || '%' OR pev.location_name ILIKE '%' || _search || '%')
      AND (_from_date IS NULL OR pev.start_time >= _from_date)
      AND (_to_date IS NULL OR pev.start_time <= _to_date)
      AND (_org_slug IS NULL OR pev.org_slug = _org_slug)
    ORDER BY pev.start_time ASC
    LIMIT _limit
    OFFSET _offset
  ) sub;

  RETURN jsonb_build_object(
    'status', 'OK',
    'total', v_total,
    'limit', _limit,
    'offset', _offset,
    'events', v_events
  );
END;
$$;

COMMENT ON FUNCTION public.get_public_events(text, timestamptz, timestamptz, text, int, int) IS
  'Search and filter public events with pagination. Returns list of published events.';

-- Grant to public (anonymous + authenticated)
GRANT EXECUTE ON FUNCTION public.get_public_events(text, timestamptz, timestamptz, text, int, int) TO anon, authenticated;

-- ============================================================================
-- RPC: get_public_event_detail
-- ============================================================================
-- Get full event details including ticket types.

CREATE OR REPLACE FUNCTION public.get_public_event_detail(
  _event_slug text,
  _org_slug text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event record;
  v_ticket_types jsonb;
  v_currency text;
  v_vat_percentage numeric;
  v_support_email text;
BEGIN
  -- Get event
  SELECT
    e.id, e.slug, e.name, e.description, e.location_name,
    e.start_time, e.end_time, e.status, e.created_at,
    o.id as org_id, o.slug as org_slug, o.name as org_name
  INTO v_event
  FROM public.events e
  JOIN public.orgs o ON e.org_id = o.id
  WHERE e.slug = _event_slug
    AND e.status = 'published'
    AND e.deleted_at IS NULL
    AND (_org_slug IS NULL OR o.slug = _org_slug);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'EVENT_NOT_FOUND');
  END IF;

  -- Get settings from JSONB domains
  SELECT
    COALESCE(es_pay.setting_value->>'currency', 'EUR'),
    COALESCE((es_pay.setting_value->>'vat_percentage')::numeric, 21.00),
    es_comm.setting_value->>'support_email'
  INTO v_currency, v_vat_percentage, v_support_email
  FROM (SELECT 1) dummy
  LEFT JOIN public.event_settings es_pay ON es_pay.event_id = v_event.id AND es_pay.domain = 'payments'
  LEFT JOIN public.event_settings es_comm ON es_comm.event_id = v_event.id AND es_comm.domain = 'communication';

  -- Get ticket types with availability
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', tt.id,
      'name', tt.name,
      'description', tt.description,
      'price', tt.price,
      'vat_percentage', tt.vat_percentage,
      'capacity_total', tt.capacity_total,
      'sold', COALESCE(sold.count, 0),
      'available', GREATEST(tt.capacity_total - COALESCE(sold.count, 0), 0),
      'sales_start', tt.sales_start,
      'sales_end', tt.sales_end,
      'on_sale', (
        (tt.sales_start IS NULL OR tt.sales_start <= now())
        AND (tt.sales_end IS NULL OR tt.sales_end > now())
        AND tt.capacity_total > COALESCE(sold.count, 0)
      )
    ) ORDER BY tt.price ASC
  ), '[]'::jsonb) INTO v_ticket_types
  FROM public.ticket_types tt
  LEFT JOIN LATERAL (
    SELECT COUNT(*) as count
    FROM public.ticket_instances ti
    WHERE ti.ticket_type_id = tt.id
      AND ti.status != 'void'
  ) sold ON true
  WHERE tt.event_id = v_event.id
    AND tt.deleted_at IS NULL;

  RETURN jsonb_build_object(
    'status', 'OK',
    'event', jsonb_build_object(
      'id', v_event.id,
      'slug', v_event.slug,
      'name', v_event.name,
      'description', v_event.description,
      'location_name', v_event.location_name,
      'start_time', v_event.start_time,
      'end_time', v_event.end_time,
      'org_slug', v_event.org_slug,
      'org_name', v_event.org_name,
      'currency', v_currency,
      'vat_percentage', v_vat_percentage,
      'support_email', v_support_email
    ),
    'ticket_types', v_ticket_types
  );
END;
$$;

COMMENT ON FUNCTION public.get_public_event_detail(text, text) IS
  'Get full details of a published event including ticket types and availability.';

-- Grant to public (anonymous + authenticated)
GRANT EXECUTE ON FUNCTION public.get_public_event_detail(text, text) TO anon, authenticated;
