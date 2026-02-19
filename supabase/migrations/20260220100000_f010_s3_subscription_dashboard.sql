-- ===========================================================================
-- F010 S3: Subscription Management in Organizer Dashboard
-- ===========================================================================
-- Doel: Add subscription stats and management RPCs for the organizer dashboard.
-- New RPC: get_org_subscription_stats — complete subscription overview per org.
-- Updated RPC: get_org_dashboard_stats — adds subscription summary to org overview.
--
-- Dependencies: F005/F006 subscription tables must exist.
-- ===========================================================================

-- ============================================
-- 1. NEW RPC: get_org_subscription_stats
-- ============================================
-- Returns complete subscription overview for an organization:
-- - Summary KPIs (active, MRR, churn)
-- - Per-event subscription breakdown
-- - Full subscriber list with details
-- - Recent subscription payments

CREATE OR REPLACE FUNCTION public.get_org_subscription_stats(_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_result JSONB;
  v_summary JSONB;
  v_per_event JSONB;
  v_subscribers JSONB;
  v_recent_payments JSONB;
BEGIN
  -- Security: must be org member
  IF NOT public.is_org_member(_org_id) THEN
    RETURN jsonb_build_object(
      'error', 'NOT_AUTHORIZED',
      'message', 'User is not a member of this organization'
    );
  END IF;

  -- 1. Summary KPIs
  SELECT jsonb_build_object(
    'total', COUNT(*),
    'active', COUNT(*) FILTER (WHERE s.status = 'active'),
    'pending_mandate', COUNT(*) FILTER (WHERE s.status = 'pending_mandate'),
    'past_due', COUNT(*) FILTER (WHERE s.status = 'past_due'),
    'cancelled', COUNT(*) FILTER (WHERE s.status = 'cancelled'),
    'completed', COUNT(*) FILTER (WHERE s.status = 'completed'),
    'suspended', COUNT(*) FILTER (WHERE s.status = 'suspended'),
    'mrr', COALESCE(
      SUM(
        CASE
          WHEN s.status = 'active' AND s.billing_interval = '1 month' THEN s.amount
          WHEN s.status = 'active' AND s.billing_interval = '3 months' THEN ROUND(s.amount / 3, 2)
          WHEN s.status = 'active' AND s.billing_interval = '1 year' THEN ROUND(s.amount / 12, 2)
          ELSE 0
        END
      ), 0
    ),
    'total_revenue', COALESCE(
      (SELECT SUM(sp.amount) FROM subscription_payments sp
       JOIN subscriptions sub ON sub.id = sp.subscription_id
       WHERE sub.org_id = _org_id AND sp.status = 'paid'),
      0
    )
  )
  INTO v_summary
  FROM subscriptions s
  WHERE s.org_id = _org_id;

  -- 2. Per-event breakdown
  SELECT COALESCE(jsonb_agg(event_row ORDER BY active_count DESC), '[]'::JSONB)
  INTO v_per_event
  FROM (
    SELECT jsonb_build_object(
      'event_id', e.id,
      'event_name', e.name,
      'event_slug', e.slug,
      'event_mode', e.event_mode,
      'active', COUNT(*) FILTER (WHERE s.status = 'active'),
      'past_due', COUNT(*) FILTER (WHERE s.status = 'past_due'),
      'cancelled', COUNT(*) FILTER (WHERE s.status = 'cancelled'),
      'total', COUNT(*)
    ) AS event_row,
    COUNT(*) FILTER (WHERE s.status = 'active') AS active_count
    FROM subscriptions s
    JOIN events e ON e.id = s.event_id
    WHERE s.org_id = _org_id
    GROUP BY e.id, e.name, e.slug, e.event_mode
  ) sub;

  -- 3. Subscriber list (most recent 100 subscriptions with user details)
  -- NOTE: auth.users joined under SECURITY DEFINER; caller is already verified as org member above.
  SELECT COALESCE(jsonb_agg(sub_row ORDER BY s_created DESC), '[]'::JSONB)
  INTO v_subscribers
  FROM (
    SELECT jsonb_build_object(
      'subscription_id', s.id,
      'user_id', s.user_id,
      'email', u.email,
      'event_id', s.event_id,
      'event_name', e.name,
      'ticket_type_name', tt.name,
      'status', s.status,
      'billing_interval', s.billing_interval,
      'amount', s.amount,
      'currency', s.currency,
      'cycles_completed', s.cycles_completed,
      'current_period_start', s.current_period_start,
      'current_period_end', s.current_period_end,
      'next_payment_date', s.next_payment_date,
      'started_at', s.started_at,
      'cancelled_at', s.cancelled_at,
      'cancel_reason', s.cancel_reason,
      'created_at', s.created_at
    ) AS sub_row,
    s.created_at AS s_created
    FROM subscriptions s
    JOIN auth.users u ON u.id = s.user_id
    JOIN events e ON e.id = s.event_id
    JOIN ticket_types tt ON tt.id = s.ticket_type_id
    WHERE s.org_id = _org_id
    ORDER BY s.created_at DESC
    LIMIT 100
  ) sub;

  -- 4. Recent subscription payments (last 20)
  -- NOTE: auth.users joined under SECURITY DEFINER; caller is already verified as org member above.
  SELECT COALESCE(jsonb_agg(pay_row ORDER BY pay_created DESC), '[]'::JSONB)
  INTO v_recent_payments
  FROM (
    SELECT jsonb_build_object(
      'payment_id', sp.id,
      'subscription_id', sp.subscription_id,
      'email', u.email,
      'event_name', e.name,
      'mollie_payment_id', sp.mollie_payment_id,
      'status', sp.status,
      'amount', sp.amount,
      'currency', sp.currency,
      'cycle_number', sp.cycle_number,
      'period_start', sp.period_start,
      'period_end', sp.period_end,
      'failure_reason', sp.failure_reason,
      'created_at', sp.created_at
    ) AS pay_row,
    sp.created_at AS pay_created
    FROM subscription_payments sp
    JOIN subscriptions s ON s.id = sp.subscription_id
    JOIN auth.users u ON u.id = s.user_id
    JOIN events e ON e.id = s.event_id
    WHERE s.org_id = _org_id
    ORDER BY sp.created_at DESC
    LIMIT 20
  ) sub;

  -- Build result
  v_result := jsonb_build_object(
    'summary', v_summary,
    'per_event', v_per_event,
    'subscribers', v_subscribers,
    'recent_payments', v_recent_payments,
    'generated_at', now()
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_org_subscription_stats(UUID) IS
  'Returns complete subscription statistics for an organization. Requires org membership.';

GRANT EXECUTE ON FUNCTION public.get_org_subscription_stats(UUID) TO authenticated;

-- ============================================
-- 2. UPDATE: get_org_dashboard_stats
-- ============================================
-- Adds subscription summary to the org dashboard overview.
-- This is backwards compatible: adds a new 'subscriptions' key to summary.

CREATE OR REPLACE FUNCTION public.get_org_dashboard_stats(_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
    _result jsonb;
    _org_row record;
    _events_summary jsonb;
    _events_list jsonb;
    _recent_activity jsonb;
    _tickets_summary jsonb;
    _subscriptions_summary jsonb;
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

    -- Subscriptions summary (NEW in S3)
    SELECT jsonb_build_object(
        'active', COUNT(*) FILTER (WHERE status = 'active'),
        'past_due', COUNT(*) FILTER (WHERE status = 'past_due'),
        'mrr', COALESCE(
          SUM(
            CASE
              WHEN status = 'active' AND billing_interval = '1 month' THEN amount
              WHEN status = 'active' AND billing_interval = '3 months' THEN ROUND(amount / 3, 2)
              WHEN status = 'active' AND billing_interval = '1 year' THEN ROUND(amount / 12, 2)
              ELSE 0
            END
          ), 0
        )
    )
    INTO _subscriptions_summary
    FROM public.subscriptions
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
                'event_name', CASE
                    WHEN al.entity_type = 'event' THEN (SELECT name FROM public.events WHERE id = al.entity_id)
                    WHEN al.entity_type = 'ticket_instance' THEN (
                        SELECT e.name FROM public.ticket_instances ti
                        JOIN public.events e ON e.id = ti.event_id
                        WHERE ti.id = al.entity_id
                    )
                    WHEN al.entity_type = 'order' THEN (
                        SELECT e.name FROM public.orders o
                        JOIN public.events e ON e.id = o.event_id
                        WHERE o.id = al.entity_id
                    )
                    WHEN al.entity_type = 'subscription' THEN (
                        SELECT e.name FROM public.subscriptions sub
                        JOIN public.events e ON e.id = sub.event_id
                        WHERE sub.id = al.entity_id
                    )
                    ELSE NULL
                END,
                'metadata', al.metadata
            ) AS activity,
            al.created_at
        FROM public.audit_log al
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
            'tickets', _tickets_summary,
            'subscriptions', _subscriptions_summary
        ),
        'events', _events_list,
        'recent_activity', _recent_activity,
        'generated_at', now()
    );

    RETURN _result;
END;
$$;

COMMENT ON FUNCTION public.get_org_dashboard_stats IS
    'Returns complete dashboard statistics for an organization including subscription KPIs. Requires org membership.';

-- ============================================
-- 3. INDEXES FOR PERFORMANCE
-- ============================================

-- Subscriptions per org for dashboard queries
CREATE INDEX IF NOT EXISTS idx_subscriptions_org_status
ON public.subscriptions(org_id, status);

-- Subscription payments: composite index for recent payments query (joins through subscription_id, sorts by created_at)
CREATE INDEX IF NOT EXISTS idx_sub_payments_sub_created
ON public.subscription_payments(subscription_id, created_at DESC);
