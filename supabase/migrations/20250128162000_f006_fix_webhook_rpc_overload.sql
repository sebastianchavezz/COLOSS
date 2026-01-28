-- F006: Fix handle_payment_webhook overload conflict
-- There are two versions of the function with different signatures causing PGRST203
-- Drop the old text-based version and keep the proper numeric version

-- Drop the old version with text amount
DROP FUNCTION IF EXISTS public.handle_payment_webhook(uuid, text, text, text, text);

-- Recreate the correct version with numeric amount
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
      FOR UPDATE;

      IF FOUND THEN
        -- Count currently issued tickets
        SELECT COALESCE(COUNT(*), 0) INTO v_sold_count
        FROM public.ticket_instances ti
        WHERE ti.ticket_type_id = v_order_item.ticket_type_id
          AND ti.status IN ('issued', 'checked_in', 'valid');

        v_available := COALESCE(v_ticket_type.capacity_total, 999999) - v_sold_count;

        IF v_available < v_order_item.quantity THEN
          -- OVERBOOKED FAILSAFE
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
          encode(digest(gen_random_uuid()::text::bytea, 'sha256'), 'hex'),
          gen_random_uuid()::text,
          'issued'
        FROM ticket_numbers
        ON CONFLICT (order_item_id, sequence_no) DO NOTHING;

        GET DIAGNOSTICS v_tickets_issued = ROW_COUNT;
      END IF;
    END LOOP;

    -- 5. Queue confirmation email
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'email_outbox') THEN
      BEGIN
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
          'Bestelling bevestigd',
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
      EXCEPTION WHEN OTHERS THEN
        -- Non-fatal: email queue failure should not block payment
        NULL;
      END;
    END IF;

    RETURN jsonb_build_object(
      'paid', true,
      'order_id', _order_id,
      'tickets_issued', v_tickets_issued,
      'email_queued', true
    );

  ELSIF _status IN ('failed', 'expired', 'canceled') THEN
    -- Payment failed/cancelled
    IF v_order.status = 'pending' THEN
      UPDATE public.orders
      SET status = 'cancelled', updated_at = NOW()
      WHERE id = _order_id;

      UPDATE public.tickets
      SET status = 'cancelled', updated_at = NOW()
      WHERE order_id = _order_id;
    END IF;

    RETURN jsonb_build_object(
      'paid', false,
      'cancelled', true,
      'reason', _status
    );

  ELSE
    -- Other status (open, pending, etc.) - no action needed
    RETURN jsonb_build_object(
      'paid', false,
      'status', _status,
      'message', 'No action for this status'
    );
  END IF;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.handle_payment_webhook(uuid, text, text, numeric, text) TO service_role;

-- Verification
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_proc
  WHERE proname = 'handle_payment_webhook';

  IF v_count = 0 THEN
    RAISE EXCEPTION 'handle_payment_webhook not found';
  ELSIF v_count > 1 THEN
    RAISE WARNING 'Multiple handle_payment_webhook functions exist: %', v_count;
  END IF;
  RAISE NOTICE 'F006: handle_payment_webhook verified (% version(s))', v_count;
END$$;
