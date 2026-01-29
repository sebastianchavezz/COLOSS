-- ===========================================================================
-- F006 Fix: Remove ON CONFLICT for ticket_instances (no unique constraint exists)
-- ===========================================================================
-- The ticket_instances table doesn't have a unique constraint on
-- (order_item_id, sequence_no), so ON CONFLICT fails.
-- Solution: Just insert without ON CONFLICT, use idempotency at order level.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.handle_payment_webhook(
  _order_id UUID,
  _payment_id TEXT,
  _status TEXT,
  _amount NUMERIC,
  _currency TEXT DEFAULT 'EUR'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_order RECORD;
  v_order_item RECORD;
  v_ticket_type RECORD;
  v_sold_count INTEGER;
  v_available INTEGER;
  v_is_overbooked BOOLEAN := FALSE;
  v_tickets_issued INTEGER := 0;
  v_existing_tickets INTEGER := 0;
  v_payment_status payment_status;
BEGIN
  -- Cast text status to payment_status enum (with fallback)
  BEGIN
    v_payment_status := _status::payment_status;
  EXCEPTION WHEN OTHERS THEN
    v_payment_status := 'open'::payment_status;
  END;

  -- 1. Update payments table
  UPDATE public.payments
  SET
    status = v_payment_status,
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

    -- Update legacy tickets table (ticket_status: 'valid', 'used', 'cancelled')
    UPDATE public.tickets
    SET status = 'valid'::ticket_status, updated_at = NOW()
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
      -- Check if tickets already exist for this order_item (idempotency)
      SELECT COUNT(*) INTO v_existing_tickets
      FROM public.ticket_instances ti
      WHERE ti.order_item_id = v_order_item.id;

      IF v_existing_tickets > 0 THEN
        -- Already issued, skip this order_item
        v_tickets_issued := v_tickets_issued + v_existing_tickets;
        CONTINUE;
      END IF;

      -- Capacity check
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

        v_available := COALESCE(v_ticket_type.capacity_total, 999999) - v_sold_count;

        IF v_available < v_order_item.quantity THEN
          -- OVERBOOKED
          v_is_overbooked := TRUE;
          UPDATE public.orders SET status = 'cancelled', updated_at = NOW() WHERE id = _order_id;
          RETURN jsonb_build_object(
            'paid', false,
            'overbooked', true,
            'message', 'Capacity exceeded. Order cancelled.',
            'ticket_type', v_ticket_type.name,
            'available', v_available,
            'requested', v_order_item.quantity
          );
        END IF;

        -- Issue ticket_instances (NO ON CONFLICT - use explicit idempotency above)
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
          encode(digest(gen_random_uuid()::text::bytea, 'sha256'), 'hex'),
          gen_random_uuid()::text,
          'issued'::ticket_instance_status
        FROM ticket_numbers;

        GET DIAGNOSTICS v_tickets_issued = ROW_COUNT;
      END IF;
    END LOOP;

    RETURN jsonb_build_object(
      'paid', true,
      'order_id', _order_id,
      'tickets_issued', v_tickets_issued,
      'email_queued', false
    );

  ELSIF _status IN ('failed', 'expired', 'canceled') THEN
    IF v_order.status = 'pending' THEN
      UPDATE public.orders SET status = 'cancelled', updated_at = NOW() WHERE id = _order_id;
      UPDATE public.tickets SET status = 'cancelled'::ticket_status, updated_at = NOW() WHERE order_id = _order_id;
    END IF;
    RETURN jsonb_build_object('paid', false, 'cancelled', true, 'reason', _status);

  ELSE
    RETURN jsonb_build_object('paid', false, 'status', _status, 'message', 'No action for this status');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.handle_payment_webhook(uuid, text, text, numeric, text) TO service_role;

DO $$
BEGIN
  RAISE NOTICE 'F006: Fixed handle_payment_webhook - removed ON CONFLICT, use explicit idempotency';
END$$;
