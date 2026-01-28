# F004 Sprint S1: Architecture

## Metadata

| Field | Value |
|-------|-------|
| **Flow** | F004 - Event Discovery |
| **Sprint** | S1 |
| **Author** | @architect |
| **Date** | 2026-01-28 |

---

## Overview

Enable public discovery of published events with search and filtering capabilities.

---

## Database Design

### View: public_events_v

Materialized view optimized for public event listing.

```sql
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
  o.slug as org_slug,
  o.name as org_name,
  es.is_public_visible,
  es.currency,
  -- Aggregated ticket info
  COALESCE(t.min_price, 0) as min_price,
  COALESCE(t.max_price, 0) as max_price,
  COALESCE(t.total_capacity, 0) as total_capacity,
  COALESCE(t.tickets_sold, 0) as tickets_sold,
  COALESCE(t.tickets_available, 0) as tickets_available
FROM public.events e
JOIN public.orgs o ON e.org_id = o.id
LEFT JOIN public.event_settings es ON e.id = es.event_id
LEFT JOIN LATERAL (
  SELECT
    MIN(tt.price) as min_price,
    MAX(tt.price) as max_price,
    SUM(tt.capacity_total) as total_capacity,
    COALESCE(SUM(sold.count), 0) as tickets_sold,
    SUM(tt.capacity_total) - COALESCE(SUM(sold.count), 0) as tickets_available
  FROM public.ticket_types tt
  LEFT JOIN LATERAL (
    SELECT COUNT(*) as count
    FROM public.ticket_instances ti
    WHERE ti.ticket_type_id = tt.id
  ) sold ON true
  WHERE tt.event_id = e.id
    AND tt.deleted_at IS NULL
) t ON true
WHERE e.status = 'published'
  AND e.deleted_at IS NULL;
```

### RPC: get_public_events

Search and filter public events.

```sql
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
  v_result jsonb;
  v_total int;
BEGIN
  -- Count total matching events
  SELECT COUNT(*) INTO v_total
  FROM public_events_v pev
  WHERE
    (_search IS NULL OR pev.name ILIKE '%' || _search || '%')
    AND (_from_date IS NULL OR pev.start_time >= _from_date)
    AND (_to_date IS NULL OR pev.start_time <= _to_date)
    AND (_org_slug IS NULL OR pev.org_slug = _org_slug);

  -- Get paginated events
  SELECT jsonb_build_object(
    'status', 'OK',
    'total', v_total,
    'events', COALESCE(jsonb_agg(event_row ORDER BY start_time ASC), '[]'::jsonb)
  ) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', pev.id,
      'slug', pev.slug,
      'name', pev.name,
      'description', pev.description,
      'location_name', pev.location_name,
      'start_time', pev.start_time,
      'end_time', pev.end_time,
      'org_slug', pev.org_slug,
      'org_name', pev.org_name,
      'currency', pev.currency,
      'min_price', pev.min_price,
      'max_price', pev.max_price,
      'tickets_available', pev.tickets_available
    ) as event_row,
    pev.start_time
    FROM public_events_v pev
    WHERE
      (_search IS NULL OR pev.name ILIKE '%' || _search || '%')
      AND (_from_date IS NULL OR pev.start_time >= _from_date)
      AND (_to_date IS NULL OR pev.start_time <= _to_date)
      AND (_org_slug IS NULL OR pev.org_slug = _org_slug)
    LIMIT _limit
    OFFSET _offset
  ) sub;

  RETURN v_result;
END;
$$;
```

### RPC: get_public_event_detail

Get full event details including ticket types.

```sql
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
BEGIN
  -- Get event
  SELECT
    e.id, e.slug, e.name, e.description, e.location_name,
    e.start_time, e.end_time, e.status,
    o.slug as org_slug, o.name as org_name,
    es.currency, es.vat_percentage, es.support_email, es.allow_waitlist
  INTO v_event
  FROM public.events e
  JOIN public.orgs o ON e.org_id = o.id
  LEFT JOIN public.event_settings es ON e.id = es.event_id
  WHERE e.slug = _event_slug
    AND e.status = 'published'
    AND e.deleted_at IS NULL
    AND (_org_slug IS NULL OR o.slug = _org_slug);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'EVENT_NOT_FOUND');
  END IF;

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
      'available', tt.capacity_total - COALESCE(sold.count, 0),
      'sales_start', tt.sales_start,
      'sales_end', tt.sales_end,
      'on_sale', (
        (tt.sales_start IS NULL OR tt.sales_start <= now())
        AND (tt.sales_end IS NULL OR tt.sales_end > now())
      )
    ) ORDER BY tt.price ASC
  ), '[]'::jsonb) INTO v_ticket_types
  FROM public.ticket_types tt
  LEFT JOIN LATERAL (
    SELECT COUNT(*) as count
    FROM public.ticket_instances ti
    WHERE ti.ticket_type_id = tt.id
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
      'currency', v_event.currency,
      'vat_percentage', v_event.vat_percentage,
      'support_email', v_event.support_email,
      'allow_waitlist', v_event.allow_waitlist
    ),
    'ticket_types', v_ticket_types
  );
END;
$$;
```

---

## Frontend Design

### Public Events Page (`/events`)

```typescript
// Route: /events
// Query params: ?search=&from=&to=&org=

interface EventListItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  location_name: string;
  start_time: string;
  end_time: string;
  org_slug: string;
  org_name: string;
  currency: string;
  min_price: number;
  max_price: number;
  tickets_available: number;
}

// Fetch: supabase.rpc('get_public_events', { _search, _from_date, ... })
```

### Public Event Detail Page (`/events/:slug`)

```typescript
// Route: /events/:slug
// Links to checkout: /e/:slug

interface EventDetail {
  id: string;
  slug: string;
  name: string;
  description: string;
  // ... full event data
  ticket_types: TicketType[];
}

// Fetch: supabase.rpc('get_public_event_detail', { _event_slug: slug })
```

---

## Routing

Add to `App.tsx`:
```typescript
<Route path="/events" element={<PublicEvents />} />
<Route path="/events/:slug" element={<PublicEventDetail />} />
```

---

## File Structure

```
web/src/pages/public/
├── PublicEvents.tsx         # NEW - Event listing
├── PublicEventDetail.tsx    # NEW - Event detail
├── PublicEventCheckout.tsx  # EXISTS - Checkout flow
└── PublicConfirm.tsx        # EXISTS - Confirmation

supabase/migrations/
└── 20250128150000_f004_event_discovery.sql  # NEW
```

---

## Security

- View and RPCs use SECURITY DEFINER with explicit search_path
- Only published events are accessible
- No user data exposed in public views
- Grants: anonymous and authenticated

---

*Architecture - F004 Event Discovery - 2026-01-28*
