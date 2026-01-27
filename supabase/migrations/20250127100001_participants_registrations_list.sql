-- ===========================================================================
-- SPRINT F011: Participants/Registrations List + Filters + Export
-- Migration: 20250127100001_participants_registrations_list.sql
--
-- Purpose:
-- - Create registrations_list_v view for efficient filtering
-- - Add trigger to sync registrations on order paid
-- - Add RPC functions for list, detail, and export
-- - Idempotent registration creation with audit logging
-- ===========================================================================

-- ===========================================================================
-- 1. ADD MISSING COLUMNS
-- ===========================================================================

-- Add order_item_id to ticket_instances for proper linking
ALTER TABLE ticket_instances ADD COLUMN IF NOT EXISTS order_item_id UUID
  REFERENCES order_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ticket_instances_order_item_id
  ON ticket_instances(order_item_id) WHERE order_item_id IS NOT NULL;

-- Add unique constraint on registrations.order_item_id for idempotency
-- First, check if there's already such an index
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_registrations_order_item_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_registrations_order_item_unique
      ON registrations(order_item_id)
      WHERE order_item_id IS NOT NULL AND deleted_at IS NULL;
  END IF;
END $$;

-- Add unique index on participants(email) for upsert capability
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_participants_email_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_participants_email_unique
      ON participants(email)
      WHERE deleted_at IS NULL;
  END IF;
END $$;

-- Add metadata column to orders if not exists (for first/last name)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Add discount_amount column if not exists (may have been added in another migration)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10, 2) DEFAULT 0;

-- ===========================================================================
-- 2. CREATE VIEW: registrations_list_v
-- ===========================================================================

DROP VIEW IF EXISTS registrations_list_v CASCADE;

CREATE VIEW registrations_list_v AS
SELECT
  r.id,
  r.event_id,
  r.participant_id,
  r.status as registration_status,
  r.ticket_type_id,
  r.order_item_id,
  r.bib_number,
  r.created_at,
  r.updated_at,
  -- Participant data
  p.email,
  p.first_name,
  p.last_name,
  p.phone,
  p.birth_date,
  p.gender,
  p.country,
  -- Ticket Type
  tt.name as ticket_type_name,
  tt.price as ticket_type_price,
  -- Order via order_item
  oi.order_id,
  o.status as order_status,
  o.total_amount as order_total,
  COALESCE(o.discount_amount, 0) as discount_amount,
  CASE
    WHEN o.status = 'paid' THEN 'paid'
    WHEN o.status = 'refunded' THEN 'refunded'
    WHEN o.status = 'cancelled' THEN 'cancelled'
    ELSE 'unpaid'
  END as payment_status,
  COALESCE(o.discount_amount > 0, false) as has_discount,
  -- Ticket Instance
  ti.id as ticket_instance_id,
  ti.qr_code,
  ti.status as ticket_status,
  ti.checked_in_at,
  CASE WHEN ti.id IS NOT NULL THEN 'assigned' ELSE 'unassigned' END as assignment_status,
  -- Event org_id for RLS
  e.org_id
FROM registrations r
JOIN participants p ON p.id = r.participant_id
JOIN events e ON e.id = r.event_id
LEFT JOIN ticket_types tt ON tt.id = r.ticket_type_id
LEFT JOIN order_items oi ON oi.id = r.order_item_id
LEFT JOIN orders o ON o.id = oi.order_id
LEFT JOIN ticket_instances ti ON ti.order_item_id = r.order_item_id
  AND ti.deleted_at IS NULL
WHERE r.deleted_at IS NULL;

-- Enable security invoker so RLS is applied
ALTER VIEW registrations_list_v SET (security_invoker = true);

COMMENT ON VIEW registrations_list_v IS
  'Prejoined view for efficient registration list queries with filters. Uses security_invoker for RLS.';

-- ===========================================================================
-- 3. TRIGGER: sync_registration_on_order_paid
-- ===========================================================================

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

      -- 3. Audit log (idempotent check via unique)
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
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS sync_registration_on_order_paid_trigger ON orders;
CREATE TRIGGER sync_registration_on_order_paid_trigger
AFTER UPDATE ON orders
FOR EACH ROW
EXECUTE FUNCTION sync_registration_on_order_paid();

COMMENT ON FUNCTION sync_registration_on_order_paid IS
  'Automatically creates participant and registration records when an order is marked as paid. Idempotent.';

-- ===========================================================================
-- 4. RPC: get_registrations_list
-- ===========================================================================

CREATE OR REPLACE FUNCTION get_registrations_list(
  _event_id UUID,
  _filters JSONB DEFAULT '{}',
  _page INTEGER DEFAULT 1,
  _page_size INTEGER DEFAULT 50,
  _sort_by TEXT DEFAULT 'created_at',
  _sort_order TEXT DEFAULT 'desc'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_offset INTEGER;
  v_total INTEGER;
  v_data JSONB;
BEGIN
  -- 1. Verify org membership
  SELECT e.org_id INTO v_org_id
  FROM events e
  WHERE e.id = _event_id;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('error', 'EVENT_NOT_FOUND');
  END IF;

  IF NOT public.is_org_member(v_org_id) THEN
    RETURN jsonb_build_object('error', 'UNAUTHORIZED');
  END IF;

  -- 2. Calculate offset
  v_offset := GREATEST((_page - 1) * _page_size, 0);

  -- Ensure valid page_size
  _page_size := LEAST(GREATEST(_page_size, 1), 200);

  -- 3. Query with filters
  WITH filtered AS (
    SELECT *
    FROM registrations_list_v
    WHERE event_id = _event_id
      -- Filters
      AND ((_filters->>'ticket_type_id') IS NULL
           OR ticket_type_id = (_filters->>'ticket_type_id')::uuid)
      AND ((_filters->>'registration_status') IS NULL
           OR registration_status::text = (_filters->>'registration_status'))
      AND ((_filters->>'payment_status') IS NULL
           OR payment_status = (_filters->>'payment_status'))
      AND ((_filters->>'assignment_status') IS NULL
           OR assignment_status = (_filters->>'assignment_status'))
      AND ((_filters->>'search') IS NULL OR (
           email ILIKE '%' || (_filters->>'search') || '%'
           OR first_name ILIKE '%' || (_filters->>'search') || '%'
           OR last_name ILIKE '%' || (_filters->>'search') || '%'))
  ),
  counted AS (
    SELECT COUNT(*)::integer as total FROM filtered
  ),
  sorted AS (
    SELECT * FROM filtered
    ORDER BY
      CASE WHEN _sort_order = 'asc' AND _sort_by = 'created_at' THEN filtered.created_at END ASC NULLS LAST,
      CASE WHEN _sort_order = 'desc' AND _sort_by = 'created_at' THEN filtered.created_at END DESC NULLS LAST,
      CASE WHEN _sort_order = 'asc' AND _sort_by = 'email' THEN filtered.email END ASC NULLS LAST,
      CASE WHEN _sort_order = 'desc' AND _sort_by = 'email' THEN filtered.email END DESC NULLS LAST,
      CASE WHEN _sort_order = 'asc' AND _sort_by = 'last_name' THEN filtered.last_name END ASC NULLS LAST,
      CASE WHEN _sort_order = 'desc' AND _sort_by = 'last_name' THEN filtered.last_name END DESC NULLS LAST,
      filtered.created_at DESC -- Default fallback
    LIMIT _page_size
    OFFSET v_offset
  )
  SELECT
    c.total,
    COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  INTO v_total, v_data
  FROM counted c
  LEFT JOIN sorted s ON true
  GROUP BY c.total;

  RETURN jsonb_build_object(
    'total', COALESCE(v_total, 0),
    'page', _page,
    'page_size', _page_size,
    'pages', CEIL(COALESCE(v_total, 0)::numeric / _page_size),
    'data', COALESCE(v_data, '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION get_registrations_list IS
  'Returns paginated and filtered list of registrations for an event. Requires org membership.';

-- Grant execute to authenticated
GRANT EXECUTE ON FUNCTION get_registrations_list TO authenticated;

-- ===========================================================================
-- 5. RPC: get_registration_detail
-- ===========================================================================

CREATE OR REPLACE FUNCTION get_registration_detail(_registration_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_registration JSONB;
  v_answers JSONB;
BEGIN
  -- 1. Get registration and verify org membership
  SELECT e.org_id INTO v_org_id
  FROM registrations r
  JOIN events e ON e.id = r.event_id
  WHERE r.id = _registration_id;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('error', 'REGISTRATION_NOT_FOUND');
  END IF;

  IF NOT public.is_org_member(v_org_id) THEN
    RETURN jsonb_build_object('error', 'UNAUTHORIZED');
  END IF;

  -- 2. Get registration data
  SELECT to_jsonb(rl) INTO v_registration
  FROM registrations_list_v rl
  WHERE rl.id = _registration_id;

  -- 3. Get registration answers
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'question_id', ra.question_id,
    'question_label', rq.label,
    'answer_value', ra.answer_value
  )), '[]'::jsonb) INTO v_answers
  FROM registration_answers ra
  JOIN registration_questions rq ON rq.id = ra.question_id
  WHERE ra.registration_id = _registration_id;

  RETURN jsonb_build_object(
    'registration', v_registration,
    'answers', v_answers
  );
END;
$$;

COMMENT ON FUNCTION get_registration_detail IS
  'Returns detailed registration info including answers. Requires org membership.';

GRANT EXECUTE ON FUNCTION get_registration_detail TO authenticated;

-- ===========================================================================
-- 6. RPC: export_registrations_csv
-- ===========================================================================

CREATE OR REPLACE FUNCTION export_registrations_csv(
  _event_id UUID,
  _filters JSONB DEFAULT '{}'
)
RETURNS TABLE (csv_row TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_role TEXT;
  v_max_rows INTEGER;
BEGIN
  -- 1. Verify org membership + role
  SELECT e.org_id INTO v_org_id FROM events e WHERE e.id = _event_id;

  SELECT om.role INTO v_role
  FROM org_members om
  WHERE om.org_id = v_org_id AND om.user_id = auth.uid();

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: not an org member';
  END IF;

  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'UNAUTHORIZED: admin role required for export';
  END IF;

  -- 2. Get max rows from config (default 10000)
  v_max_rows := 10000;

  -- 3. Return CSV header
  RETURN QUERY SELECT 'email,first_name,last_name,ticket_type,registration_status,payment_status,assignment_status,has_discount,created_at'::text;

  -- 4. Return data rows
  RETURN QUERY
  SELECT
    format('%s,%s,%s,%s,%s,%s,%s,%s,%s',
      COALESCE(quote_literal(rl.email), ''),
      COALESCE(quote_literal(rl.first_name), ''),
      COALESCE(quote_literal(rl.last_name), ''),
      COALESCE(quote_literal(rl.ticket_type_name), ''),
      COALESCE(rl.registration_status::text, ''),
      COALESCE(rl.payment_status, ''),
      COALESCE(rl.assignment_status, ''),
      COALESCE(rl.has_discount::text, 'false'),
      COALESCE(to_char(rl.created_at, 'YYYY-MM-DD HH24:MI:SS'), '')
    )
  FROM registrations_list_v rl
  WHERE rl.event_id = _event_id
    AND ((_filters->>'ticket_type_id') IS NULL
         OR rl.ticket_type_id = (_filters->>'ticket_type_id')::uuid)
    AND ((_filters->>'registration_status') IS NULL
         OR rl.registration_status::text = (_filters->>'registration_status'))
    AND ((_filters->>'payment_status') IS NULL
         OR rl.payment_status = (_filters->>'payment_status'))
    AND ((_filters->>'search') IS NULL
         OR rl.email ILIKE '%' || (_filters->>'search') || '%')
  ORDER BY rl.created_at DESC
  LIMIT v_max_rows;
END;
$$;

COMMENT ON FUNCTION export_registrations_csv IS
  'Exports registrations as CSV rows. Requires admin role.';

GRANT EXECUTE ON FUNCTION export_registrations_csv TO authenticated;

-- ===========================================================================
-- 7. INDEXES FOR PERFORMANCE
-- ===========================================================================

CREATE INDEX IF NOT EXISTS idx_registrations_event_status
  ON registrations(event_id, status);

CREATE INDEX IF NOT EXISTS idx_registrations_participant_id
  ON registrations(participant_id);

CREATE INDEX IF NOT EXISTS idx_orders_status
  ON orders(status);

-- ===========================================================================
-- END MIGRATION
-- ===========================================================================
