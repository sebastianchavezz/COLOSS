-- Migration: 20240121000000_fix_accept_transfer_ownership.sql
-- Fix: Ensure ticket ownership is transferred to the recipient, not necessarily the actor (admin/sender)
-- Also improves recipient resolution logic.

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
    _recipient_user_id uuid;
    _recipient_participant_id uuid;
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

    -- 5. Resolve Recipient User ID and Participant ID
    -- We need to know WHO will own the ticket.
    
    -- Priority 1: Use to_participant_id if set and has a user_id
    IF _transfer.to_participant_id IS NOT NULL THEN
        SELECT user_id INTO _recipient_user_id
        FROM public.participants
        WHERE id = _transfer.to_participant_id;
        
        _recipient_participant_id := _transfer.to_participant_id;
    END IF;

    -- Priority 2: If no user_id found yet, try to match auth.uid() if email matches
    IF _recipient_user_id IS NULL THEN
        -- If the current user IS the recipient (by email), use them
        IF EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND email = _transfer.to_email) THEN
            _recipient_user_id := auth.uid();
            
            -- Also try to find/link participant if we don't have one yet
            IF _recipient_participant_id IS NULL THEN
                 SELECT id INTO _recipient_participant_id
                 FROM public.participants
                 WHERE user_id = auth.uid()
                 AND id IN (SELECT participant_id FROM public.registrations WHERE event_id = _transfer.event_id)
                 LIMIT 1;
            END IF;
        END IF;
    END IF;
    
    -- Priority 3: If still null, try to find ANY user with the email (requires access to auth.users)
    IF _recipient_user_id IS NULL THEN
        SELECT id INTO _recipient_user_id
        FROM auth.users
        WHERE email = _transfer.to_email;
    END IF;

    -- If we still don't have a recipient user ID, we cannot transfer ownership safely
    IF _recipient_user_id IS NULL THEN
        RAISE EXCEPTION 'Cannot accept transfer: recipient user not found for email %', _transfer.to_email
            USING ERRCODE = 'P0003';
    END IF;

    -- 6. Perform ticket ownership transfer
    -- Get current ticket owner
    SELECT owner_user_id INTO _ticket_owner_user_id
    FROM public.ticket_instances
    WHERE id = _transfer.ticket_instance_id;

    -- Update ticket ownership to RECIPIENT user (not necessarily auth.uid())
    UPDATE public.ticket_instances
    SET 
        owner_user_id = _recipient_user_id,
        updated_at = now()
    WHERE id = _transfer.ticket_instance_id;

    -- 7. Update transfer record
    UPDATE public.ticket_transfers
    SET 
        status = 'accepted',
        accepted_at = now(),
        accepted_by_user_id = auth.uid(), -- The actor (could be admin)
        to_participant_id = COALESCE(to_participant_id, _recipient_participant_id),
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
        'new_owner', _recipient_user_id,
        'accepted_by', auth.uid()
    );
END;
$$;

COMMENT ON FUNCTION public.accept_ticket_transfer IS 
    'Accepts a pending ticket transfer and transfers ownership to the recipient. Idempotent.';
