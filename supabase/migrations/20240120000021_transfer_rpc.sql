-- RPC for atomic transfer completion
-- Migration: 20240120000021_transfer_rpc.sql

CREATE OR REPLACE FUNCTION public.complete_ticket_transfer(
    _transfer_id uuid,
    _ticket_instance_id uuid,
    _to_participant_id uuid,
    _to_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _transfer_status text;
    _from_participant_id uuid;
    _org_id uuid;
BEGIN
    -- 1. Lock transfer row (exactly-once)
    SELECT status, from_participant_id, org_id
    INTO _transfer_status, _from_participant_id, _org_id
    FROM public.ticket_transfers
    WHERE id = _transfer_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'Transfer not found', 'code', 'TRANSFER_NOT_FOUND');
    END IF;

    -- 2. Idempotency check
    IF _transfer_status != 'pending' THEN
        RETURN jsonb_build_object(
            'error', 'Transfer already processed',
            'code', 'ALREADY_PROCESSED',
            'status', _transfer_status
        );
    END IF;

    -- 3. Update ticket ownership
    UPDATE public.ticket_instances
    SET 
        owner_user_id = _to_user_id,
        updated_at = now()
    WHERE id = _ticket_instance_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket not found: %', _ticket_instance_id;
    END IF;

    -- 4. Update transfer status
    UPDATE public.ticket_transfers
    SET 
        status = 'accepted',
        to_participant_id = _to_participant_id,
        accepted_at = now(),
        updated_at = now()
    WHERE id = _transfer_id;

    -- 5. Audit log (ownership change)
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
        _to_user_id,
        'TICKET_OWNERSHIP_TRANSFERRED',
        'ticket_instance',
        _ticket_instance_id,
        jsonb_build_object('from_participant_id', _from_participant_id),
        jsonb_build_object('to_participant_id', _to_participant_id),
        jsonb_build_object('transfer_id', _transfer_id)
    );

    RETURN jsonb_build_object(
        'success', true,
        'transfer_id', _transfer_id,
        'ticket_instance_id', _ticket_instance_id
    );
END;
$$;

COMMENT ON FUNCTION public.complete_ticket_transfer IS
    'Atomically transfers ticket ownership. Idempotent via status check. Auditable.';
