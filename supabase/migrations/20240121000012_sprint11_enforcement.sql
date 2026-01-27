-- Migration: 20240121000012_sprint11_enforcement.sql
-- Description: Sprint 11 - Privacy Enforcement
-- Updates get_ticket_privacy to be public-safe (fail-safe)
-- Adds sanitize_ticket_data helper
-- Updates perform_checkin to return sanitized user data

-- 1. Update get_ticket_privacy to be public-safe (bypass get_event_config auth check)
CREATE OR REPLACE FUNCTION public.get_ticket_privacy(_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _org_id uuid;
    _val jsonb;
BEGIN
    BEGIN
        SELECT org_id INTO _org_id FROM public.events WHERE id = _event_id;
        
        -- 1. Event Override
        SELECT setting_value->'show' INTO _val
        FROM public.event_settings
        WHERE event_id = _event_id AND domain = 'ticket_privacy';
        
        IF _val IS NOT NULL THEN
            RETURN _val;
        END IF;
        
        -- 2. Org Override
        SELECT setting_value->'show' INTO _val
        FROM public.org_settings
        WHERE org_id = _org_id AND domain = 'ticket_privacy';
        
        IF _val IS NOT NULL THEN
            RETURN _val;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        -- Fail-safe: return default on any error
        RETURN jsonb_build_object(
            'name', true,
            'email', false,
            'birthdate', false,
            'gender', false,
            'nationality', false,
            'address', false,
            'phone', false,
            'emergency_contact', false
        );
    END;
    
    -- 3. Default
    RETURN jsonb_build_object(
        'name', true,
        'email', false,
        'birthdate', false,
        'gender', false,
        'nationality', false,
        'address', false,
        'phone', false,
        'emergency_contact', false
    );
END;
$$;

COMMENT ON FUNCTION public.get_ticket_privacy IS 'Returns privacy whitelist. Public-safe and fail-safe.';

-- 2. sanitize_ticket_data Helper
CREATE OR REPLACE FUNCTION public.sanitize_ticket_data(_event_id uuid, _data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _whitelist jsonb;
    _result jsonb := '{}'::jsonb;
    _key text;
    _allowed boolean;
BEGIN
    _whitelist := public.get_ticket_privacy(_event_id);
    
    FOR _key IN SELECT jsonb_object_keys(_data)
    LOOP
        _allowed := (_whitelist->>_key)::boolean;
        
        -- Default behavior: name=true, others=false if missing
        IF _allowed IS NULL THEN
            IF _key = 'name' THEN 
                _allowed := true; 
            ELSE 
                _allowed := false; 
            END IF;
        END IF;
        
        IF _allowed THEN
            _result := jsonb_set(_result, ARRAY[_key], _data->_key);
        END IF;
    END LOOP;
    
    RETURN _result;
END;
$$;

COMMENT ON FUNCTION public.sanitize_ticket_data IS 'Filters JSON data based on event privacy settings.';

-- 3. Update perform_checkin to return sanitized data
CREATE OR REPLACE FUNCTION public.perform_checkin(
    ticket_raw_token text,
    event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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
    -- New vars
    _order_id uuid;
    _purchaser_name text;
    _email text;
    _raw_user_data jsonb;
    _sanitized_user_data jsonb;
BEGIN
    -- 1. Get Actor (User)
    _user_id := auth.uid();
    if _user_id is null then
        return jsonb_build_object('error', 'Unauthorized', 'code', 'UNAUTHORIZED');
    end if;

    -- 2. Hash Token (SHA-256)
    _token_hash := encode(digest(ticket_raw_token, 'sha256'), 'hex');

    -- 3. Find Ticket & Lock Row
    select 
        ti.id, 
        ti.status, 
        ti.event_id, 
        ti.qr_code,
        ti.order_id,
        tt.name,
        e.org_id
    into 
        _ticket_id, 
        _ticket_status, 
        _ticket_event_id, 
        _qr_preview,
        _order_id,
        _ticket_type_name,
        _org_id
    from public.ticket_instances ti
    join public.ticket_types tt on ti.ticket_type_id = tt.id
    join public.events e on ti.event_id = e.id
    where ti.token_hash = _token_hash
    for update of ti;

    -- 4. Validations
    if _ticket_id is null then
        return jsonb_build_object('error', 'Invalid ticket', 'code', 'INVALID_TICKET');
    end if;

    if _ticket_event_id != event_id then
        return jsonb_build_object('error', 'Ticket belongs to another event', 'code', 'WRONG_EVENT');
    end if;

    if _ticket_status = 'void' or _ticket_status = 'cancelled' then
        return jsonb_build_object('error', 'Ticket is void or cancelled', 'code', 'TICKET_VOID');
    end if;

    -- Fetch User Data from Order
    SELECT purchaser_name, email INTO _purchaser_name, _email
    FROM public.orders
    WHERE id = _order_id;

    _raw_user_data := jsonb_build_object(
        'name', COALESCE(_purchaser_name, 'Unknown'),
        'email', COALESCE(_email, '')
    );
    
    -- Sanitize Data
    _sanitized_user_data := public.sanitize_ticket_data(event_id, _raw_user_data);

    -- 5. Idempotency Check
    if _ticket_status = 'checked_in' then
        select checked_in_at into _existing_checkin_at
        from public.ticket_instances
        where id = _ticket_id;

        return jsonb_build_object(
            'status', 'already_checked_in',
            'ticket_instance_id', _ticket_id,
            'checked_in_at', _existing_checkin_at,
            'qr_preview', _qr_preview,
            'ticket_type', _ticket_type_name,
            'user_data', _sanitized_user_data
        );
    end if;

    -- 6. Atomic Updates
    update public.ticket_instances
    set 
        status = 'checked_in',
        checked_in_at = _now,
        checked_in_by = _user_id,
        updated_at = _now
    where id = _ticket_id;

    insert into public.ticket_checkins (
        org_id, event_id, ticket_instance_id, checked_in_by, checked_in_at, source, metadata
    ) values (
        _org_id, event_id, _ticket_id, _user_id, _now, 'scan', jsonb_build_object('via', 'rpc')
    )
    returning id into _checkin_id;

    insert into public.audit_log (
        org_id, actor_user_id, action, entity_type, entity_id, metadata
    ) values (
        _org_id, _user_id, 'TICKET_CHECKED_IN', 'ticket_instance', _ticket_id,
        jsonb_build_object('event_id', event_id, 'checkin_id', _checkin_id)
    );

    -- 7. Return Success
    return jsonb_build_object(
        'status', 'checked_in',
        'ticket_instance_id', _ticket_id,
        'checkin_id', _checkin_id,
        'checked_in_at', _now,
        'qr_preview', _qr_preview,
        'ticket_type', _ticket_type_name,
        'user_data', _sanitized_user_data
    );
end;
$$;
