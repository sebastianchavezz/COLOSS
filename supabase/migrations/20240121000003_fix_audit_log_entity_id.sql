-- Migration: 20240121000003_fix_audit_log_entity_id.sql
-- Description: Fix entity_id type mismatch in set_event_config and reset_event_config_domain
-- Problem: entity_id is UUID but we were passing domain text

-- ========================================================
-- 1. Fix set_event_config
-- ========================================================

CREATE OR REPLACE FUNCTION public.set_event_config(
    _event_id uuid, 
    _domain text, 
    _patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _org_id uuid;
    _role text;
    _current_override jsonb;
    _new_override jsonb;
    _merged_config jsonb;
BEGIN
    -- 1. Get Org ID
    SELECT org_id INTO _org_id FROM public.events WHERE id = _event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event not found: %', _event_id;
    END IF;

    -- 2. Get User Role
    SELECT role INTO _role
    FROM public.org_members
    WHERE org_id = _org_id AND user_id = auth.uid();

    IF _role IS NULL THEN
        RAISE EXCEPTION 'Not authorized: not a member of this organization';
    END IF;

    -- 3. RBAC Checks per domain
    CASE _domain
        WHEN 'payments' THEN
            IF _role NOT IN ('owner', 'admin', 'finance') THEN
                RAISE EXCEPTION 'Permission denied: % cannot edit payments settings', _role;
            END IF;
        WHEN 'transfers', 'communication' THEN
            IF _role NOT IN ('owner', 'admin', 'support') THEN
                RAISE EXCEPTION 'Permission denied: % cannot edit % settings', _role, _domain;
            END IF;
        ELSE
            RAISE EXCEPTION 'Unknown domain: %', _domain;
    END CASE;

    -- 4. Validate patch against domain schema
    PERFORM public.validate_setting_domain(_domain, _patch);

    -- 5. Get current event override (or empty)
    SELECT setting_value INTO _current_override
    FROM public.event_settings
    WHERE event_id = _event_id AND domain = _domain;
    
    IF _current_override IS NULL THEN 
        _current_override := '{}'::jsonb; 
    END IF;

    -- 6. PATCH: merge current override with patch
    _new_override := _current_override || _patch;

    -- 7. Upsert
    INSERT INTO public.event_settings (event_id, domain, setting_value, updated_by, updated_at)
    VALUES (_event_id, _domain, _new_override, auth.uid(), now())
    ON CONFLICT (event_id, domain) 
    DO UPDATE SET 
        setting_value = EXCLUDED.setting_value,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at;

    -- 8. Audit Log (FIXED: entity_id is now _event_id, domain goes in metadata)
    INSERT INTO public.audit_log (
        org_id, actor_user_id, action, resource_type, resource_id,
        entity_type, entity_id, before_state, after_state, metadata
    ) VALUES (
        _org_id, 
        auth.uid(), 
        'CONFIG_UPDATED', 
        'event', 
        _event_id,
        'event_config', 
        _event_id,  -- FIX: Use event UUID, not domain text
        jsonb_build_object('override', _current_override),
        jsonb_build_object('override', _new_override, 'patch', _patch),
        jsonb_build_object('domain', _domain)
    );

    -- 9. Return fresh merged config
    SELECT public.get_event_config(_event_id) INTO _merged_config;
    RETURN _merged_config;
END;
$$;

-- ========================================================
-- 2. Fix reset_event_config_domain
-- ========================================================

CREATE OR REPLACE FUNCTION public.reset_event_config_domain(
    _event_id uuid, 
    _domain text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _org_id uuid;
    _role text;
    _old_override jsonb;
    _merged_config jsonb;
BEGIN
    -- 1. Get Org ID
    SELECT org_id INTO _org_id FROM public.events WHERE id = _event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event not found: %', _event_id;
    END IF;

    -- 2. Get User Role
    SELECT role INTO _role
    FROM public.org_members
    WHERE org_id = _org_id AND user_id = auth.uid();

    IF _role IS NULL THEN
        RAISE EXCEPTION 'Not authorized: not a member of this organization';
    END IF;

    -- 3. RBAC (same rules as set)
    CASE _domain
        WHEN 'payments' THEN
            IF _role NOT IN ('owner', 'admin', 'finance') THEN
                RAISE EXCEPTION 'Permission denied: % cannot reset payments settings', _role;
            END IF;
        WHEN 'transfers', 'communication' THEN
            IF _role NOT IN ('owner', 'admin', 'support') THEN
                RAISE EXCEPTION 'Permission denied: % cannot reset % settings', _role, _domain;
            END IF;
        ELSE
            RAISE EXCEPTION 'Unknown domain: %', _domain;
    END CASE;

    -- 4. Get old value for audit
    SELECT setting_value INTO _old_override
    FROM public.event_settings
    WHERE event_id = _event_id AND domain = _domain;

    -- 5. Delete the override row
    DELETE FROM public.event_settings
    WHERE event_id = _event_id AND domain = _domain;

    -- 6. Audit Log (FIXED: entity_id is now _event_id)
    IF _old_override IS NOT NULL THEN
        INSERT INTO public.audit_log (
            org_id, actor_user_id, action, resource_type, resource_id,
            entity_type, entity_id, before_state, after_state, metadata
        ) VALUES (
            _org_id, 
            auth.uid(), 
            'CONFIG_RESET', 
            'event', 
            _event_id,
            'event_config', 
            _event_id,  -- FIX: Use event UUID, not domain text
            jsonb_build_object('override', _old_override),
            NULL,
            jsonb_build_object('domain', _domain)
        );
    END IF;

    -- 7. Return fresh merged config (will now use org/system defaults)
    SELECT public.get_event_config(_event_id) INTO _merged_config;
    RETURN _merged_config;
END;
$$;
