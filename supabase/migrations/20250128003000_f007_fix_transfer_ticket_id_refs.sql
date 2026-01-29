-- Migration: 20240120000030_fix_transfer_functions.sql
-- Fix column references from ticket_instance_id to ticket_id

-- ========================================================
-- 1. Fix accept_ticket_transfer function
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
    -- Get current ticket owner (FIX: ticket_id instead of ticket_instance_id)
    SELECT owner_user_id INTO _ticket_owner_user_id
    FROM public.ticket_instances
    WHERE id = _transfer.ticket_id;

    -- Update ticket ownership to current user
    UPDATE public.ticket_instances
    SET
        owner_user_id = auth.uid(),
        updated_at = now()
    WHERE id = _transfer.ticket_id;

    -- 6. Update transfer record
    UPDATE public.ticket_transfers
    SET
        status = 'accepted',
        accepted_at = now(),
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

-- ========================================================
-- 2. Fix audit_transfer_change function
-- ========================================================
CREATE OR REPLACE FUNCTION public.audit_transfer_change()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        INSERT INTO public.audit_log (
            org_id,
            actor_user_id,
            action,
            entity_type,
            entity_id,
            after_state,
            metadata
        ) VALUES (
            NEW.org_id,
            auth.uid(),
            'TRANSFER_INITIATED',
            'ticket_transfer',
            NEW.id,
            jsonb_build_object('status', NEW.status),
            jsonb_build_object(
                'ticket_id', NEW.ticket_id,  -- FIX: ticket_id instead of ticket_instance_id
                'to_email', NEW.to_email,
                'expires_at', NEW.expires_at
            )
        );
    ELSIF (TG_OP = 'UPDATE' AND OLD.status != NEW.status) THEN
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
            NEW.org_id,
            auth.uid(),
            CASE
                WHEN NEW.status = 'accepted' THEN 'TRANSFER_ACCEPTED'
                WHEN NEW.status = 'cancelled' THEN 'TRANSFER_CANCELLED'
                WHEN NEW.status = 'expired' THEN 'TRANSFER_EXPIRED'
                WHEN NEW.status = 'rejected' THEN 'TRANSFER_REJECTED'
                ELSE 'TRANSFER_STATUS_CHANGED'
            END,
            'ticket_transfer',
            NEW.id,
            jsonb_build_object('status', OLD.status),
            jsonb_build_object('status', NEW.status),
            jsonb_build_object(
                'ticket_id', NEW.ticket_id  -- FIX: ticket_id instead of ticket_instance_id
            )
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================================================
-- Verificatie
-- ===========================================================================

DO $$
BEGIN
  RAISE NOTICE '✓ Fixed transfer functions to use ticket_id column';
  RAISE NOTICE '  - accept_ticket_transfer: ticket_instance_id → ticket_id';
  RAISE NOTICE '  - audit_transfer_change: ticket_instance_id → ticket_id';
END $$;
