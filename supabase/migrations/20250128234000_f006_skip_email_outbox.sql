-- ===========================================================================
-- F006 Fix: Skip email_outbox in triggers - too many required fields
-- ===========================================================================
-- The email_outbox table has many NOT NULL columns (from_name, from_email,
-- subject, html_body) that we can't easily populate from a trigger.
-- Solution: Skip the outbox insert in triggers, handle emails via Edge Functions.
-- ===========================================================================

-- ===========================================================================
-- 1. FIX sync_registration_on_order_paid TRIGGER - no email outbox
-- ===========================================================================

CREATE OR REPLACE FUNCTION sync_registration_on_order_paid()
RETURNS TRIGGER AS $$
DECLARE
  v_item RECORD;
  v_participant_id UUID;
  v_registration_id UUID;
  v_event_id UUID;
  v_org_id UUID;
  v_event_name TEXT;
  v_ticket_count INTEGER := 0;
  v_first_registration_id UUID;
BEGIN
  -- Only trigger on status change to 'paid'
  IF NEW.status = 'paid' AND (OLD IS NULL OR OLD.status IS DISTINCT FROM 'paid') THEN

    -- Loop through order items with ticket types
    FOR v_item IN
      SELECT
        oi.id as order_item_id,
        oi.ticket_type_id,
        oi.quantity,
        tt.event_id
      FROM order_items oi
      JOIN ticket_types tt ON tt.id = oi.ticket_type_id
      WHERE oi.order_id = NEW.id
        AND oi.ticket_type_id IS NOT NULL
    LOOP
      v_event_id := v_item.event_id;

      -- Get org_id and event name
      SELECT e.org_id, e.name INTO v_org_id, v_event_name
      FROM events e WHERE e.id = v_event_id;

      -- 1. Upsert participant by email (idempotent)
      INSERT INTO participants (email, first_name, last_name, user_id)
      VALUES (
        NEW.email,
        COALESCE((NEW.metadata->>'first_name')::text, split_part(NEW.email, '@', 1)),
        COALESCE((NEW.metadata->>'last_name')::text, ''),
        NEW.user_id
      )
      ON CONFLICT (email) WHERE deleted_at IS NULL
      DO UPDATE SET
        user_id = COALESCE(participants.user_id, EXCLUDED.user_id),
        first_name = CASE
          WHEN participants.first_name = '' OR participants.first_name IS NULL
          THEN EXCLUDED.first_name
          ELSE participants.first_name
        END,
        updated_at = NOW()
      RETURNING id INTO v_participant_id;

      -- If participant wasn't found/created, try to get existing
      IF v_participant_id IS NULL THEN
        SELECT id INTO v_participant_id
        FROM participants
        WHERE email = NEW.email AND deleted_at IS NULL;
      END IF;

      -- 2. Upsert registration (idempotent by order_item_id)
      INSERT INTO registrations (
        event_id,
        participant_id,
        ticket_type_id,
        order_item_id,
        status
      )
      VALUES (
        v_event_id,
        v_participant_id,
        v_item.ticket_type_id,
        v_item.order_item_id,
        'confirmed'
      )
      ON CONFLICT (order_item_id) WHERE deleted_at IS NULL AND order_item_id IS NOT NULL
      DO UPDATE SET
        status = 'confirmed',
        updated_at = NOW()
      RETURNING id INTO v_registration_id;

      -- Track first registration
      IF v_first_registration_id IS NULL THEN
        v_first_registration_id := v_registration_id;
      END IF;

      -- 3. Link ticket instances to participant
      UPDATE ticket_instances
      SET participant_id = v_participant_id
      WHERE order_id = NEW.id
        AND ticket_type_id = v_item.ticket_type_id
        AND participant_id IS NULL;

      v_ticket_count := v_ticket_count + v_item.quantity;

      -- 4. Audit log with ALL required columns
      BEGIN
        INSERT INTO audit_log (
          org_id,
          actor_user_id,
          action,
          entity_type,
          entity_id,
          resource_type,
          resource_id,
          metadata
        )
        VALUES (
          v_org_id,
          COALESCE(NEW.user_id, '00000000-0000-0000-0000-000000000000'::uuid),
          'REGISTRATION_CREATED_FROM_ORDER',
          'registration',
          COALESCE(v_registration_id, gen_random_uuid()),
          'registration',
          COALESCE(v_registration_id, gen_random_uuid()),
          jsonb_build_object(
            'order_id', NEW.id,
            'order_item_id', v_item.order_item_id,
            'participant_id', v_participant_id,
            'participant_email', NEW.email
          )
        )
        ON CONFLICT DO NOTHING;
      EXCEPTION WHEN OTHERS THEN
        -- Non-fatal: audit log failure should not block order processing
        NULL;
      END;

    END LOOP;

    -- NOTE: Email confirmation is handled by the webhook Edge Function,
    -- not by this trigger. The email_outbox table has too many required
    -- fields (from_name, from_email, subject, html_body) to populate here.

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================================================
-- 2. FIX sync_registration_on_payment RPC - no email outbox
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.sync_registration_on_payment(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_participant_id uuid;
  v_registration_id uuid;
  v_org_id uuid;
  v_event_name text;
  v_ticket_count integer;
  v_existing_registration_id uuid;
BEGIN
  -- 1. Fetch order with event info
  SELECT o.*, e.org_id, e.name as event_name, e.id as event_id
  INTO v_order
  FROM public.orders o
  JOIN public.events e ON e.id = o.event_id
  WHERE o.id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND');
  END IF;

  IF v_order.status != 'paid' THEN
    RETURN jsonb_build_object('error', 'ORDER_NOT_PAID', 'status', v_order.status);
  END IF;

  v_org_id := v_order.org_id;
  v_event_name := v_order.event_name;

  -- 2. Check if registration already exists via any order_item (idempotency)
  SELECT r.id INTO v_existing_registration_id
  FROM public.registrations r
  JOIN public.order_items oi ON oi.id = r.order_item_id
  WHERE oi.order_id = p_order_id
  LIMIT 1;

  IF v_existing_registration_id IS NOT NULL THEN
    -- Already synced, return existing data
    SELECT p.id INTO v_participant_id
    FROM registrations r
    JOIN participants p ON p.id = r.participant_id
    WHERE r.id = v_existing_registration_id;

    SELECT COUNT(*) INTO v_ticket_count
    FROM ticket_instances WHERE order_id = p_order_id;

    RETURN jsonb_build_object(
      'status', 'ALREADY_SYNCED',
      'registration_id', v_existing_registration_id,
      'participant_id', v_participant_id,
      'ticket_count', v_ticket_count
    );
  END IF;

  -- 3. Upsert participant by email
  INSERT INTO public.participants (email, first_name, last_name, user_id)
  VALUES (
    v_order.email,
    COALESCE((v_order.metadata->>'first_name')::text, split_part(v_order.email, '@', 1)),
    COALESCE((v_order.metadata->>'last_name')::text, ''),
    v_order.user_id
  )
  ON CONFLICT (email) WHERE deleted_at IS NULL
  DO UPDATE SET
    user_id = COALESCE(participants.user_id, EXCLUDED.user_id),
    updated_at = now()
  RETURNING id INTO v_participant_id;

  -- If participant wasn't returned, get by email
  IF v_participant_id IS NULL THEN
    SELECT id INTO v_participant_id
    FROM participants WHERE email = v_order.email AND deleted_at IS NULL;
  END IF;

  -- 4. Create registrations for each order item
  FOR v_registration_id IN
    INSERT INTO public.registrations (event_id, participant_id, ticket_type_id, order_item_id, status)
    SELECT v_order.event_id, v_participant_id, oi.ticket_type_id, oi.id, 'confirmed'
    FROM order_items oi
    WHERE oi.order_id = p_order_id
      AND oi.ticket_type_id IS NOT NULL
    ON CONFLICT (order_item_id) WHERE deleted_at IS NULL AND order_item_id IS NOT NULL
    DO UPDATE SET status = 'confirmed', updated_at = now()
    RETURNING id
  LOOP
    v_existing_registration_id := v_registration_id; -- Keep last one
  END LOOP;

  -- 5. Link all ticket_instances to participant
  UPDATE public.ticket_instances
  SET participant_id = v_participant_id
  WHERE order_id = p_order_id
    AND participant_id IS NULL;

  GET DIAGNOSTICS v_ticket_count = ROW_COUNT;

  -- 6. Audit log with ALL required columns (wrapped in exception handler)
  BEGIN
    INSERT INTO public.audit_log (
      org_id,
      actor_user_id,
      action,
      entity_type,
      entity_id,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      v_org_id,
      COALESCE(v_order.user_id, '00000000-0000-0000-0000-000000000000'::uuid),
      'REGISTRATION_SYNCED',
      'registration',
      COALESCE(v_existing_registration_id, gen_random_uuid()),
      'registration',
      COALESCE(v_existing_registration_id, gen_random_uuid()),
      jsonb_build_object(
        'order_id', p_order_id,
        'participant_id', v_participant_id,
        'tickets_linked', v_ticket_count,
        'source', 'manual_rpc'
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Non-fatal: audit log failure should not block sync
    NULL;
  END;

  -- NOTE: Email confirmation is handled by the calling Edge Function,
  -- not by this RPC. The email_outbox table has too many required fields.

  RETURN jsonb_build_object(
    'status', 'SYNCED',
    'participant_id', v_participant_id,
    'registration_id', v_existing_registration_id,
    'tickets_linked', v_ticket_count
  );
END;
$$;

-- ===========================================================================
-- 3. VERIFY
-- ===========================================================================

DO $$
BEGIN
  RAISE NOTICE 'F006 Fix: Removed email_outbox from triggers (handled by Edge Functions)';
END $$;
