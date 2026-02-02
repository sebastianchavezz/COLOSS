# Sprint S1: Architecture - Dashboard Data Layer

**Flow**: F010 Organizer Dashboard
**Sprint**: S1
**Role**: Architect

## Design Decisions (ADRs)

### ADR-1: Single RPC vs Multiple Endpoints
**Decision**: Single RPC `get_org_dashboard_stats` returns all overview data
**Rationale**:
- Reduces N+1 queries from frontend
- Atomic data snapshot (consistent state)
- Easier to cache/memoize
**Trade-off**: Larger payload, but dashboard needs all data anyway

### ADR-2: SECURITY DEFINER vs INVOKER
**Decision**: Use SECURITY DEFINER with explicit auth.uid() check
**Rationale**:
- Can aggregate across tables without client needing direct access
- RLS on underlying tables still applies for direct queries
- Must check org membership at start of function

### ADR-3: Materialized vs Computed Stats
**Decision**: Computed on-demand (no materialized views)
**Rationale**:
- Data freshness is critical for dashboard
- Expected data volumes (< 10K tickets per event) are small enough
- Can add materialized views later if performance degrades

### ADR-4: Activity Feed Source
**Decision**: Use `audit_log` table as single source
**Rationale**:
- Already tracks all significant actions
- Consistent format
- No need for separate activity table

## Database Schema

### Migration: `20260202000001_f010_dashboard_stats.sql`

```sql
-- F010: ORGANIZER DASHBOARD - DATA LAYER
-- Sprint S1: Stats RPCs and Supporting Views

-- ============================================
-- 1. HELPER VIEWS (with security_invoker)
-- ============================================

-- Event ticket statistics (aggregated from ticket_instances)
CREATE OR REPLACE VIEW public.v_event_ticket_stats AS
SELECT
    e.id AS event_id,
    e.org_id,
    e.name AS event_name,
    e.slug AS event_slug,
    e.status AS event_status,
    e.start_time,
    e.end_time,
    COUNT(ti.id) FILTER (WHERE ti.status = 'issued') AS tickets_issued,
    COUNT(ti.id) FILTER (WHERE ti.status = 'checked_in') AS tickets_checked_in,
    COUNT(ti.id) FILTER (WHERE ti.status = 'void') AS tickets_void,
    COALESCE(SUM(tt.capacity_total), 0) AS total_capacity,
    COALESCE(SUM(tt.capacity_total), 0) - COUNT(ti.id) FILTER (WHERE ti.status IN ('issued', 'checked_in')) AS tickets_available
FROM public.events e
LEFT JOIN public.ticket_types tt ON tt.event_id = e.id AND tt.deleted_at IS NULL
LEFT JOIN public.ticket_instances ti ON ti.ticket_type_id = tt.id
WHERE e.deleted_at IS NULL
GROUP BY e.id, e.org_id, e.name, e.slug, e.status, e.start_time, e.end_time;

ALTER VIEW public.v_event_ticket_stats SET (security_invoker = true);

COMMENT ON VIEW public.v_event_ticket_stats IS
    'Aggregated ticket statistics per event for dashboard';


-- Ticket type breakdown per event
CREATE OR REPLACE VIEW public.v_ticket_type_stats AS
SELECT
    tt.id AS ticket_type_id,
    tt.event_id,
    tt.name AS ticket_type_name,
    tt.price,
    tt.capacity_total,
    COUNT(ti.id) FILTER (WHERE ti.status = 'issued') AS sold,
    COUNT(ti.id) FILTER (WHERE ti.status = 'checked_in') AS checked_in,
    tt.capacity_total - COUNT(ti.id) FILTER (WHERE ti.status IN ('issued', 'checked_in')) AS available,
    tt.sales_start,
    tt.sales_end
FROM public.ticket_types tt
LEFT JOIN public.ticket_instances ti ON ti.ticket_type_id = tt.id
WHERE tt.deleted_at IS NULL
GROUP BY tt.id, tt.event_id, tt.name, tt.price, tt.capacity_total, tt.sales_start, tt.sales_end;

ALTER VIEW public.v_ticket_type_stats SET (security_invoker = true);

COMMENT ON VIEW public.v_ticket_type_stats IS
    'Ticket type breakdown with sold/available counts';


-- Check-in statistics per event
CREATE OR REPLACE VIEW public.v_event_checkin_stats AS
SELECT
    tc.event_id,
    COUNT(*) AS total_checkins,
    COUNT(*) FILTER (WHERE tc.checked_in_at::date = CURRENT_DATE) AS today_checkins,
    MAX(tc.checked_in_at) AS last_checkin_at
FROM public.ticket_checkins tc
WHERE tc.deleted_at IS NULL
GROUP BY tc.event_id;

ALTER VIEW public.v_event_checkin_stats SET (security_invoker = true);

COMMENT ON VIEW public.v_event_checkin_stats IS
    'Check-in statistics per event';


-- ============================================
-- 2. MAIN DASHBOARD RPC: ORG OVERVIEW
-- ============================================

CREATE OR REPLACE FUNCTION public.get_org_dashboard_stats(_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _result jsonb;
    _org_row record;
    _events_summary jsonb;
    _events_list jsonb;
    _recent_activity jsonb;
    _tickets_summary jsonb;
BEGIN
    -- Security check: must be org member
    IF NOT public.is_org_member(_org_id) THEN
        RETURN jsonb_build_object(
            'error', 'NOT_AUTHORIZED',
            'message', 'User is not a member of this organization'
        );
    END IF;

    -- Get org info
    SELECT id, name, slug, created_at
    INTO _org_row
    FROM public.orgs
    WHERE id = _org_id;

    IF _org_row IS NULL THEN
        RETURN jsonb_build_object(
            'error', 'NOT_FOUND',
            'message', 'Organization not found'
        );
    END IF;

    -- Events summary
    SELECT jsonb_build_object(
        'total', COUNT(*),
        'draft', COUNT(*) FILTER (WHERE status = 'draft'),
        'published', COUNT(*) FILTER (WHERE status = 'published'),
        'closed', COUNT(*) FILTER (WHERE status = 'closed'),
        'upcoming', COUNT(*) FILTER (WHERE status = 'published' AND start_time > now())
    )
    INTO _events_summary
    FROM public.events
    WHERE org_id = _org_id AND deleted_at IS NULL;

    -- Tickets summary (across all events)
    SELECT jsonb_build_object(
        'issued', COALESCE(SUM(tickets_issued), 0),
        'checked_in', COALESCE(SUM(tickets_checked_in), 0),
        'available', COALESCE(SUM(tickets_available), 0),
        'total_capacity', COALESCE(SUM(total_capacity), 0)
    )
    INTO _tickets_summary
    FROM public.v_event_ticket_stats
    WHERE org_id = _org_id;

    -- Events list with stats (max 20, ordered by start_time desc)
    SELECT COALESCE(jsonb_agg(event_data ORDER BY start_time DESC), '[]'::jsonb)
    INTO _events_list
    FROM (
        SELECT
            jsonb_build_object(
                'id', ets.event_id,
                'name', ets.event_name,
                'slug', ets.event_slug,
                'status', ets.event_status,
                'start_time', ets.start_time,
                'end_time', ets.end_time,
                'tickets', jsonb_build_object(
                    'issued', ets.tickets_issued,
                    'checked_in', ets.tickets_checked_in,
                    'available', ets.tickets_available,
                    'capacity', ets.total_capacity
                ),
                'checkin_percentage', CASE
                    WHEN ets.tickets_issued > 0
                    THEN ROUND((ets.tickets_checked_in::numeric / ets.tickets_issued) * 100, 1)
                    ELSE 0
                END,
                'days_until', CASE
                    WHEN ets.start_time > now()
                    THEN EXTRACT(DAY FROM ets.start_time - now())::int
                    ELSE NULL
                END
            ) AS event_data,
            ets.start_time
        FROM public.v_event_ticket_stats ets
        WHERE ets.org_id = _org_id
        LIMIT 20
    ) sub;

    -- Recent activity from audit_log (last 10)
    SELECT COALESCE(jsonb_agg(activity ORDER BY created_at DESC), '[]'::jsonb)
    INTO _recent_activity
    FROM (
        SELECT
            jsonb_build_object(
                'id', al.id,
                'action', al.action,
                'entity_type', al.entity_type,
                'entity_id', al.entity_id,
                'created_at', al.created_at,
                'event_name', e.name,
                'metadata', al.metadata
            ) AS activity,
            al.created_at
        FROM public.audit_log al
        LEFT JOIN public.events e ON al.event_id = e.id
        WHERE al.org_id = _org_id
        ORDER BY al.created_at DESC
        LIMIT 10
    ) sub;

    -- Build final result
    _result := jsonb_build_object(
        'org', jsonb_build_object(
            'id', _org_row.id,
            'name', _org_row.name,
            'slug', _org_row.slug,
            'created_at', _org_row.created_at
        ),
        'summary', jsonb_build_object(
            'events', _events_summary,
            'tickets', _tickets_summary
        ),
        'events', _events_list,
        'recent_activity', _recent_activity,
        'generated_at', now()
    );

    RETURN _result;
END;
$$;

COMMENT ON FUNCTION public.get_org_dashboard_stats IS
    'Returns complete dashboard statistics for an organization. Requires org membership.';


-- ============================================
-- 3. EVENT DETAIL STATS RPC
-- ============================================

CREATE OR REPLACE FUNCTION public.get_event_dashboard_stats(_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _result jsonb;
    _event_row record;
    _org_id uuid;
    _ticket_types jsonb;
    _checkin_stats jsonb;
    _hourly_checkins jsonb;
    _recent_orders jsonb;
    _recent_checkins jsonb;
BEGIN
    -- Get event and org_id
    SELECT e.*, o.name AS org_name
    INTO _event_row
    FROM public.events e
    JOIN public.orgs o ON o.id = e.org_id
    WHERE e.id = _event_id AND e.deleted_at IS NULL;

    IF _event_row IS NULL THEN
        RETURN jsonb_build_object(
            'error', 'NOT_FOUND',
            'message', 'Event not found'
        );
    END IF;

    _org_id := _event_row.org_id;

    -- Security check: must be org member
    IF NOT public.is_org_member(_org_id) THEN
        RETURN jsonb_build_object(
            'error', 'NOT_AUTHORIZED',
            'message', 'User is not a member of this organization'
        );
    END IF;

    -- Ticket types with stats
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', ticket_type_id,
            'name', ticket_type_name,
            'price', price,
            'capacity', capacity_total,
            'sold', sold,
            'checked_in', checked_in,
            'available', available,
            'sales_start', sales_start,
            'sales_end', sales_end
        ) ORDER BY ticket_type_name
    ), '[]'::jsonb)
    INTO _ticket_types
    FROM public.v_ticket_type_stats
    WHERE event_id = _event_id;

    -- Check-in stats
    SELECT jsonb_build_object(
        'total', COALESCE(total_checkins, 0),
        'today', COALESCE(today_checkins, 0),
        'last_checkin_at', last_checkin_at
    )
    INTO _checkin_stats
    FROM public.v_event_checkin_stats
    WHERE event_id = _event_id;

    -- Default if no checkins
    IF _checkin_stats IS NULL THEN
        _checkin_stats := jsonb_build_object(
            'total', 0,
            'today', 0,
            'last_checkin_at', NULL
        );
    END IF;

    -- Hourly check-in distribution (last 24 hours)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'hour', hour_bucket,
            'count', checkin_count
        ) ORDER BY hour_bucket
    ), '[]'::jsonb)
    INTO _hourly_checkins
    FROM (
        SELECT
            date_trunc('hour', tc.checked_in_at) AS hour_bucket,
            COUNT(*) AS checkin_count
        FROM public.ticket_checkins tc
        WHERE tc.event_id = _event_id
          AND tc.checked_in_at > now() - interval '24 hours'
          AND tc.deleted_at IS NULL
        GROUP BY date_trunc('hour', tc.checked_in_at)
    ) sub;

    -- Recent orders (last 10)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', id,
            'email', email,
            'total_amount', total_amount,
            'currency', currency,
            'status', status,
            'created_at', created_at
        ) ORDER BY created_at DESC
    ), '[]'::jsonb)
    INTO _recent_orders
    FROM (
        SELECT id, email, total_amount, currency, status, created_at
        FROM public.orders
        WHERE event_id = _event_id
        ORDER BY created_at DESC
        LIMIT 10
    ) sub;

    -- Recent check-ins (last 10)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'ticket_id', tc.ticket_instance_id,
            'checked_in_at', tc.checked_in_at,
            'ticket_type_name', tt.name,
            'source', tc.source
        ) ORDER BY tc.checked_in_at DESC
    ), '[]'::jsonb)
    INTO _recent_checkins
    FROM (
        SELECT tc.*, ti.ticket_type_id
        FROM public.ticket_checkins tc
        JOIN public.ticket_instances ti ON ti.id = tc.ticket_instance_id
        WHERE tc.event_id = _event_id AND tc.deleted_at IS NULL
        ORDER BY tc.checked_in_at DESC
        LIMIT 10
    ) tc
    JOIN public.ticket_types tt ON tt.id = tc.ticket_type_id;

    -- Build final result
    _result := jsonb_build_object(
        'event', jsonb_build_object(
            'id', _event_row.id,
            'name', _event_row.name,
            'slug', _event_row.slug,
            'status', _event_row.status,
            'start_time', _event_row.start_time,
            'end_time', _event_row.end_time,
            'location_name', _event_row.location_name,
            'org_name', _event_row.org_name
        ),
        'ticket_types', _ticket_types,
        'checkins', _checkin_stats || jsonb_build_object('hourly', _hourly_checkins),
        'recent_orders', _recent_orders,
        'recent_checkins', _recent_checkins,
        'generated_at', now()
    );

    RETURN _result;
END;
$$;

COMMENT ON FUNCTION public.get_event_dashboard_stats IS
    'Returns detailed dashboard statistics for a specific event. Requires org membership.';


-- ============================================
-- 4. INDEXES FOR PERFORMANCE
-- ============================================

-- Composite index for event queries with org filter
CREATE INDEX IF NOT EXISTS idx_events_org_status
ON public.events(org_id, status)
WHERE deleted_at IS NULL;

-- Composite index for ticket instances per event
CREATE INDEX IF NOT EXISTS idx_ticket_instances_event_status
ON public.ticket_instances(event_id, status);

-- Index for audit log by org
CREATE INDEX IF NOT EXISTS idx_audit_log_org_created
ON public.audit_log(org_id, created_at DESC);

-- Index for orders by event and date
CREATE INDEX IF NOT EXISTS idx_orders_event_created
ON public.orders(event_id, created_at DESC);
```

## Interface Definitions

### TypeScript Types (Frontend)

```typescript
// types/dashboard.ts

export interface OrgDashboardStats {
  org: {
    id: string;
    name: string;
    slug: string;
    created_at: string;
  };
  summary: {
    events: {
      total: number;
      draft: number;
      published: number;
      closed: number;
      upcoming: number;
    };
    tickets: {
      issued: number;
      checked_in: number;
      available: number;
      total_capacity: number;
    };
  };
  events: EventSummary[];
  recent_activity: ActivityItem[];
  generated_at: string;
}

export interface EventSummary {
  id: string;
  name: string;
  slug: string;
  status: 'draft' | 'published' | 'closed';
  start_time: string;
  end_time: string | null;
  tickets: {
    issued: number;
    checked_in: number;
    available: number;
    capacity: number;
  };
  checkin_percentage: number;
  days_until: number | null;
}

export interface ActivityItem {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
  event_name: string | null;
  metadata: Record<string, unknown>;
}

export interface EventDashboardStats {
  event: {
    id: string;
    name: string;
    slug: string;
    status: 'draft' | 'published' | 'closed';
    start_time: string;
    end_time: string | null;
    location_name: string | null;
    org_name: string;
  };
  ticket_types: TicketTypeStats[];
  checkins: {
    total: number;
    today: number;
    last_checkin_at: string | null;
    hourly: HourlyCheckin[];
  };
  recent_orders: RecentOrder[];
  recent_checkins: RecentCheckin[];
  generated_at: string;
}

export interface TicketTypeStats {
  id: string;
  name: string;
  price: number;
  capacity: number;
  sold: number;
  checked_in: number;
  available: number;
  sales_start: string | null;
  sales_end: string | null;
}

export interface HourlyCheckin {
  hour: string;
  count: number;
}

export interface RecentOrder {
  id: string;
  email: string;
  total_amount: number;
  currency: string;
  status: string;
  created_at: string;
}

export interface RecentCheckin {
  ticket_id: string;
  checked_in_at: string;
  ticket_type_name: string;
  source: string;
}
```

### API Usage Examples

```typescript
// Fetch org dashboard
const { data, error } = await supabase
  .rpc('get_org_dashboard_stats', { _org_id: orgId });

if (error || data?.error) {
  // Handle error
}

const stats: OrgDashboardStats = data;

// Fetch event dashboard
const { data: eventData } = await supabase
  .rpc('get_event_dashboard_stats', { _event_id: eventId });

const eventStats: EventDashboardStats = eventData;
```

## Security Considerations

1. **RLS on Views**: All views use `security_invoker = true` to inherit caller's permissions
2. **RPC Auth Check**: Both RPCs check `is_org_member()` before returning data
3. **No Direct Table Access**: Dashboard uses RPCs, not direct queries
4. **Audit Log Access**: Limited to org's own entries

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Org dashboard load | < 200ms | For org with 10 events, 1000 tickets |
| Event dashboard load | < 150ms | For event with 500 tickets |
| Concurrent users | 50+ | Per org |

## Files

| File | Purpose |
|------|---------|
| `supabase/migrations/20260202000001_f010_dashboard_stats.sql` | Main migration |
| `web/src/types/dashboard.ts` | TypeScript types |

---
*Created: 2026-02-02*
