-- ===========================================================================
-- F001: User Registration Enhancements
-- Migration: 20250128130000_f001_registration_enhancements.sql
--
-- Purpose:
-- - Add participant_id to ticket_instances for ticket ownership
-- - Add outbox event creation to registration sync trigger
-- - Add explicit RPC for manual sync invocation
-- ===========================================================================

-- ===========================================================================
-- 1. ADD participant_id TO ticket_instances
-- ===========================================================================

ALTER TABLE ticket_instances 
  ADD COLUMN IF NOT EXISTS participant_id uuid 
    REFERENCES public.participants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ticket_instances_participant_id
  ON ticket_instances(participant_id) 
  WHERE participant_id IS NOT NULL;

COMMENT ON COLUMN ticket_instances.participant_id IS
  'Links ticket to the participant who owns it (set during registration sync)';

-- ===========================================================================
-- 2. UPDATE TRIGGER: Add outbox event + ticket linking
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

      -- Get org_id and event name for outbox
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
      ON CONFLICT ON CONSTRAINT idx_participants_email_unique
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
      ON CONFLICT ON CONSTRAINT idx_registrations_order_item_unique
      DO UPDATE SET
        status = 'confirmed',
        updated_at = NOW()
      RETURNING id INTO v_registration_id;

      -- Track first registration for outbox
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

      -- 4. Audit log (idempotent via unique or ON CONFLICT)
      INSERT INTO audit_log (
        org_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
      )
      VALUES (
        v_org_id,
        COALESCE(NEW.user_id, '00000000-0000-0000-0000-000000000000'::uuid),
        'REGISTRATION_CREATED_FROM_ORDER',
        'registration',
        v_registration_id,
        jsonb_build_object(
          'order_id', NEW.id,
          'order_item_id', v_item.order_item_id,
          'participant_id', v_participant_id,
          'participant_email', NEW.email
        )
      )
      ON CONFLICT DO NOTHING;

    END LOOP;

    -- 5. Queue confirmation email via outbox (once per order, not per item)
    IF v_first_registration_id IS NOT NULL AND v_org_id IS NOT NULL THEN
      INSERT INTO email_outbox (
        org_id,
        to_email,
        to_name,
        email_type,
        template_key,
        template_data,
        idempotency_key,
        priority
      ) VALUES (
        v_org_id,
        NEW.email,
        COALESCE((NEW.metadata->>'first_name')::text, split_part(NEW.email, '@', 1)),
        'transactional',
        'order_confirmation',
        jsonb_build_object(
          'order_id', NEW.id,
          'registration_id', v_first_registration_id,
          'event_name', v_event_name,
          'ticket_count', v_ticket_count,
          'total_amount', NEW.total_amount,
          'currency', NEW.currency
        ),
        'order_confirmation_' || NEW.id::text,
        'high'
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Ensure trigger exists
DROP TRIGGER IF EXISTS sync_registration_on_order_paid_trigger ON orders;
CREATE TRIGGER sync_registration_on_order_paid_trigger
AFTER UPDATE ON orders
FOR EACH ROW
EXECUTE FUNCTION sync_registration_on_order_paid();

COMMENT ON FUNCTION sync_registration_on_order_paid IS
  'Automatically creates participant, registration records, links tickets, and queues confirmation email when order is paid. Idempotent.';

-- ===========================================================================
-- 3. EXPLICIT RPC: sync_registration_on_payment
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
  ON CONFLICT ON CONSTRAINT idx_participants_email_unique
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
    ON CONFLICT ON CONSTRAINT idx_registrations_order_item_unique
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
  
  -- 6. Queue confirmation email via outbox (idempotent)
  INSERT INTO public.email_outbox (
    org_id,
    to_email,
    to_name,
    email_type,
    template_key,
    template_data,
    idempotency_key,
    priority
  ) VALUES (
    v_org_id,
    v_order.email,
    COALESCE((v_order.metadata->>'first_name')::text, 'Guest'),
    'transactional',
    'order_confirmation',
    jsonb_build_object(
      'order_id', p_order_id,
      'registration_id', v_existing_registration_id,
      'event_name', v_event_name,
      'ticket_count', v_ticket_count
    ),
    'order_confirmation_' || p_order_id::text,
    'high'
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
  
  -- 7. Audit log
  INSERT INTO public.audit_log (
    org_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) VALUES (
    v_org_id,
    v_order.user_id,
    'REGISTRATION_SYNCED',
    'registration',
    v_existing_registration_id,
    jsonb_build_object(
      'order_id', p_order_id,
      'participant_id', v_participant_id,
      'tickets_linked', v_ticket_count,
      'source', 'manual_rpc'
    )
  );
  
  RETURN jsonb_build_object(
    'status', 'SYNCED',
    'participant_id', v_participant_id,
    'registration_id', v_existing_registration_id,
    'tickets_linked', v_ticket_count
  );
END;
$$;

COMMENT ON FUNCTION sync_registration_on_payment IS
  'Manually sync registration for a paid order. Idempotent - safe to call multiple times.';

GRANT EXECUTE ON FUNCTION sync_registration_on_payment TO authenticated;
GRANT EXECUTE ON FUNCTION sync_registration_on_payment TO service_role;

-- ===========================================================================
-- 4. VERIFY
-- ===========================================================================

DO $$
BEGIN
  RAISE NOTICE 'F001 Registration Enhancements migration complete:';
  RAISE NOTICE '  - ticket_instances.participant_id column added';
  RAISE NOTICE '  - sync_registration_on_order_paid trigger updated with outbox + ticket linking';
  RAISE NOTICE '  - sync_registration_on_payment RPC created for manual invocation';
END $$;

