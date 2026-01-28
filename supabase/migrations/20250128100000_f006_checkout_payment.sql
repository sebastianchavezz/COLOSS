-- ===========================================================================
-- F006: Checkout & Payment - Complete Flow
-- ===========================================================================
-- Doel: Waterdichte checkout flow met:
--   - org_id & subtotal_amount op orders
--   - Capacity validatie (atomisch met FOR UPDATE)
--   - handle_payment_webhook: ticket_instances uitgeven + email queuen
--   - Overbooked failsafe
-- ===========================================================================

-- =====================================================
-- 1. ORDERS TABLE EXTENSIONS
-- =====================================================

-- Add org_id column (derived from event, never client-trusted)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public.orgs(id) ON DELETE RESTRICT;

-- Add subtotal_amount (pre-discount total)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC(10,2) DEFAULT 0.00;

-- Add discount_amount tracking
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) DEFAULT 0.00;

-- Index for org lookups
CREATE INDEX IF NOT EXISTS idx_orders_org_id ON public.orders(org_id);

-- =====================================================
-- 2. CAPACITY VALIDATION RPC (Atomic Pre-Check)
-- =====================================================
-- Validates capacity for multiple ticket types atomically.
-- Uses FOR UPDATE SKIP LOCKED to prevent race conditions.
-- Returns: JSONB with {valid: bool, details: [...]}

DROP FUNCTION IF EXISTS public.validate_checkout_capacity(UUID, JSONB);

CREATE OR REPLACE FUNCTION public.validate_checkout_capacity(
  _event_id UUID,
  _items JSONB  -- Array: [{ticket_type_id: uuid, quantity: int}]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_ticket_type_id UUID;
  v_quantity INT;
  v_ticket_type RECORD;
  v_sold_count INT;
  v_available INT;
  v_details JSONB := '[]'::JSONB;
  v_is_valid BOOLEAN := TRUE;
  v_total_price NUMERIC(10,2) := 0;
BEGIN
  -- Iterate over requested items
  FOR v_item IN SELECT jsonb_array_elements(_items)
  LOOP
    v_ticket_type_id := (v_item->>'ticket_type_id')::UUID;
    v_quantity := (v_item->>'quantity')::INT;

    IF v_quantity < 1 THEN
      RETURN jsonb_build_object(
        'valid', false,
        'error', 'INVALID_QUANTITY',
        'details', jsonb_build_array(
          jsonb_build_object('ticket_type_id', v_ticket_type_id, 'reason', 'Quantity must be >= 1')
        )
      );
    END IF;

    -- Lock ticket_type row for atomic capacity check
    SELECT tt.id, tt.name, tt.price, tt.capacity_total, tt.sales_start, tt.sales_end
    INTO v_ticket_type
    FROM public.ticket_types tt
    WHERE tt.id = v_ticket_type_id
      AND tt.event_id = _event_id
      AND tt.deleted_at IS NULL
    FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
      v_is_valid := FALSE;
      v_details := v_details || jsonb_build_array(
        jsonb_build_object(
          'ticket_type_id', v_ticket_type_id,
          'reason', 'Ticket type not found or locked by concurrent request'
        )
      );
      CONTINUE;
    END IF;

    -- Sales window check
    IF v_ticket_type.sales_start IS NOT NULL AND NOW() < v_ticket_type.sales_start THEN
      v_is_valid := FALSE;
      v_details := v_details || jsonb_build_array(
        jsonb_build_object(
          'ticket_type_id', v_ticket_type_id,
          'ticket_name', v_ticket_type.name,
          'reason', 'Sales have not started yet'
        )
      );
      CONTINUE;
    END IF;

    IF v_ticket_type.sales_end IS NOT NULL AND NOW() > v_ticket_type.sales_end THEN
      v_is_valid := FALSE;
      v_details := v_details || jsonb_build_array(
        jsonb_build_object(
          'ticket_type_id', v_ticket_type_id,
          'ticket_name', v_ticket_type.name,
          'reason', 'Sales have ended'
        )
      );
      CONTINUE;
    END IF;

    -- Count sold tickets (issued + checked_in, not void)
    SELECT COALESCE(SUM(oi.quantity), 0) INTO v_sold_count
    FROM public.order_items oi
    JOIN public.orders o ON oi.order_id = o.id
    WHERE oi.ticket_type_id = v_ticket_type_id
      AND o.status IN ('pending', 'paid');

    v_available := v_ticket_type.capacity_total - v_sold_count;

    IF v_available < v_quantity THEN
      v_is_valid := FALSE;
      v_details := v_details || jsonb_build_array(
        jsonb_build_object(
          'ticket_type_id', v_ticket_type_id,
          'ticket_name', v_ticket_type.name,
          'capacity_total', v_ticket_type.capacity_total,
          'sold_count', v_sold_count,
          'available', v_available,
          'requested', v_quantity,
          'reason', 'Insufficient capacity'
        )
      );
    ELSE
      -- Accumulate price
      v_total_price := v_total_price + (v_ticket_type.price * v_quantity);
      v_details := v_details || jsonb_build_array(
        jsonb_build_object(
          'ticket_type_id', v_ticket_type_id,
          'ticket_name', v_ticket_type.name,
          'price', v_ticket_type.price,
          'quantity', v_quantity,
          'line_total', v_ticket_type.price * v_quantity,
          'available', v_available,
          'status', 'OK'
        )
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'valid', v_is_valid,
    'total_price', v_total_price,
    'details', v_details
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_checkout_capacity(UUID, JSONB) TO service_role;

-- =====================================================
-- 3. HANDLE_PAYMENT_WEBHOOK (REWRITE)
-- =====================================================
-- Atomische webhook handler:
-- - Payment status updaten
-- - Bij 'paid': capacity hercheck → ticket_instances uitgeven → email queuen
-- - Bij failure: order falen
-- - Overbooked failsafe: als capacity overschreden bij webhook

DROP FUNCTION IF EXISTS public.handle_payment_webhook(UUID, TEXT, TEXT, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION public.handle_payment_webhook(
  _order_id UUID,
  _payment_id TEXT,
  _status TEXT,
  _amount NUMERIC,
  _currency TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_order_item RECORD;
  v_ticket_type RECORD;
  v_sold_count INT;
  v_available INT;
  v_is_overbooked BOOLEAN := FALSE;
  v_tickets_issued INT := 0;
  v_result JSONB;
BEGIN
  -- 1. Update payments table
  UPDATE public.payments
  SET
    status = _status,
    updated_at = NOW()
  WHERE provider = 'mollie' AND provider_payment_id = _payment_id;

  -- 2. Fetch order details
  SELECT id, event_id, org_id, status, total_amount, email, user_id, purchaser_name
  INTO v_order
  FROM public.orders
  WHERE id = _order_id
  FOR UPDATE;  -- Lock order row for atomic update

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND', 'paid', false);
  END IF;

  -- 3. Status transition logic
  IF _status = 'paid' THEN
    -- Skip if already paid (idempotent)
    IF v_order.status = 'paid' THEN
      RETURN jsonb_build_object('paid', false, 'message', 'Order already paid');
    END IF;

    -- Update order to paid
    UPDATE public.orders
    SET status = 'paid', updated_at = NOW()
    WHERE id = _order_id;

    -- Also update legacy tickets table (backward compat)
    UPDATE public.tickets
    SET status = 'valid', updated_at = NOW()
    WHERE order_id = _order_id AND status = 'pending';

    -- Update linked registrations
    UPDATE public.registrations
    SET status = 'confirmed', updated_at = NOW()
    WHERE id IN (
      SELECT registration_id FROM public.tickets WHERE order_id = _order_id
    ) AND status = 'pending';

    -- 4. Issue ticket_instances (new model)
    -- For each order_item, check capacity and create ticket_instances
    FOR v_order_item IN
      SELECT oi.id, oi.ticket_type_id, oi.quantity
      FROM public.order_items oi
      WHERE oi.order_id = _order_id AND oi.ticket_type_id IS NOT NULL
    LOOP
      -- Final capacity check (critical for concurrency)
      SELECT tt.id, tt.name, tt.capacity_total
      INTO v_ticket_type
      FROM public.ticket_types tt
      WHERE tt.id = v_order_item.ticket_type_id
      FOR UPDATE;  -- Lock ticket_type for atomic capacity check

      IF FOUND THEN
        -- Count currently issued tickets for this type (excluding void)
        SELECT COALESCE(COUNT(*), 0) INTO v_sold_count
        FROM public.ticket_instances ti
        WHERE ti.ticket_type_id = v_order_item.ticket_type_id
          AND ti.status IN ('issued', 'checked_in');

        v_available := v_ticket_type.capacity_total - v_sold_count;

        IF v_available < v_order_item.quantity THEN
          -- OVERBOOKED FAILSAFE: capacity exceeded at webhook time
          v_is_overbooked := TRUE;

          -- Mark order as overbooked (special status signal)
          UPDATE public.orders
          SET status = 'cancelled', updated_at = NOW()
          WHERE id = _order_id;

          -- Don't issue any tickets for this order
          RETURN jsonb_build_object(
            'paid', false,
            'overbooked', true,
            'message', 'Capacity exceeded during webhook processing. Order cancelled. Refund required.',
            'ticket_type', v_ticket_type.name,
            'available', v_available,
            'requested', v_order_item.quantity
          );
        END IF;

        -- Issue ticket_instances
        -- Generate tokens inline using pgcrypto
        WITH ticket_numbers AS (
          SELECT generate_series(1, v_order_item.quantity) AS seq
        )
        INSERT INTO public.ticket_instances (
          event_id,
          ticket_type_id,
          order_id,
          order_item_id,
          sequence_no,
          owner_user_id,
          token_hash,
          qr_code,
          status
        )
        SELECT
          v_order.event_id,
          v_order_item.ticket_type_id,
          _order_id,
          v_order_item.id,
          ticket_numbers.seq,
          v_order.user_id,
          encode(extensions.digest(gen_random_uuid()::text::bytea, 'sha256'), 'hex'),
          gen_random_uuid()::text,
          'issued'
        FROM ticket_numbers
        ON CONFLICT (order_item_id, sequence_no) DO NOTHING;

        -- Count how many were actually inserted
        GET DIAGNOSTICS v_tickets_issued = ROW_COUNT;
      END IF;
    END LOOP;

    -- 5. Queue confirmation email via email_outbox (if table exists)
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'email_outbox') THEN
      INSERT INTO public.email_outbox (
        org_id,
        recipient_email,
        email_type,
        subject,
        template_key,
        template_data,
        status
      ) VALUES (
        v_order.org_id,
        v_order.email,
        'transactional',
        'Order Confirmed - ' || _order_id::text,
        'order_confirmation',
        jsonb_build_object(
          'order_id', _order_id,
          'purchaser_name', v_order.purchaser_name,
          'total_amount', _amount,
          'currency', _currency,
          'tickets_issued', v_tickets_issued
        ),
        'queued'
      );
    END IF;

    RETURN jsonb_build_object(
      'paid', true,
      'overbooked', false,
      'tickets_issued', v_tickets_issued,
      'order_id', _order_id,
      'email_queued', EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'email_outbox')
    );

  ELSIF _status IN ('expired', 'canceled', 'failed') THEN
    -- Payment failed/expired/canceled
    UPDATE public.orders
    SET status = 'failed', updated_at = NOW()
    WHERE id = _order_id AND status = 'pending';

    -- Cancel legacy tickets
    UPDATE public.tickets
    SET status = 'cancelled', updated_at = NOW()
    WHERE order_id = _order_id;

    -- Cancel registrations linked to legacy tickets
    UPDATE public.registrations
    SET status = 'cancelled', updated_at = NOW()
    WHERE id IN (
      SELECT registration_id FROM public.tickets WHERE order_id = _order_id
    );

    RETURN jsonb_build_object(
      'paid', false,
      'overbooked', false,
      'message', 'Payment failed: ' || _status
    );
  END IF;

  -- Other statuses (open, pending) - no action needed
  RETURN jsonb_build_object(
    'paid', false,
    'overbooked', false,
    'message', 'Status ' || _status || ' - no action required'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.handle_payment_webhook(UUID, TEXT, TEXT, NUMERIC, TEXT) TO service_role;

-- =====================================================
-- 4. CLEANUP TRIGGER: Pending orders older than 1 hour
-- =====================================================
-- Cron-style cleanup via periodic Edge Function call.
-- This is a helper RPC, not a trigger (triggers can't do time-based checks).

CREATE OR REPLACE FUNCTION public.cleanup_stale_pending_orders()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  -- Mark orders as cancelled if pending for > 1 hour
  WITH cancelled AS (
    UPDATE public.orders
    SET status = 'cancelled', updated_at = NOW()
    WHERE status = 'pending'
      AND created_at < NOW() - INTERVAL '1 hour'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM cancelled;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_stale_pending_orders() TO service_role;

-- =====================================================
-- 5. AUDIT LOG: payment webhook events
-- =====================================================
-- Ensure audit_log exists (should from earlier migrations)
CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  org_id UUID,
  actor_user_id UUID,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  before_state JSONB,
  after_state JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT audit_log_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON public.audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_org ON public.audit_log(org_id, created_at DESC);

-- =====================================================
-- VERIFICATIE
-- =====================================================
DO $$
BEGIN
  RAISE NOTICE '✓ F006: orders.org_id added';
  RAISE NOTICE '✓ F006: orders.subtotal_amount added';
  RAISE NOTICE '✓ F006: validate_checkout_capacity RPC created';
  RAISE NOTICE '✓ F006: handle_payment_webhook rewritten (ticket_instances + email)';
  RAISE NOTICE '✓ F006: cleanup_stale_pending_orders RPC created';
END $$;
