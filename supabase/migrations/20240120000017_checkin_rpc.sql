-- SPRINT 4: CHECK-IN RPC
-- Migration: 20240120000017_checkin_rpc.sql

create or replace function public.perform_checkin(
    ticket_raw_token text,
    event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    _token_hash text;
    _ticket_id uuid;
    _ticket_status text;
    _ticket_event_id uuid;
    _ticket_type_name text;
    _org_id uuid;
    _user_id uuid;
    _checkin_id uuid;
    _now timestamptz := now();
    _qr_preview text;
    _existing_checkin_at timestamptz;
begin
    -- 1. Get Actor (User)
    _user_id := auth.uid();
    if _user_id is null then
        return jsonb_build_object('error', 'Unauthorized', 'code', 'UNAUTHORIZED');
    end if;

    -- 2. Hash Token (SHA-256)
    -- Using pgcrypto digest, encoded as hex string
    _token_hash := encode(digest(ticket_raw_token, 'sha256'), 'hex');

    -- 3. Find Ticket & Lock Row (SELECT FOR UPDATE)
    select 
        ti.id, 
        ti.status, 
        ti.event_id, 
        ti.qr_code,
        tt.name,
        e.org_id
    into 
        _ticket_id, 
        _ticket_status, 
        _ticket_event_id, 
        _qr_preview,
        _ticket_type_name,
        _org_id
    from public.ticket_instances ti
    join public.ticket_types tt on ti.ticket_type_id = tt.id
    join public.events e on ti.event_id = e.id
    where ti.token_hash = _token_hash
    for update of ti; -- Lock ticket_instances row

    -- 4. Validations
    if _ticket_id is null then
        -- 404
        return jsonb_build_object(
            'error', 'Invalid ticket',
            'code', 'INVALID_TICKET'
        );
    end if;

    if _ticket_event_id != event_id then
        -- 400
        return jsonb_build_object(
            'error', 'Ticket belongs to another event',
            'code', 'WRONG_EVENT'
        );
    end if;

    if _ticket_status = 'void' or _ticket_status = 'cancelled' then
        -- 400
        return jsonb_build_object(
            'error', 'Ticket is void or cancelled',
            'code', 'TICKET_VOID'
        );
    end if;

    -- 5. Idempotency Check
    if _ticket_status = 'checked_in' then
        -- Get existing check-in time
        select checked_in_at into _existing_checkin_at
        from public.ticket_instances
        where id = _ticket_id;

        return jsonb_build_object(
            'status', 'already_checked_in',
            'ticket_instance_id', _ticket_id,
            'checked_in_at', _existing_checkin_at,
            'qr_preview', _qr_preview,
            'ticket_type', _ticket_type_name
        );
    end if;

    -- 6. Atomic Updates
    
    -- Update Ticket Instance
    update public.ticket_instances
    set 
        status = 'checked_in',
        checked_in_at = _now,
        checked_in_by = _user_id,
        updated_at = _now
    where id = _ticket_id;

    -- Insert Ticket Checkin (Unique constraint ensures no duplicates)
    insert into public.ticket_checkins (
        org_id,
        event_id,
        ticket_instance_id,
        checked_in_by,
        checked_in_at,
        source,
        metadata
    ) values (
        _org_id,
        event_id,
        _ticket_id,
        _user_id,
        _now,
        'scan',
        jsonb_build_object('via', 'rpc')
    )
    returning id into _checkin_id;

    -- Insert Audit Log
    insert into public.audit_log (
        org_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) values (
        _org_id,
        _user_id,
        'TICKET_CHECKED_IN',
        'ticket_instance',
        _ticket_id,
        jsonb_build_object(
            'event_id', event_id,
            'checkin_id', _checkin_id
        )
    );

    -- 7. Return Success
    return jsonb_build_object(
        'status', 'checked_in',
        'ticket_instance_id', _ticket_id,
        'checkin_id', _checkin_id,
        'checked_in_at', _now,
        'qr_preview', _qr_preview,
        'ticket_type', _ticket_type_name
    );

end;
$$;
