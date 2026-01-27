-- Migration: 20240120000025_transfer_lifecycle.sql
-- Sprint 10: Full Ticket Transfer Lifecycle (Initiate/Accept/Reject/Cancel)

-- ========================================================
-- 1. Add User Tracking Columns
-- ========================================================
ALTER TABLE public.ticket_transfers
    ADD COLUMN IF NOT EXISTS initiated_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS accepted_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS rejected_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS cancelled_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS rejected_at timestamptz;

-- Ensure cancelled_at exists (it was in previous migration but good to be safe)
ALTER TABLE public.ticket_transfers
    ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- Add index for user lookups
CREATE INDEX IF NOT EXISTS idx_transfers_initiated_by ON public.ticket_transfers(initiated_by_user_id);

-- ========================================================
-- 2. Fix Audit Trigger (Strict NOT NULL compliance)
-- ========================================================
CREATE OR REPLACE FUNCTION public.audit_transfer_change()
RETURNS TRIGGER AS $$
DECLARE
    _actor_id uuid;
    _resource_type text := 'event';
    _resource_id uuid;
BEGIN
    -- Determine resource_id (event_id)
    _resource_id := NEW.event_id;
    
    -- Determine actor
    IF (TG_OP = 'INSERT') THEN
        _actor_id := COALESCE(NEW.initiated_by_user_id, auth.uid());
    ELSE
        -- For updates, try to infer actor from the state change columns
        IF NEW.status = 'accepted' THEN
            _actor_id := COALESCE(NEW.accepted_by_user_id, auth.uid());
        ELSIF NEW.status = 'rejected' THEN
            _actor_id := COALESCE(NEW.rejected_by_user_id, auth.uid());
        ELSIF NEW.status = 'cancelled' THEN
            _actor_id := COALESCE(NEW.cancelled_by_user_id, auth.uid());
        ELSE
            _actor_id := auth.uid();
        END IF;
    END IF;

    -- Insert Audit Log
    IF (TG_OP = 'INSERT') THEN
        INSERT INTO public.audit_log (
            org_id,
            actor_user_id,
            action,
            resource_type,
            resource_id,
            entity_type,
            entity_id,
            after_state,
            metadata
        ) VALUES (
            NEW.org_id,
            _actor_id,
            'TRANSFER_INITIATED',
            _resource_type,
            _resource_id,
            'ticket_transfer',
            NEW.id,
            jsonb_build_object('status', NEW.status),
            jsonb_build_object(
                'ticket_instance_id', NEW.ticket_instance_id,
                'to_email', NEW.to_email,
                'expires_at', NEW.expires_at,
                'from_participant_id', NEW.from_participant_id
            )
        );
    ELSIF (TG_OP = 'UPDATE' AND OLD.status != NEW.status) THEN
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
            CASE 
                WHEN NEW.status = 'accepted' THEN 'TRANSFER_ACCEPTED'
                WHEN NEW.status = 'rejected' THEN 'TRANSFER_REJECTED'
                WHEN NEW.status = 'cancelled' THEN 'TRANSFER_CANCELLED'
                WHEN NEW.status = 'expired' THEN 'TRANSFER_EXPIRED'
                ELSE 'TRANSFER_STATUS_CHANGED'
            END,
            _resource_type,
            _resource_id,
            'ticket_transfer',
            NEW.id,
            jsonb_build_object('status', OLD.status),
            jsonb_build_object('status', NEW.status),
            jsonb_build_object(
                'ticket_instance_id', NEW.ticket_instance_id,
                'to_email', NEW.to_email
            )
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================================
-- 3. RPC: Initiate Transfer
-- ========================================================
CREATE OR REPLACE FUNCTION public.initiate_ticket_transfer(
    _event_id uuid,
    _ticket_instance_id uuid,
    _to_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER -- Respects RLS
AS $$
DECLARE
    _org_id uuid;
    _user_role text;
    _ticket record;
    _from_participant_id uuid;
    _transfer_id uuid;
    _token text;
    _token_hash text;
    _expires_at timestamptz;
BEGIN
    -- 1. Auth & Role Check
    SELECT org_id INTO _org_id FROM public.events WHERE id = _event_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Event not found');
    END IF;

    IF NOT public.is_org_member(_org_id) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Not authorized');
    END IF;

    SELECT role INTO _user_role FROM public.org_members 
    WHERE org_id = _org_id AND user_id = auth.uid();

    IF _user_role = 'finance' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Finance role cannot initiate transfers');
    END IF;

    -- 2. Validate Ticket
    SELECT * INTO _ticket FROM public.ticket_instances 
    WHERE id = _ticket_instance_id AND event_id = _event_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Ticket not found');
    END IF;

    IF _ticket.status != 'issued' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Ticket is not in issued state');
    END IF;

    -- 3. Check for existing pending transfer
    IF EXISTS (
        SELECT 1 FROM public.ticket_transfers 
        WHERE ticket_instance_id = _ticket_instance_id AND status = 'pending'
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Active transfer already exists');
    END IF;

    -- 4. Find current owner participant (if any)
    -- We assume owner_user_id is linked to a participant, OR we create a placeholder?
    -- For now, try to find participant for owner_user_id in this event
    SELECT id INTO _from_participant_id FROM public.participants 
    WHERE user_id = _ticket.owner_user_id 
    AND id IN (SELECT participant_id FROM public.registrations WHERE event_id = _event_id)
    LIMIT 1;
    
    -- If no participant found (e.g. manual ticket issue), we might need to handle this.
    -- For strictness, let's require a participant record or create a dummy one?
    -- Constraint says from_participant_id is NOT NULL.
    IF _from_participant_id IS NULL THEN
        -- Try to find ANY participant for this user in this event?
        -- Or fail? Let's fail for safety.
        RETURN jsonb_build_object('success', false, 'message', 'Ticket owner has no participant record');
    END IF;

    -- 5. Generate Token
    _token := encode(gen_random_bytes(32), 'hex');
    _token_hash := encode(digest(_token, 'sha256'), 'hex');
    _expires_at := now() + interval '48 hours';

    -- 6. Insert Transfer
    INSERT INTO public.ticket_transfers (
        event_id,
        org_id,
        ticket_instance_id,
        from_participant_id,
        to_email,
        transfer_token_hash,
        expires_at,
        initiated_by_user_id,
        status
    ) VALUES (
        _event_id,
        _org_id,
        _ticket_instance_id,
        _from_participant_id,
        _to_email,
        _token_hash,
        _expires_at,
        auth.uid(),
        'pending'
    ) RETURNING id INTO _transfer_id;

    RETURN jsonb_build_object(
        'success', true,
        'transfer_id', _transfer_id,
        'expires_at', _expires_at,
        'token', _token -- Only returned once here
    );
END;
$$;

-- ========================================================
-- 4. RPC: Cancel Transfer
-- ========================================================
CREATE OR REPLACE FUNCTION public.cancel_ticket_transfer(_transfer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    _transfer record;
    _user_role text;
BEGIN
    -- 1. Get Transfer
    SELECT * INTO _transfer FROM public.ticket_transfers WHERE id = _transfer_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Transfer not found');
    END IF;

    -- 2. Auth Check
    IF NOT public.is_org_member(_transfer.org_id) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Not authorized');
    END IF;

    SELECT role INTO _user_role FROM public.org_members 
    WHERE org_id = _transfer.org_id AND user_id = auth.uid();

    IF _user_role = 'finance' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Finance role cannot cancel transfers');
    END IF;

    -- 3. Validate Status
    IF _transfer.status != 'pending' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Transfer is not pending');
    END IF;

    -- 4. Update
    UPDATE public.ticket_transfers
    SET 
        status = 'cancelled',
        cancelled_at = now(),
        cancelled_by_user_id = auth.uid(),
        updated_at = now()
    WHERE id = _transfer_id;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- ========================================================
-- 5. RPC: Accept Transfer
-- ========================================================
CREATE OR REPLACE FUNCTION public.accept_ticket_transfer(_transfer_id uuid, _token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER -- Needs to update ticket ownership which might be restricted
SET search_path = public
AS $$
DECLARE
    _transfer record;
    _token_hash text;
    _to_participant_id uuid;
BEGIN
    -- 1. Validate Token
    _token_hash := encode(digest(_token, 'sha256'), 'hex');
    
    SELECT * INTO _transfer FROM public.ticket_transfers WHERE id = _transfer_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Transfer not found');
    END IF;

    IF _transfer.transfer_token_hash != _token_hash THEN
        RETURN jsonb_build_object('success', false, 'message', 'Invalid token');
    END IF;

    IF _transfer.status != 'pending' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Transfer is not pending');
    END IF;

    IF _transfer.expires_at < now() THEN
        UPDATE public.ticket_transfers SET status = 'expired' WHERE id = _transfer_id;
        RETURN jsonb_build_object('success', false, 'message', 'Transfer expired');
    END IF;

    -- 2. Find/Create Recipient Participant
    -- For now, we assume the current user IS the recipient
    -- We need to find their participant record for this event
    SELECT id INTO _to_participant_id FROM public.participants 
    WHERE user_id = auth.uid() 
    AND id IN (SELECT participant_id FROM public.registrations WHERE event_id = _transfer.event_id)
    LIMIT 1;

    IF _to_participant_id IS NULL THEN
         -- Auto-create participant/registration if missing? 
         -- For this sprint, let's require them to be registered (or fail).
         -- Or we can create a basic participant.
         -- Let's fail for safety and require registration first.
         RETURN jsonb_build_object('success', false, 'message', 'Recipient must be registered for event');
    END IF;

    -- 3. Atomic Update
    UPDATE public.ticket_transfers
    SET 
        status = 'accepted',
        accepted_at = now(),
        accepted_by_user_id = auth.uid(),
        to_participant_id = _to_participant_id,
        updated_at = now()
    WHERE id = _transfer_id;

    UPDATE public.ticket_instances
    SET 
        owner_user_id = auth.uid(),
        updated_at = now()
    WHERE id = _transfer.ticket_instance_id;

    RETURN jsonb_build_object('success', true, 'transfer_id', _transfer_id);
END;
$$;

-- ========================================================
-- 6. RPC: Reject Transfer
-- ========================================================
CREATE OR REPLACE FUNCTION public.reject_ticket_transfer(_transfer_id uuid, _token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    _transfer record;
    _token_hash text;
BEGIN
    _token_hash := encode(digest(_token, 'sha256'), 'hex');
    
    SELECT * INTO _transfer FROM public.ticket_transfers WHERE id = _transfer_id;
    
    IF _transfer.transfer_token_hash != _token_hash THEN
        RETURN jsonb_build_object('success', false, 'message', 'Invalid token');
    END IF;

    IF _transfer.status != 'pending' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Transfer is not pending');
    END IF;

    UPDATE public.ticket_transfers
    SET 
        status = 'rejected',
        rejected_at = now(),
        rejected_by_user_id = auth.uid(),
        updated_at = now()
    WHERE id = _transfer_id;

    RETURN jsonb_build_object('success', true);
END;
$$;
