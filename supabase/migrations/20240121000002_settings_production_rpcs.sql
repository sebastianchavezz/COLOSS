-- Migration: 20240121000002_settings_production_rpcs.sql
-- Description: Production-ready RPCs for Settings MVP
-- Features:
--   - get_event_config: returns merged config (system || org || event)
--   - set_event_config: PATCH semantics, returns merged config, audit log
--   - reset_event_config_domain: clears event overrides for a domain
-- RBAC:
--   - payments: owner, admin, finance
--   - transfers, communication: owner, admin, support
--   - finance role is read-only for non-payments domains

-- ========================================================
-- 1. get_event_config (replaces get_effective_event_settings)
-- ========================================================

CREATE OR REPLACE FUNCTION public.get_event_config(_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _org_id uuid;
    _result jsonb := '{}'::jsonb;
    _domain text;
    _domains text[] := ARRAY['payments', 'transfers', 'communication'];
    _defaults jsonb;
    _org_val jsonb;
    _event_val jsonb;
BEGIN
    -- 1. Get Org ID
    SELECT org_id INTO _org_id FROM public.events WHERE id = _event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event not found: %', _event_id;
    END IF;

    -- 2. Check Access (Member of Org)
    IF NOT public.is_org_member(_org_id) THEN
        RAISE EXCEPTION 'Not authorized to view this event config';
    END IF;

    -- 3. Loop through domains and merge
    FOREACH _domain IN ARRAY _domains
    LOOP
        -- A. System Defaults
        _defaults := public.get_default_settings(_domain);

        -- B. Org Defaults
        SELECT setting_value INTO _org_val
        FROM public.org_settings
        WHERE org_id = _org_id AND domain = _domain;
        
        IF _org_val IS NULL THEN _org_val := '{}'::jsonb; END IF;

        -- C. Event Overrides
        SELECT setting_value INTO _event_val
        FROM public.event_settings
        WHERE event_id = _event_id AND domain = _domain;

        IF _event_val IS NULL THEN _event_val := '{}'::jsonb; END IF;

        -- D. Merge: Defaults || Org || Event (right side wins)
        _result := jsonb_set(_result, ARRAY[_domain], _defaults || _org_val || _event_val);
    END LOOP;

    RETURN _result;
END;
$$;

COMMENT ON FUNCTION public.get_event_config IS 'Returns merged event config (system defaults || org defaults || event overrides)';

-- ========================================================
-- 2. set_event_config (PATCH semantics)
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
    -- Payments: owner, admin, finance
    -- Transfers/Communication: owner, admin, support
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

    -- 8. Audit Log
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
        _domain,
        jsonb_build_object('override', _current_override),
        jsonb_build_object('override', _new_override, 'patch', _patch),
        jsonb_build_object('domain', _domain)
    );

    -- 9. Return fresh merged config
    SELECT public.get_event_config(_event_id) INTO _merged_config;
    RETURN _merged_config;
END;
$$;

COMMENT ON FUNCTION public.set_event_config IS 'PATCH event config override. Returns merged config.';

-- ========================================================
-- 3. reset_event_config_domain (clear override)
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

    -- 6. Audit Log
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
            _domain,
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

COMMENT ON FUNCTION public.reset_event_config_domain IS 'Clears event-level override for a domain, reverting to org/system defaults.';

-- ========================================================
-- 4. Helper: Check if user can edit domain (for frontend)
-- ========================================================

CREATE OR REPLACE FUNCTION public.get_event_config_permissions(_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _org_id uuid;
    _role text;
BEGIN
    SELECT org_id INTO _org_id FROM public.events WHERE id = _event_id;
    IF NOT FOUND THEN RETURN NULL; END IF;

    SELECT role INTO _role
    FROM public.org_members
    WHERE org_id = _org_id AND user_id = auth.uid();

    IF _role IS NULL THEN RETURN NULL; END IF;

    RETURN jsonb_build_object(
        'role', _role,
        'can_edit_payments', _role IN ('owner', 'admin', 'finance'),
        'can_edit_transfers', _role IN ('owner', 'admin', 'support'),
        'can_edit_communication', _role IN ('owner', 'admin', 'support')
    );
END;
$$;

COMMENT ON FUNCTION public.get_event_config_permissions IS 'Returns user permissions for editing each config domain.';
