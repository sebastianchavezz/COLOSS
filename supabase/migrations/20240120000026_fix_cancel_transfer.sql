-- Migration: 20240120000026_fix_cancel_transfer.sql
-- Fix: cancel_ticket_transfer was returning success:true without updating rows
-- Root cause: SECURITY INVOKER + missing UPDATE RLS policy = 0 rows affected
-- Solution: Use SECURITY DEFINER with internal authorization + row count check

-- ========================================================
-- 1. Drop and recreate cancel_ticket_transfer RPC
-- ========================================================
DROP FUNCTION IF EXISTS public.cancel_ticket_transfer(uuid);

CREATE OR REPLACE FUNCTION public.cancel_ticket_transfer(_transfer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER  -- Bypasses RLS, but we enforce authorization manually
SET search_path = public
AS $$
DECLARE
    _transfer record;
    _user_role text;
    _updated_count int;
BEGIN
    -- 1. Get the transfer
    SELECT * INTO _transfer 
    FROM public.ticket_transfers 
    WHERE id = _transfer_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transfer not found: %', _transfer_id
            USING ERRCODE = 'P0002'; -- no_data_found
    END IF;

    -- 2. Authorization check: user must be org member with valid role
    SELECT role INTO _user_role 
    FROM public.org_members 
    WHERE org_id = _transfer.org_id 
    AND user_id = auth.uid();

    IF _user_role IS NULL THEN
        RAISE EXCEPTION 'Not authorized: user is not a member of this organization'
            USING ERRCODE = '42501'; -- insufficient_privilege
    END IF;

    IF _user_role NOT IN ('owner', 'admin', 'support') THEN
        RAISE EXCEPTION 'Not authorized: role % cannot cancel transfers', _user_role
            USING ERRCODE = '42501';
    END IF;

    -- 3. Validate status is pending
    IF _transfer.status != 'pending' THEN
        RAISE EXCEPTION 'Cannot cancel: transfer status is %, expected pending', _transfer.status
            USING ERRCODE = '23514'; -- check_violation
    END IF;

    -- 4. Perform the update
    UPDATE public.ticket_transfers
    SET 
        status = 'cancelled',
        cancelled_at = now(),
        cancelled_by_user_id = auth.uid(),
        updated_at = now()
    WHERE id = _transfer_id
    AND status = 'pending';  -- Double-check for race conditions

    -- 5. Check rows affected
    GET DIAGNOSTICS _updated_count = ROW_COUNT;

    IF _updated_count = 0 THEN
        RAISE EXCEPTION 'Cancel failed: 0 rows updated (race condition or status changed)'
            USING ERRCODE = 'P0001'; -- raise_exception
    END IF;

    -- 6. Return success with details
    RETURN jsonb_build_object(
        'success', true,
        'updated', _updated_count,
        'transfer_id', _transfer_id,
        'new_status', 'cancelled'
    );
END;
$$;

COMMENT ON FUNCTION public.cancel_ticket_transfer IS 
    'Cancels a pending ticket transfer. Returns rows updated. Raises exception on failure.';

-- ========================================================
-- 2. Ensure audit trigger handles CANCELLED status correctly
-- ========================================================
CREATE OR REPLACE FUNCTION public.audit_transfer_change()
RETURNS TRIGGER AS $$
DECLARE
    _actor_id uuid;
    _action text;
BEGIN
    -- Determine actor
    IF (TG_OP = 'INSERT') THEN
        _actor_id := COALESCE(NEW.initiated_by_user_id, auth.uid());
        _action := 'TRANSFER_INITIATED';
    ELSIF (TG_OP = 'UPDATE' AND OLD.status != NEW.status) THEN
        -- Determine actor and action based on new status
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
        -- No status change on UPDATE, skip audit
        RETURN NEW;
    END IF;

    -- Insert audit log
    INSERT INTO public.audit_log (
        org_id,
        actor_user_id,
        action,
        resource_type,
        resource_id,
        entity_type,
        entity_id,
        before_state,
        after_state,
        metadata
    ) VALUES (
        NEW.org_id,
        _actor_id,
        _action,
        'event',
        NEW.event_id,
        'ticket_transfer',
        NEW.id,
        CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('status', OLD.status) ELSE NULL END,
        jsonb_build_object('status', NEW.status),
        jsonb_build_object(
            'ticket_instance_id', NEW.ticket_instance_id,
            'to_email', NEW.to_email,
            'cancelled_at', NEW.cancelled_at,
            'cancelled_by_user_id', NEW.cancelled_by_user_id
        )
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Ensure trigger exists
DROP TRIGGER IF EXISTS audit_transfer_changes ON public.ticket_transfers;
CREATE TRIGGER audit_transfer_changes
    AFTER INSERT OR UPDATE ON public.ticket_transfers
    FOR EACH ROW EXECUTE FUNCTION public.audit_transfer_change();
