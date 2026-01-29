-- ===========================================================================
-- F006 Fix: Extend payment_status enum to support all Mollie statuses
-- ===========================================================================
-- Mollie sends: open, pending, paid, failed, expired, canceled, refunded
-- Current enum has: pending, paid, failed, cancelled, refunded
-- Missing: open, expired
-- Also: Mollie uses "canceled" (one 'l'), we use "cancelled" (two 'l')
-- ===========================================================================

-- Add missing enum values (IF NOT EXISTS syntax for enums)
DO $$
BEGIN
    -- Add 'open' if not exists
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'open' AND enumtypid = 'payment_status'::regtype) THEN
        ALTER TYPE payment_status ADD VALUE 'open';
    END IF;
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'payment_status.open already exists';
END $$;

DO $$
BEGIN
    -- Add 'expired' if not exists
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'expired' AND enumtypid = 'payment_status'::regtype) THEN
        ALTER TYPE payment_status ADD VALUE 'expired';
    END IF;
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'payment_status.expired already exists';
END $$;

DO $$
BEGIN
    -- Add 'created' if not exists (Mollie initial status)
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'created' AND enumtypid = 'payment_status'::regtype) THEN
        ALTER TYPE payment_status ADD VALUE 'created';
    END IF;
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'payment_status.created already exists';
END $$;

-- ===========================================================================
-- Fix handle_payment_webhook to handle Mollie's "canceled" spelling
-- ===========================================================================
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
  v_mapped_status payment_status;
BEGIN
  -- Map Mollie status to our enum (handle spelling differences)
  v_mapped_status := CASE _status
    WHEN 'paid' THEN 'paid'::payment_status
    WHEN 'open' THEN 'pending'::payment_status  -- Map 'open' to 'pending' if enum doesn't have 'open'
    WHEN 'pending' THEN 'pending'::payment_status
    WHEN 'failed' THEN 'failed'::payment_status
    WHEN 'canceled' THEN 'cancelled'::payment_status  -- Mollie: canceled, DB: cancelled
    WHEN 'cancelled' THEN 'cancelled'::payment_status
    WHEN 'expired' THEN 'failed'::payment_status  -- Map 'expired' to 'failed' if enum doesn't have it
    WHEN 'refunded' THEN 'refunded'::payment_status
    ELSE 'pending'::payment_status  -- Default fallback
  END;

  -- 1. Update payments table (use mapped status)
  UPDATE public.payments
  SET
    status = v_mapped_status,
    updated_at = NOW()
  WHERE provider = 'mollie' AND provider_payment_id = _payment_id;

  -- 2. Fetch order details
  SELECT id, event_id, org_id, status, total_amount, email, user_id, purchaser_name
  INTO v_order
  FROM public.orders
  WHERE id = _order_id
  FOR UPDATE;

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
    FOR v_order_item IN
      SELECT oi.id, oi.ticket_type_id, oi.quantity
      FROM public.order_items oi
      WHERE oi.order_id = _order_id AND oi.ticket_type_id IS NOT NULL
    LOOP
      -- Final capacity check
      SELECT tt.id, tt.name, tt.capacity_total
      INTO v_ticket_type
      FROM public.ticket_types tt
      WHERE tt.id = v_order_item.ticket_type_id
      FOR UPDATE;

      IF FOUND THEN
        SELECT COALESCE(COUNT(*), 0) INTO v_sold_count
        FROM public.ticket_instances ti
        WHERE ti.ticket_type_id = v_order_item.ticket_type_id
          AND ti.status IN ('issued', 'checked_in');

        v_available := v_ticket_type.capacity_total - v_sold_count;

        IF v_available < v_order_item.quantity THEN
          v_is_overbooked := TRUE;

          UPDATE public.orders
          SET status = 'cancelled', updated_at = NOW()
          WHERE id = _order_id;

          RETURN jsonb_build_object(
            'paid', false,
            'overbooked', true,
            'message', 'Capacity exceeded. Order cancelled. Refund required.',
            'ticket_type', v_ticket_type.name,
            'available', v_available,
            'requested', v_order_item.quantity
          );
        END IF;

        -- Issue ticket_instances
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
        ON CONFLICT (order_item_id, sequence_no) WHERE deleted_at IS NULL DO NOTHING;

        GET DIAGNOSTICS v_tickets_issued = ROW_COUNT;
      END IF;
    END LOOP;

    -- 5. Email is handled by Edge Function (mollie-webhook) after this RPC returns
    -- This RPC just handles the database state changes

    RETURN jsonb_build_object(
      'paid', true,
      'overbooked', false,
      'tickets_issued', v_tickets_issued,
      'order_id', _order_id
    );

  ELSIF _status IN ('expired', 'canceled', 'failed') THEN
    UPDATE public.orders
    SET status = 'failed', updated_at = NOW()
    WHERE id = _order_id AND status = 'pending';

    UPDATE public.tickets
    SET status = 'cancelled', updated_at = NOW()
    WHERE order_id = _order_id;

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

  RETURN jsonb_build_object(
    'paid', false,
    'overbooked', false,
    'message', 'Status ' || _status || ' - no action required'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.handle_payment_webhook(UUID, TEXT, TEXT, NUMERIC, TEXT) TO service_role;

-- ===========================================================================
-- Verify
-- ===========================================================================
DO $$
BEGIN
  RAISE NOTICE '✓ F006 Fix: payment_status enum extended';
  RAISE NOTICE '✓ F006 Fix: handle_payment_webhook handles Mollie status mapping';
END $$;
