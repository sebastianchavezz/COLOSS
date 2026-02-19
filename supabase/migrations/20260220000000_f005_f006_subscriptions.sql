-- ===========================================================================
-- F005/F006: Subscription-Based Tickets for Clubs
-- ===========================================================================
-- Doel: Support recurring subscription-based memberships for clubs.
-- Events get a mode: 'event' (existing) or 'club' (subscription-capable).
-- Ticket types in club-mode events can be subscriptions with recurring billing.
-- Intervals: monthly, quarterly, yearly; fixed-term or open-ended.
--
-- Tables created:
--   - mollie_customers: Maps auth users to Mollie Customer objects
--   - subscriptions: Core subscription tracking
--   - subscription_payments: Tracks each recurring payment
--
-- Columns added:
--   - events.event_mode: 'event' or 'club'
--   - ticket_types.is_subscription, billing_interval, billing_cycle_count, subscription_description
-- ===========================================================================

-- =====================================================
-- 1a. EVENTS: Add event_mode
-- =====================================================
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS event_mode TEXT DEFAULT 'event';

-- Constraint: only 'event' or 'club'
DO $$ BEGIN
  ALTER TABLE public.events ADD CONSTRAINT events_mode_check
    CHECK (event_mode IN ('event', 'club'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.events.event_mode IS
  'Event mode: event = one-time tickets, club = subscription-capable memberships';

-- =====================================================
-- 1b. TICKET TYPES: Add subscription fields
-- =====================================================
ALTER TABLE public.ticket_types ADD COLUMN IF NOT EXISTS is_subscription BOOLEAN DEFAULT FALSE;

ALTER TABLE public.ticket_types ADD COLUMN IF NOT EXISTS billing_interval TEXT;
-- Constraint: only allowed intervals
DO $$ BEGIN
  ALTER TABLE public.ticket_types ADD CONSTRAINT ticket_types_billing_interval_check
    CHECK (billing_interval IS NULL OR billing_interval IN ('1 month', '3 months', '1 year'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.ticket_types ADD COLUMN IF NOT EXISTS billing_cycle_count INTEGER;
-- NULL = open-ended, positive integer = fixed term

ALTER TABLE public.ticket_types ADD COLUMN IF NOT EXISTS subscription_description TEXT;
-- Human-readable: "Maandelijks lidmaatschap", etc.

-- Constraint: is_subscription = TRUE requires billing_interval IS NOT NULL
DO $$ BEGIN
  ALTER TABLE public.ticket_types ADD CONSTRAINT ticket_types_subscription_requires_interval
    CHECK (is_subscription = FALSE OR billing_interval IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.ticket_types.is_subscription IS
  'Whether this ticket type is a recurring subscription';
COMMENT ON COLUMN public.ticket_types.billing_interval IS
  'Billing interval for subscriptions: 1 month, 3 months, or 1 year';
COMMENT ON COLUMN public.ticket_types.billing_cycle_count IS
  'Number of billing cycles (NULL = open-ended, positive int = fixed-term)';
COMMENT ON COLUMN public.ticket_types.subscription_description IS
  'Human-readable subscription description (e.g. Maandelijks lidmaatschap)';

-- =====================================================
-- 1c. NEW TABLE: mollie_customers
-- =====================================================
-- Maps auth users to Mollie Customer objects.
-- One user can have one Mollie customer ID.

CREATE TABLE IF NOT EXISTS public.mollie_customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mollie_customer_id TEXT NOT NULL,    -- cst_xxx
  mollie_mandate_id TEXT,              -- mdt_xxx (set after first payment)
  mandate_status TEXT DEFAULT 'pending', -- pending, valid, invalid
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id),
  UNIQUE(mollie_customer_id)
);

CREATE INDEX IF NOT EXISTS idx_mollie_customers_user ON public.mollie_customers(user_id);

COMMENT ON TABLE public.mollie_customers IS
  'Maps Supabase auth users to Mollie Customer objects for recurring payments';
COMMENT ON COLUMN public.mollie_customers.mollie_customer_id IS
  'Mollie customer ID (cst_xxx)';
COMMENT ON COLUMN public.mollie_customers.mollie_mandate_id IS
  'Mollie mandate ID (mdt_xxx), set after first successful payment';
COMMENT ON COLUMN public.mollie_customers.mandate_status IS
  'Status of the SEPA mandate: pending, valid, or invalid';

-- =====================================================
-- 1d. NEW TABLE: subscriptions
-- =====================================================
-- Core subscription tracking table.

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  ticket_type_id UUID NOT NULL REFERENCES public.ticket_types(id) ON DELETE RESTRICT,
  org_id UUID NOT NULL REFERENCES public.orgs(id) ON DELETE RESTRICT,

  -- Mollie refs
  mollie_subscription_id TEXT,       -- sub_xxx (set after mandate confirmed)
  mollie_customer_id TEXT NOT NULL,  -- cst_xxx

  -- Status
  status TEXT NOT NULL DEFAULT 'pending_mandate',
  -- pending_mandate: first payment in progress
  -- active: subscription running
  -- past_due: payment failed, grace period
  -- cancelled: user/admin cancelled
  -- completed: fixed-term completed
  -- suspended: mandate invalid

  -- Billing config (copied from ticket_type at creation for immutability)
  billing_interval TEXT NOT NULL,
  billing_cycle_count INTEGER,       -- NULL = open-ended
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT DEFAULT 'EUR',

  -- Tracking
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cycles_completed INTEGER DEFAULT 0,
  next_payment_date DATE,

  -- Lifecycle
  started_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  ends_at TIMESTAMPTZ,              -- For fixed-term: when it should end

  -- First payment tracking
  first_order_id UUID REFERENCES public.orders(id),

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT subscriptions_status_check CHECK (
    status IN ('pending_mandate', 'active', 'past_due', 'cancelled', 'completed', 'suspended')
  )
);

-- Partial unique index: only prevent duplicates for active/pending statuses.
-- Allows historical cancelled/completed rows to coexist (re-subscribe without deleting history).
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_active_per_user_ticket
  ON public.subscriptions(user_id, ticket_type_id)
  WHERE status IN ('pending_mandate', 'active', 'past_due');

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_event ON public.subscriptions(event_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_mollie ON public.subscriptions(mollie_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status)
  WHERE status IN ('active', 'past_due');

COMMENT ON TABLE public.subscriptions IS
  'Core subscription tracking. Each subscription represents a recurring membership.';
COMMENT ON COLUMN public.subscriptions.status IS
  'pending_mandate→active→cancelled/completed/suspended. past_due for failed payments.';
COMMENT ON COLUMN public.subscriptions.billing_interval IS
  'Copied from ticket_type at creation for immutability';
COMMENT ON COLUMN public.subscriptions.amount IS
  'Per-period amount, copied from ticket_type price at creation';

-- =====================================================
-- 1e. NEW TABLE: subscription_payments
-- =====================================================
-- Tracks each recurring payment from Mollie.

CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
  order_id UUID REFERENCES public.orders(id),  -- Each payment creates an order for audit

  -- Mollie refs
  mollie_payment_id TEXT NOT NULL,    -- tr_xxx

  -- Status & amount
  status TEXT NOT NULL DEFAULT 'open',
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT DEFAULT 'EUR',

  -- Period this payment covers
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  cycle_number INTEGER,              -- Which cycle (1, 2, 3...)

  -- Failure tracking
  failure_reason TEXT,
  failed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT sub_payments_status_check CHECK (
    status IN ('open', 'pending', 'paid', 'failed', 'expired', 'refunded')
  ),
  UNIQUE(mollie_payment_id)
);

CREATE INDEX IF NOT EXISTS idx_sub_payments_subscription ON public.subscription_payments(subscription_id);
CREATE INDEX IF NOT EXISTS idx_sub_payments_mollie ON public.subscription_payments(mollie_payment_id);

COMMENT ON TABLE public.subscription_payments IS
  'Tracks each recurring payment from Mollie for a subscription';

-- =====================================================
-- 1f. RLS POLICIES
-- =====================================================

-- mollie_customers: users see own
ALTER TABLE public.mollie_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own mollie customer"
  ON public.mollie_customers
  FOR SELECT USING (user_id = auth.uid());

-- subscriptions: users see own, org admins see org subscriptions
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own subscriptions"
  ON public.subscriptions
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Org admins see org subscriptions"
  ON public.subscriptions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.org_members om
      WHERE om.org_id = subscriptions.org_id
        AND om.user_id = auth.uid()
    )
  );

-- subscription_payments: users see own, org admins see org
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own subscription payments"
  ON public.subscription_payments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.id = subscription_payments.subscription_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "Org admins see org subscription payments"
  ON public.subscription_payments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.subscriptions s
      JOIN public.org_members om ON om.org_id = s.org_id
      WHERE s.id = subscription_payments.subscription_id
        AND om.user_id = auth.uid()
    )
  );

-- Write policies: Block direct writes from authenticated users.
-- All mutations happen via service-role Edge Functions or SECURITY DEFINER RPCs.
-- This prevents any client-side direct INSERT/UPDATE/DELETE.

-- mollie_customers: no direct writes
CREATE POLICY "No direct inserts to mollie_customers"
  ON public.mollie_customers FOR INSERT WITH CHECK (false);
CREATE POLICY "No direct updates to mollie_customers"
  ON public.mollie_customers FOR UPDATE USING (false);
CREATE POLICY "No direct deletes to mollie_customers"
  ON public.mollie_customers FOR DELETE USING (false);

-- subscriptions: no direct writes
CREATE POLICY "No direct inserts to subscriptions"
  ON public.subscriptions FOR INSERT WITH CHECK (false);
CREATE POLICY "No direct updates to subscriptions"
  ON public.subscriptions FOR UPDATE USING (false);
CREATE POLICY "No direct deletes to subscriptions"
  ON public.subscriptions FOR DELETE USING (false);

-- subscription_payments: no direct writes (append-only via service role)
CREATE POLICY "No direct inserts to subscription_payments"
  ON public.subscription_payments FOR INSERT WITH CHECK (false);
CREATE POLICY "No direct updates to subscription_payments"
  ON public.subscription_payments FOR UPDATE USING (false);
CREATE POLICY "No direct deletes to subscription_payments"
  ON public.subscription_payments FOR DELETE USING (false);

-- =====================================================
-- 1g. TRIGGERS (updated_at)
-- =====================================================
CREATE TRIGGER handle_updated_at_mollie_customers
  BEFORE UPDATE ON public.mollie_customers
  FOR EACH ROW EXECUTE PROCEDURE extensions.moddatetime(updated_at);

CREATE TRIGGER handle_updated_at_subscriptions
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE PROCEDURE extensions.moddatetime(updated_at);

CREATE TRIGGER handle_updated_at_subscription_payments
  BEFORE UPDATE ON public.subscription_payments
  FOR EACH ROW EXECUTE PROCEDURE extensions.moddatetime(updated_at);

-- =====================================================
-- 2. RPC FUNCTIONS
-- =====================================================

-- =====================================================
-- 2a. get_user_subscriptions
-- =====================================================
-- Returns all subscriptions for the authenticated user with enriched data.

CREATE OR REPLACE FUNCTION public.get_user_subscriptions()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT COALESCE(jsonb_agg(sub_row ORDER BY s.created_at DESC), '[]'::JSONB)
  INTO v_result
  FROM public.subscriptions s
  JOIN public.events e ON e.id = s.event_id
  JOIN public.ticket_types tt ON tt.id = s.ticket_type_id
  CROSS JOIN LATERAL (
    SELECT jsonb_build_object(
      'id', s.id,
      'status', s.status,
      'event_id', s.event_id,
      'event_name', e.name,
      'ticket_type_id', s.ticket_type_id,
      'ticket_type_name', tt.name,
      'subscription_description', tt.subscription_description,
      'billing_interval', s.billing_interval,
      'billing_cycle_count', s.billing_cycle_count,
      'amount', s.amount,
      'currency', s.currency,
      'cycles_completed', s.cycles_completed,
      'current_period_start', s.current_period_start,
      'current_period_end', s.current_period_end,
      'next_payment_date', s.next_payment_date,
      'started_at', s.started_at,
      'cancelled_at', s.cancelled_at,
      'ends_at', s.ends_at,
      'created_at', s.created_at
    ) AS sub_row
  ) sub
  WHERE s.user_id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'subscriptions', v_result
  );
END;
$$;

COMMENT ON FUNCTION public.get_user_subscriptions() IS
  'Returns all subscriptions for the authenticated user with event and ticket type details';

-- =====================================================
-- 2b. handle_subscription_payment
-- =====================================================
-- Called by webhook when Mollie sends a recurring payment notification.
-- Creates order + order_item for audit trail, renews ticket_instance.

CREATE OR REPLACE FUNCTION public.handle_subscription_payment(
  _subscription_id UUID,
  _mollie_payment_id TEXT,
  _amount NUMERIC,
  _currency TEXT DEFAULT 'EUR'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub RECORD;
  v_order_id UUID;
  v_ticket_instance_id UUID;
  v_cycle_number INTEGER;
  v_period_start TIMESTAMPTZ;
  v_period_end TIMESTAMPTZ;
  v_interval INTERVAL;
BEGIN
  -- 1. Get subscription
  SELECT s.*, e.name AS event_name, e.slug AS event_slug
  INTO v_sub
  FROM public.subscriptions s
  JOIN public.events e ON e.id = s.event_id
  WHERE s.id = _subscription_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'SUBSCRIPTION_NOT_FOUND');
  END IF;

  -- 2. Calculate period
  v_cycle_number := v_sub.cycles_completed + 1;
  v_interval := v_sub.billing_interval::INTERVAL;
  v_period_start := COALESCE(v_sub.current_period_end, now());
  v_period_end := v_period_start + v_interval;

  -- 3. Create order for audit trail
  INSERT INTO public.orders (
    event_id, org_id, user_id, email, status,
    subtotal_amount, total_amount, currency, metadata
  ) VALUES (
    v_sub.event_id,
    v_sub.org_id,
    v_sub.user_id,
    (SELECT email FROM auth.users WHERE id = v_sub.user_id),
    'paid',
    _amount, _amount, _currency,
    jsonb_build_object(
      'type', 'subscription_renewal',
      'subscription_id', _subscription_id,
      'cycle_number', v_cycle_number
    )
  )
  RETURNING id INTO v_order_id;

  -- 4. Create order item
  INSERT INTO public.order_items (
    order_id, ticket_type_id, quantity, unit_price, total_price
  ) VALUES (
    v_order_id, v_sub.ticket_type_id, 1, _amount, _amount
  );

  -- 5. Issue/renew ticket_instance
  INSERT INTO public.ticket_instances (
    event_id, ticket_type_id, order_id, owner_user_id,
    qr_code, status
  ) VALUES (
    v_sub.event_id,
    v_sub.ticket_type_id,
    v_order_id,
    v_sub.user_id,
    'sub_' || gen_random_uuid()::TEXT,  -- Prefixed QR for subscription tickets
    'issued'
  )
  RETURNING id INTO v_ticket_instance_id;

  -- 6. Record subscription payment (idempotent: ON CONFLICT for replay safety)
  INSERT INTO public.subscription_payments (
    subscription_id, order_id, mollie_payment_id,
    status, amount, currency,
    period_start, period_end, cycle_number
  ) VALUES (
    _subscription_id, v_order_id, _mollie_payment_id,
    'paid', _amount, _currency,
    v_period_start, v_period_end, v_cycle_number
  )
  ON CONFLICT (mollie_payment_id) DO NOTHING;

  -- 7. Update subscription tracking
  UPDATE public.subscriptions SET
    status = 'active',
    cycles_completed = v_cycle_number,
    current_period_start = v_period_start,
    current_period_end = v_period_end,
    next_payment_date = (v_period_end)::DATE
  WHERE id = _subscription_id;

  -- 8. Check if fixed-term subscription is now complete
  IF v_sub.billing_cycle_count IS NOT NULL AND v_cycle_number >= v_sub.billing_cycle_count THEN
    UPDATE public.subscriptions SET
      status = 'completed',
      ends_at = v_period_end
    WHERE id = _subscription_id;
  END IF;

  -- 9. Queue confirmation email
  PERFORM public.queue_email(
    v_sub.org_id,
    v_sub.event_id,
    'sub_payment_' || _mollie_payment_id,
    (SELECT email FROM auth.users WHERE id = v_sub.user_id),
    'Abonnement verlengd - ' || v_sub.event_name,
    '<h2>Je abonnement is verlengd</h2>'
      || '<p>Periode: ' || to_char(v_period_start, 'DD-MM-YYYY') || ' t/m ' || to_char(v_period_end, 'DD-MM-YYYY') || '</p>'
      || '<p>Bedrag: €' || _amount::TEXT || '</p>'
      || '<p>Cyclus: ' || v_cycle_number::TEXT
      || CASE WHEN v_sub.billing_cycle_count IS NOT NULL
           THEN ' van ' || v_sub.billing_cycle_count::TEXT
           ELSE '' END
      || '</p>',
    'transactional'
  );

  -- 10. Audit log
  INSERT INTO public.audit_log (
    org_id, actor_user_id, action, entity_type, entity_id,
    after_state, metadata
  ) VALUES (
    v_sub.org_id, NULL, 'SUBSCRIPTION_PAYMENT_PROCESSED', 'subscription', _subscription_id,
    jsonb_build_object(
      'cycle_number', v_cycle_number,
      'amount', _amount,
      'order_id', v_order_id,
      'ticket_instance_id', v_ticket_instance_id
    ),
    jsonb_build_object('mollie_payment_id', _mollie_payment_id)
  );

  RETURN jsonb_build_object(
    'success', true,
    'subscription_id', _subscription_id,
    'order_id', v_order_id,
    'ticket_instance_id', v_ticket_instance_id,
    'cycle_number', v_cycle_number,
    'period_start', v_period_start,
    'period_end', v_period_end,
    'email_queued', true
  );
END;
$$;

COMMENT ON FUNCTION public.handle_subscription_payment IS
  'Processes a recurring subscription payment: creates order, issues ticket, records payment, queues email';

-- =====================================================
-- 2c. cancel_subscription
-- =====================================================
-- Called by user or admin to cancel a subscription.

CREATE OR REPLACE FUNCTION public.cancel_subscription(
  _subscription_id UUID,
  _reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub RECORD;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  -- Guard: must be authenticated
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHENTICATED');
  END IF;

  -- Get subscription
  SELECT * INTO v_sub
  FROM public.subscriptions
  WHERE id = _subscription_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'SUBSCRIPTION_NOT_FOUND');
  END IF;

  -- Authorization: user owns it OR is org owner/admin (not any member)
  IF v_sub.user_id != v_user_id AND NOT EXISTS (
    SELECT 1 FROM public.org_members om
    WHERE om.org_id = v_sub.org_id
      AND om.user_id = v_user_id
      AND om.role IN ('owner', 'admin')
  ) THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;

  -- Can only cancel active or past_due subscriptions
  IF v_sub.status NOT IN ('active', 'past_due', 'pending_mandate') THEN
    RETURN jsonb_build_object('error', 'CANNOT_CANCEL', 'current_status', v_sub.status);
  END IF;

  -- Update subscription
  UPDATE public.subscriptions SET
    status = 'cancelled',
    cancelled_at = now(),
    cancel_reason = _reason
  WHERE id = _subscription_id;

  -- Audit log
  INSERT INTO public.audit_log (
    org_id, actor_user_id, action, entity_type, entity_id,
    before_state, after_state, metadata
  ) VALUES (
    v_sub.org_id, v_user_id, 'SUBSCRIPTION_CANCELLED', 'subscription', _subscription_id,
    jsonb_build_object('status', v_sub.status),
    jsonb_build_object('status', 'cancelled', 'reason', _reason),
    jsonb_build_object('cancelled_by', CASE WHEN v_sub.user_id = v_user_id THEN 'user' ELSE 'admin' END)
  );

  -- Queue cancellation email
  PERFORM public.queue_email(
    v_sub.org_id,
    v_sub.event_id,
    'sub_cancel_' || _subscription_id::TEXT,
    (SELECT email FROM auth.users WHERE id = v_sub.user_id),
    'Abonnement opgezegd',
    '<h2>Je abonnement is opgezegd</h2>'
      || '<p>Je hebt nog toegang tot ' || COALESCE(to_char(v_sub.current_period_end, 'DD-MM-YYYY'), 'het einde van de huidige periode') || '.</p>'
      || CASE WHEN _reason IS NOT NULL THEN '<p>Reden: ' || _reason || '</p>' ELSE '' END,
    'transactional'
  );

  RETURN jsonb_build_object(
    'success', true,
    'subscription_id', _subscription_id,
    'cancelled_at', now(),
    'access_until', v_sub.current_period_end,
    'mollie_subscription_id', v_sub.mollie_subscription_id
  );
END;
$$;

COMMENT ON FUNCTION public.cancel_subscription IS
  'Cancels a subscription. User retains access until current_period_end. Returns mollie_subscription_id for Edge Function to cancel at Mollie.';

-- =====================================================
-- 2d. handle_subscription_failure
-- =====================================================
-- Called when a subscription payment fails.

CREATE OR REPLACE FUNCTION public.handle_subscription_failure(
  _subscription_id UUID,
  _mollie_payment_id TEXT,
  _failure_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub RECORD;
BEGIN
  SELECT s.*, e.name AS event_name
  INTO v_sub
  FROM public.subscriptions s
  JOIN public.events e ON e.id = s.event_id
  WHERE s.id = _subscription_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'SUBSCRIPTION_NOT_FOUND');
  END IF;

  -- Record failed payment
  INSERT INTO public.subscription_payments (
    subscription_id, mollie_payment_id,
    status, amount, currency,
    failure_reason, failed_at
  ) VALUES (
    _subscription_id, _mollie_payment_id,
    'failed', v_sub.amount, v_sub.currency,
    _failure_reason, now()
  )
  ON CONFLICT (mollie_payment_id) DO UPDATE SET
    status = 'failed',
    failure_reason = EXCLUDED.failure_reason,
    failed_at = EXCLUDED.failed_at;

  -- Update subscription to past_due (grace period starts)
  UPDATE public.subscriptions SET
    status = 'past_due'
  WHERE id = _subscription_id
    AND status = 'active';

  -- Queue dunning email
  PERFORM public.queue_email(
    v_sub.org_id,
    v_sub.event_id,
    'sub_failed_' || _mollie_payment_id,
    (SELECT email FROM auth.users WHERE id = v_sub.user_id),
    'Betaling mislukt - ' || v_sub.event_name,
    '<h2>Je abonnementsbetaling is mislukt</h2>'
      || '<p>We konden de betaling van €' || v_sub.amount::TEXT || ' niet verwerken.</p>'
      || '<p>Je abonnement blijft actief gedurende een coulanceperiode van 7 dagen.</p>'
      || '<p>Controleer je betaalmethode om onderbrekingen te voorkomen.</p>',
    'transactional'
  );

  -- Audit log
  INSERT INTO public.audit_log (
    org_id, actor_user_id, action, entity_type, entity_id,
    after_state, metadata
  ) VALUES (
    v_sub.org_id, NULL, 'SUBSCRIPTION_PAYMENT_FAILED', 'subscription', _subscription_id,
    jsonb_build_object('status', 'past_due', 'failure_reason', _failure_reason),
    jsonb_build_object('mollie_payment_id', _mollie_payment_id)
  );

  RETURN jsonb_build_object(
    'success', true,
    'subscription_id', _subscription_id,
    'status', 'past_due',
    'grace_period_days', 7
  );
END;
$$;

COMMENT ON FUNCTION public.handle_subscription_failure IS
  'Handles failed subscription payment: records failure, sets past_due, queues dunning email';
