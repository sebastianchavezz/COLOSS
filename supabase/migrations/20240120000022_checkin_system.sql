-- SPRINT 8: CHECK-IN SYSTEM
-- Migration: 20240120000022_checkin_system.sql

-- ========================================================
-- 1. ALTER ticket_instances: Add check-in columns
-- ========================================================

ALTER TABLE public.ticket_instances
    ADD COLUMN IF NOT EXISTS checked_in_at timestamptz,
    ADD COLUMN IF NOT EXISTS checked_in_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ========================================================
-- 2. Handle status enum/constraint for 'checked_in'
-- ========================================================

-- If status is an enum type, add 'checked_in' value safely
DO $$
BEGIN
    -- Try to add enum value if status column is an enum type
    IF EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        JOIN pg_attribute a ON a.atttypid = t.oid
        JOIN pg_class c ON c.oid = a.attrelid
        WHERE c.relname = 'ticket_instances'
        AND a.attname = 'status'
        AND t.typtype = 'e'
    ) THEN
        -- status is an enum
        ALTER TYPE ticket_instance_status ADD VALUE IF NOT EXISTS 'checked_in';
    END IF;
END $$;

-- If status is text, ensure CHECK constraint allows 'checked_in'
-- (This is safe even if status is enum)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ticket_instances_status_check'
        AND conrelid = 'public.ticket_instances'::regclass
    ) THEN
        -- Only add if no constraint exists
        ALTER TABLE public.ticket_instances
        ADD CONSTRAINT ticket_instances_status_check
        CHECK (status::text IN ('draft', 'issued', 'used', 'voided', 'transferred', 'checked_in', 'cancelled'));
    END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ========================================================
-- 3. Index for check-in queries
-- ========================================================

CREATE INDEX IF NOT EXISTS idx_ticket_instances_qr_event
    ON public.ticket_instances(qr_code, event_id)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ticket_instances_checkin
    ON public.ticket_instances(event_id, checked_in_at)
    WHERE checked_in_at IS NOT NULL;

-- ========================================================
-- 4. RPC: check_in_ticket (ATOMIC & IDEMPOTENT)
-- ========================================================

CREATE OR REPLACE FUNCTION public.check_in_ticket(
    _event_id uuid,
    _qr_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _ticket record;
    _org_id uuid;
    _user_role text;
    _result jsonb;
BEGIN
    -- 1. Auth check: get caller's role for the event's org
    SELECT e.org_id INTO _org_id
    FROM public.events e
    WHERE e.id = _event_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'event_not_found'
        );
    END IF;

    -- Check if caller is org member
    SELECT om.role INTO _user_role
    FROM public.org_members om
    WHERE om.org_id = _org_id
    AND om.user_id = auth.uid();

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'forbidden',
            'message', 'Not an org member'
        );
    END IF;

    -- Block finance role
    IF _user_role = 'finance' THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'forbidden',
            'message', 'Finance role cannot check-in tickets'
        );
    END IF;

    -- 2. Find and lock ticket (atomic)
    SELECT 
        ti.id,
        ti.event_id,
        ti.ticket_type_id,
        ti.owner_user_id,
        ti.status,
        ti.checked_in_at,
        ti.checked_in_by,
        ti.qr_code
    INTO _ticket
    FROM public.ticket_instances ti
    WHERE ti.qr_code = _qr_code
    AND ti.deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'not_found',
            'message', 'Ticket not found or deleted'
        );
    END IF;

    -- 3. Validate event match
    IF _ticket.event_id != _event_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'wrong_event',
            'message', 'Ticket is for a different event',
            'ticket_event_id', _ticket.event_id,
            'expected_event_id', _event_id
        );
    END IF;

    -- 4. Idempotency check: already checked in?
    IF _ticket.checked_in_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'reason', 'already_checked_in',
            'message', 'Ticket already checked in',
            'ticket_instance_id', _ticket.id,
            'checked_in_at', _ticket.checked_in_at,
            'checked_in_by', _ticket.checked_in_by,
            'owner_user_id', _ticket.owner_user_id,
            'ticket_type_id', _ticket.ticket_type_id
        );
    END IF;

    -- 5. Validate status (must be 'issued' or similar)
    IF _ticket.status::text NOT IN ('issued', 'draft') THEN
        RETURN jsonb_build_object(
            'success', false,
            'reason', 'invalid_status',
            'message', 'Ticket status must be issued',
            'current_status', _ticket.status
        );
    END IF;

    -- 6. Perform check-in (atomic update)
    UPDATE public.ticket_instances
    SET 
        checked_in_at = now(),
        checked_in_by = auth.uid(),
        status = 'checked_in',
        updated_at = now()
    WHERE id = _ticket.id;

    -- 7. Audit log
    INSERT INTO public.audit_log (
        org_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        before_state,
        after_state,
        metadata
    ) VALUES (
        _org_id,
        auth.uid(),
        'TICKET_CHECKED_IN',
        'ticket_instance',
        _ticket.id,
        jsonb_build_object('status', _ticket.status, 'checked_in_at', null),
        jsonb_build_object('status', 'checked_in', 'checked_in_at', now()),
        jsonb_build_object(
            'event_id', _event_id,
            'qr_code_hash', LEFT(encode(digest(_qr_code, 'sha256'), 'hex'), 16)
        )
    );

    -- 8. Return success
    RETURN jsonb_build_object(
        'success', true,
        'reason', 'ok',
        'message', 'Ticket checked in successfully',
        'ticket_instance_id', _ticket.id,
        'checked_in_at', now(),
        'checked_in_by', auth.uid(),
        'owner_user_id', _ticket.owner_user_id,
        'ticket_type_id', _ticket.ticket_type_id
    );
END;
$$;

COMMENT ON FUNCTION public.check_in_ticket IS
    'Atomic check-in with row locking. Idempotent (returns existing check-in if already done). Blocks finance role.';

-- ========================================================
-- 5. RLS Policies (if needed)
-- ========================================================

-- ticket_instances RLS should already exist from previous sprints
-- Ensure org members can view checked-in tickets
DROP POLICY IF EXISTS "Org members view event tickets" ON public.ticket_instances;
CREATE POLICY "Org members view event tickets" ON public.ticket_instances
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.events e
            WHERE e.id = ticket_instances.event_id
            AND public.is_org_member(e.org_id)
        )
    );

-- Note: RPC is SECURITY DEFINER so it bypasses RLS
-- Role check is inside the function body
