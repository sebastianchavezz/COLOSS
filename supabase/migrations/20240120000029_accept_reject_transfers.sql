-- Migration: 20240120000029_accept_reject_transfers.sql
-- Implement Accept and Reject flows for ticket transfers

-- ========================================================
-- 1. Add 'rejected' to transfer_status enum (if not exists)
-- ========================================================
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'rejected' 
        AND enumtypid = 'public.transfer_status'::regtype
    ) THEN
        ALTER TYPE public.transfer_status ADD VALUE 'rejected';
        RAISE NOTICE 'Added rejected to transfer_status enum';
    END IF;
END $$;

-- ========================================================
-- 2. Ensure rejected_by_user_id column exists
-- ========================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'ticket_transfers' 
        AND column_name = 'rejected_by_user_id'
    ) THEN
        ALTER TABLE public.ticket_transfers 
        ADD COLUMN rejected_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
        RAISE NOTICE 'Added rejected_by_user_id column';
    END IF;
END $$;


-- ========================================================
-- 3. RPC: Accept Ticket Transfer
-- ========================================================
DROP FUNCTION IF EXISTS public.accept_ticket_transfer(uuid);

CREATE OR REPLACE FUNCTION public.accept_ticket_transfer(_transfer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _transfer record;
    _updated_count int;
    _ticket_owner_user_id uuid;
BEGIN
    -- 1. Get the transfer with row lock
    SELECT * INTO _transfer 
    FROM public.ticket_transfers 
    WHERE id = _transfer_id
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transfer not found: %', _transfer_id
            USING ERRCODE = 'P0002';
    END IF;

    -- 2. Idempotency check: if already accepted, return current state
    IF _transfer.status = 'accepted' THEN
        RETURN jsonb_build_object(
            'success', true,
            'updated', 0,
            'transfer_id', _transfer_id,
            'new_status', 'accepted',
            'message', 'Transfer already accepted'
        );
    END IF;

    -- 3. Validate status is pending
    IF _transfer.status != 'pending' THEN
        RAISE EXCEPTION 'Cannot accept: transfer status is %, expected pending', _transfer.status
            USING ERRCODE = '23514';
    END IF;

    -- 4. Authorization: current user must be recipient OR org member
    -- Check if user is the intended recipient (by email or participant)
    IF NOT (
        -- User's email matches to_email
        EXISTS (
            SELECT 1 FROM auth.users 
            WHERE id = auth.uid() 
            AND email = _transfer.to_email
        )
        -- OR user is linked to to_participant
        OR EXISTS (
            SELECT 1 FROM public.participants
            WHERE id = _transfer.to_participant_id
            AND user_id = auth.uid()
        )
        -- OR user is org admin/support (override)
        OR EXISTS (
            SELECT 1 FROM public.org_members
            WHERE org_id = _transfer.org_id
            AND user_id = auth.uid()
            AND role IN ('owner', 'admin', 'support')
        )
    ) THEN
        RAISE EXCEPTION 'Not authorized: you are not the recipient or an org admin'
            USING ERRCODE = '42501';
    END IF;

    -- 5. Perform ticket ownership transfer
    -- Get current ticket owner
    SELECT owner_user_id INTO _ticket_owner_user_id
    FROM public.ticket_instances
    WHERE id = _transfer.ticket_instance_id;

    -- Update ticket ownership to current user
    UPDATE public.ticket_instances
    SET 
        owner_user_id = auth.uid(),
        updated_at = now()
    WHERE id = _transfer.ticket_instance_id;

    -- 6. Update transfer record
    UPDATE public.ticket_transfers
    SET 
        status = 'accepted',
        accepted_at = now(),
        accepted_by_user_id = auth.uid(),
        to_participant_id = COALESCE(to_participant_id, (
            SELECT id FROM public.participants 
            WHERE user_id = auth.uid() 
            AND id IN (SELECT participant_id FROM public.registrations WHERE event_id = _transfer.event_id)
            LIMIT 1
        )),
        updated_at = now()
    WHERE id = _transfer_id
    AND status = 'pending';

    GET DIAGNOSTICS _updated_count = ROW_COUNT;

    IF _updated_count = 0 THEN
        RAISE EXCEPTION 'Accept failed: race condition detected'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'updated', _updated_count,
        'transfer_id', _transfer_id,
        'new_status', 'accepted',
        'previous_owner', _ticket_owner_user_id,
        'new_owner', auth.uid()
    );
END;
$$;

COMMENT ON FUNCTION public.accept_ticket_transfer IS 
    'Accepts a pending ticket transfer and transfers ownership. Idempotent.';


-- ========================================================
-- 4. RPC: Reject Ticket Transfer
-- ========================================================
DROP FUNCTION IF EXISTS public.reject_ticket_transfer(uuid);

CREATE OR REPLACE FUNCTION public.reject_ticket_transfer(_transfer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _transfer record;
    _updated_count int;
BEGIN
    -- 1. Get the transfer with row lock
    SELECT * INTO _transfer 
    FROM public.ticket_transfers 
    WHERE id = _transfer_id
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transfer not found: %', _transfer_id
            USING ERRCODE = 'P0002';
    END IF;

    -- 2. Idempotency check
    IF _transfer.status = 'rejected' THEN
        RETURN jsonb_build_object(
            'success', true,
            'updated', 0,
            'transfer_id', _transfer_id,
            'new_status', 'rejected',
            'message', 'Transfer already rejected'
        );
    END IF;

    -- 3. Validate status is pending
    IF _transfer.status != 'pending' THEN
        RAISE EXCEPTION 'Cannot reject: transfer status is %, expected pending', _transfer.status
            USING ERRCODE = '23514';
    END IF;

    -- 4. Authorization: same as accept
    IF NOT (
        EXISTS (
            SELECT 1 FROM auth.users 
            WHERE id = auth.uid() 
            AND email = _transfer.to_email
        )
        OR EXISTS (
            SELECT 1 FROM public.participants
            WHERE id = _transfer.to_participant_id
            AND user_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM public.org_members
            WHERE org_id = _transfer.org_id
            AND user_id = auth.uid()
            AND role IN ('owner', 'admin', 'support')
        )
    ) THEN
        RAISE EXCEPTION 'Not authorized: you are not the recipient or an org admin'
            USING ERRCODE = '42501';
    END IF;

    -- 5. Update transfer record (no ownership change)
    UPDATE public.ticket_transfers
    SET 
        status = 'rejected',
        rejected_at = now(),
        rejected_by_user_id = auth.uid(),
        updated_at = now()
    WHERE id = _transfer_id
    AND status = 'pending';

    GET DIAGNOSTICS _updated_count = ROW_COUNT;

    IF _updated_count = 0 THEN
        RAISE EXCEPTION 'Reject failed: race condition detected'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'updated', _updated_count,
        'transfer_id', _transfer_id,
        'new_status', 'rejected'
    );
END;
$$;

COMMENT ON FUNCTION public.reject_ticket_transfer IS 
    'Rejects a pending ticket transfer. Idempotent.';

-- ========================================================
-- 5. Update Audit Trigger (add REJECTED)
-- ========================================================
CREATE OR REPLACE FUNCTION public.audit_transfer_change()
RETURNS TRIGGER AS $$
DECLARE
    _actor_id uuid;
    _action text;
BEGIN
    IF (TG_OP = 'INSERT') THEN
        _actor_id := COALESCE(NEW.initiated_by_user_id, auth.uid());
        _action := 'TRANSFER_INITIATED';
    ELSIF (TG_OP = 'UPDATE' AND OLD.status != NEW.status) THEN
        CASE NEW.status
            WHEN 'accepted' THEN
                _actor_id := COALESCE(NEW.accepted_by_user_id, auth.uid());
                _action := 'TRANSFER_ACCEPTED';
            WHEN 'rejected' THEN
                _actor_id := COALESCE(NEW.rejected_by_user_id, auth.uid());
                _action := 'TRANSFER_REJECTED';
            WHEN 'cancelled' THEN
                _actor_id := COALESCE(NEW.cancelled_by_user_id, auth.uid());
                _action := 'TRANSFER_CANCELLED';
            WHEN 'expired' THEN
                _actor_id := auth.uid();
                _action := 'TRANSFER_EXPIRED';
            ELSE
                _actor_id := auth.uid();
                _action := 'TRANSFER_STATUS_CHANGED';
        END CASE;
    ELSE
        RETURN NEW;
    END IF;

    INSERT INTO public.audit_log (
        org_id, actor_user_id, action, resource_type, resource_id,
        entity_type, entity_id, before_state, after_state, metadata
    ) VALUES (
        NEW.org_id, _actor_id, _action, 'event', NEW.event_id,
        'ticket_transfer', NEW.id,
        CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('status', OLD.status) ELSE NULL END,
        jsonb_build_object('status', NEW.status),
        jsonb_build_object(
            'ticket_instance_id', NEW.ticket_instance_id,
            'to_email', NEW.to_email,
            'from_participant_id', NEW.from_participant_id,
            'to_participant_id', NEW.to_participant_id
        )
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
