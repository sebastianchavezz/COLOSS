-- ===========================================================================
-- F006 Fix: Correct ON CONFLICT syntax in sync_registration_on_order_paid
-- ===========================================================================
-- Problem: ON CONFLICT ON CONSTRAINT only works with actual constraints,
--          not with indexes. idx_participants_email_unique is an index.
-- Solution: Use ON CONFLICT (column) WHERE condition syntax instead.
-- ===========================================================================

-- Recreate the trigger function with correct syntax
CREATE OR REPLACE FUNCTION sync_registration_on_order_paid()
RETURNS TRIGGER AS $$
DECLARE
  v_item RECORD;
  v_participant_id UUID;
  v_registration_id UUID;
  v_event_id UUID;
  v_org_id UUID;
BEGIN
  -- Only trigger on status change to 'paid'
  IF NEW.status = 'paid' AND (OLD IS NULL OR OLD.status IS DISTINCT FROM 'paid') THEN

    -- Loop through order items with ticket types
    FOR v_item IN
      SELECT
        oi.id as order_item_id,
        oi.ticket_type_id,
        tt.event_id
      FROM order_items oi
      JOIN ticket_types tt ON tt.id = oi.ticket_type_id
      WHERE oi.order_id = NEW.id
        AND oi.ticket_type_id IS NOT NULL
    LOOP
      v_event_id := v_item.event_id;

      -- Get org_id for audit log
      SELECT e.org_id INTO v_org_id FROM events e WHERE e.id = v_event_id;

      -- 1. Upsert participant by email (idempotent)
      -- Use column-based ON CONFLICT syntax for unique index
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
      -- Also fix: use column-based ON CONFLICT
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

      -- 3. Audit log (idempotent check via unique)
      -- Note: audit_log requires both entity_type/entity_id AND resource_type/resource_id
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
        v_registration_id,
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

    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Verify
DO $$
BEGIN
  RAISE NOTICE '✓ F006 Fix: sync_registration_on_order_paid trigger syntax corrected';
END $$;
