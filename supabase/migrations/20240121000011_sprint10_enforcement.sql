-- Migration: 20240121000011_sprint10_enforcement.sql
-- Description: Sprint 10 - Ticket Delivery Enforcement
-- Updates are_tickets_available to allow NULL (backward compatibility)

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
            RETURN false; -- Invalid date = block
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
                RETURN false; -- Invalid date = block
            END;
        ELSE
            -- 3. Default (null)
            _available_from := null;
        END IF;
    END IF;
    
    -- Sprint 10: NULL = Always Available (Backward Compatible)
    IF _available_from IS NULL THEN
        RETURN true;
    END IF;
    
    RETURN now() >= _available_from;
END;
$$;

COMMENT ON FUNCTION public.are_tickets_available IS 'Returns true if tickets are available (delivery/pdf) based on available_from setting. NULL means available.';
