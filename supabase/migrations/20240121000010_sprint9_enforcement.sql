-- Migration: 20240121000010_sprint9_enforcement.sql
-- Description: Sprint 9 - Runtime Enforcement Helpers
-- Updates are_tickets_available to be public-safe (bypass get_event_config)
-- Adds is_waitlist_enabled and is_interest_list_enabled

-- 1. Update are_tickets_available to respect hierarchy (Event > Org > Default) and bypass Auth
CREATE OR REPLACE FUNCTION public.are_tickets_available(_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _org_id uuid;
    _val text;
    _available_from timestamptz;
BEGIN
    SELECT org_id INTO _org_id FROM public.events WHERE id = _event_id;
    
    -- 1. Event Override
    SELECT setting_value->'ticket_pdf'->>'available_from' INTO _val
    FROM public.event_settings
    WHERE event_id = _event_id AND domain = 'ticket_pdf';
    
    IF _val IS NOT NULL THEN
        BEGIN
            _available_from := _val::timestamptz;
        EXCEPTION WHEN OTHERS THEN
            RETURN false;
        END;
    ELSE
        -- 2. Org Override
        SELECT setting_value->'ticket_pdf'->>'available_from' INTO _val
        FROM public.org_settings
        WHERE org_id = _org_id AND domain = 'ticket_pdf';
        
        IF _val IS NOT NULL THEN
            BEGIN
                _available_from := _val::timestamptz;
            EXCEPTION WHEN OTHERS THEN
                RETURN false;
            END;
        ELSE
            -- 3. Default (null)
            _available_from := null;
        END IF;
    END IF;
    
    -- Fail-safe: if not set, deny
    IF _available_from IS NULL THEN
        RETURN false;
    END IF;
    
    RETURN now() >= _available_from;
END;
$$;

COMMENT ON FUNCTION public.are_tickets_available IS 'Returns true if tickets are available (sales/pdf) based on available_from setting. Public-safe.';

-- 2. is_waitlist_enabled
CREATE OR REPLACE FUNCTION public.is_waitlist_enabled(_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _org_id uuid;
    _val boolean;
BEGIN
    SELECT org_id INTO _org_id FROM public.events WHERE id = _event_id;
    
    -- 1. Event Override
    SELECT (setting_value->'waitlist'->>'enabled')::boolean INTO _val
    FROM public.event_settings
    WHERE event_id = _event_id AND domain = 'waitlist';
    
    IF _val IS NOT NULL THEN
        RETURN _val;
    END IF;
    
    -- 2. Org Override
    SELECT (setting_value->'waitlist'->>'enabled')::boolean INTO _val
    FROM public.org_settings
    WHERE org_id = _org_id AND domain = 'waitlist';
    
    IF _val IS NOT NULL THEN
        RETURN _val;
    END IF;
    
    -- 3. Default
    RETURN false;
END;
$$;

COMMENT ON FUNCTION public.is_waitlist_enabled IS 'Returns true if waitlist is enabled for this event. Public-safe.';

-- 3. is_interest_list_enabled
CREATE OR REPLACE FUNCTION public.is_interest_list_enabled(_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _org_id uuid;
    _val boolean;
BEGIN
    SELECT org_id INTO _org_id FROM public.events WHERE id = _event_id;
    
    -- 1. Event Override
    SELECT (setting_value->'interest_list'->>'enabled')::boolean INTO _val
    FROM public.event_settings
    WHERE event_id = _event_id AND domain = 'interest_list';
    
    IF _val IS NOT NULL THEN
        RETURN _val;
    END IF;
    
    -- 2. Org Override
    SELECT (setting_value->'interest_list'->>'enabled')::boolean INTO _val
    FROM public.org_settings
    WHERE org_id = _org_id AND domain = 'interest_list';
    
    IF _val IS NOT NULL THEN
        RETURN _val;
    END IF;
    
    -- 3. Default
    RETURN false;
END;
$$;

COMMENT ON FUNCTION public.is_interest_list_enabled IS 'Returns true if interest list is enabled for this event. Public-safe.';
