-- Migration: 20240121000004_sprint1_governance_legal.sql
-- Description: Sprint 1 - Governance & Legal Settings
-- Adds: governance (visibility) and legal (terms) domains
-- RBAC: owner/admin can edit, support/finance read-only

-- ========================================================
-- 1. Extend Domain Constraints
-- ========================================================

-- Drop old constraints (they only allowed payments/transfers/communication)
ALTER TABLE public.org_settings DROP CONSTRAINT IF EXISTS org_settings_domain_check;
ALTER TABLE public.event_settings DROP CONSTRAINT IF EXISTS event_settings_domain_check;

-- Add new constraints with extended domain list
ALTER TABLE public.org_settings 
ADD CONSTRAINT org_settings_domain_check 
CHECK (domain IN ('payments', 'transfers', 'communication', 'governance', 'legal'));

ALTER TABLE public.event_settings 
ADD CONSTRAINT event_settings_domain_check 
CHECK (domain IN ('payments', 'transfers', 'communication', 'governance', 'legal'));

-- ========================================================
-- 2. Update validate_setting_domain
-- ========================================================

CREATE OR REPLACE FUNCTION public.validate_setting_domain(_domain text, _value jsonb)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
    CASE _domain
        WHEN 'payments' THEN
            IF (_value ? 'payment_profile_id') AND (_value->>'payment_profile_id' IS NOT NULL) THEN
                IF NOT (_value->>'payment_profile_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') THEN
                    RAISE EXCEPTION 'Invalid payment_profile_id format';
                END IF;
            END IF;
            IF (_value ? 'vat_rate') AND NOT (jsonb_typeof(_value->'vat_rate') = 'number') THEN
                RAISE EXCEPTION 'vat_rate must be a number';
            END IF;
            
        WHEN 'transfers' THEN
            IF (_value ? 'transfers_enabled') AND NOT (jsonb_typeof(_value->'transfers_enabled') = 'boolean') THEN
                RAISE EXCEPTION 'transfers_enabled must be a boolean';
            END IF;
            IF (_value ? 'transfer_expiry_hours') AND NOT (jsonb_typeof(_value->'transfer_expiry_hours') = 'number') THEN
                RAISE EXCEPTION 'transfer_expiry_hours must be a number';
            END IF;
            IF (_value ? 'cancel_roles') AND NOT (jsonb_typeof(_value->'cancel_roles') = 'array') THEN
                RAISE EXCEPTION 'cancel_roles must be an array';
            END IF;

        WHEN 'communication' THEN
            IF (_value ? 'reply_to_email') AND NOT (jsonb_typeof(_value->'reply_to_email') = 'string') THEN
                RAISE EXCEPTION 'reply_to_email must be a string';
            END IF;
            IF (_value ? 'default_locale') AND NOT (_value->>'default_locale' IN ('nl', 'en', 'fr')) THEN
                RAISE EXCEPTION 'default_locale must be nl, en, or fr';
            END IF;

        -- NEW: Governance domain
        WHEN 'governance' THEN
            IF (_value ? 'is_private') AND NOT (jsonb_typeof(_value->'is_private') = 'boolean') THEN
                RAISE EXCEPTION 'is_private must be a boolean';
            END IF;

        -- NEW: Legal domain
        WHEN 'legal' THEN
            -- Validate terms.mode
            IF (_value ? 'mode') THEN
                IF NOT (_value->>'mode' IN ('none', 'pdf', 'url', 'inline_text')) THEN
                    RAISE EXCEPTION 'terms mode must be none, pdf, url, or inline_text';
                END IF;
            END IF;
            -- Validate pdf_file_id is UUID if present
            IF (_value ? 'pdf_file_id') AND (_value->>'pdf_file_id' IS NOT NULL) AND (_value->>'pdf_file_id' != '') THEN
                IF NOT (_value->>'pdf_file_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') THEN
                    RAISE EXCEPTION 'pdf_file_id must be a valid UUID';
                END IF;
            END IF;
            -- Validate url is string if present
            IF (_value ? 'url') AND (_value->>'url' IS NOT NULL) AND NOT (jsonb_typeof(_value->'url') = 'string') THEN
                RAISE EXCEPTION 'url must be a string';
            END IF;
            -- Validate inline_text is object if present
            IF (_value ? 'inline_text') AND (_value->'inline_text' IS NOT NULL) AND NOT (jsonb_typeof(_value->'inline_text') = 'object') THEN
                RAISE EXCEPTION 'inline_text must be an object with locale keys';
            END IF;
            
        ELSE
            RAISE EXCEPTION 'Unknown domain: %', _domain;
    END CASE;

    RETURN true;
END;
$$;

-- ========================================================
-- 3. Update get_default_settings
-- ========================================================

CREATE OR REPLACE FUNCTION public.get_default_settings(_domain text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
    CASE _domain
        WHEN 'payments' THEN
            RETURN jsonb_build_object(
                'payment_profile_id', null,
                'invoice_prefix', '',
                'vat_number', '',
                'vat_rate', 21
            );
        WHEN 'transfers' THEN
            RETURN jsonb_build_object(
                'transfers_enabled', true,
                'transfer_expiry_hours', 48,
                'cancel_roles', jsonb_build_array('owner', 'admin', 'support')
            );
        WHEN 'communication' THEN
            RETURN jsonb_build_object(
                'reply_to_email', '',
                'default_locale', 'nl',
                'confirmation_message', ''
            );
        -- NEW: Governance defaults
        WHEN 'governance' THEN
            RETURN jsonb_build_object(
                'is_private', false
            );
        -- NEW: Legal defaults
        WHEN 'legal' THEN
            RETURN jsonb_build_object(
                'mode', 'none',
                'pdf_file_id', null,
                'url', null,
                'inline_text', null
            );
        ELSE
            RETURN '{}'::jsonb;
    END CASE;
END;
$$;

-- ========================================================
-- 4. Update get_event_config (add new domains to array)
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
    -- UPDATED: Added governance and legal
    _domains text[] := ARRAY['payments', 'transfers', 'communication', 'governance', 'legal'];
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
        _defaults := public.get_default_settings(_domain);

        SELECT setting_value INTO _org_val
        FROM public.org_settings
        WHERE org_id = _org_id AND domain = _domain;
        
        IF _org_val IS NULL THEN _org_val := '{}'::jsonb; END IF;

        SELECT setting_value INTO _event_val
        FROM public.event_settings
        WHERE event_id = _event_id AND domain = _domain;

        IF _event_val IS NULL THEN _event_val := '{}'::jsonb; END IF;

        _result := jsonb_set(_result, ARRAY[_domain], _defaults || _org_val || _event_val);
    END LOOP;

    RETURN _result;
END;
$$;

-- ========================================================
-- 5. Update set_event_config (RBAC for new domains)
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
        -- NEW: Governance and Legal - only owner/admin
        WHEN 'governance', 'legal' THEN
            IF _role NOT IN ('owner', 'admin') THEN
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
        _event_id,
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
-- 6. Update reset_event_config_domain (RBAC for new domains)
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

    -- 3. RBAC
    CASE _domain
        WHEN 'payments' THEN
            IF _role NOT IN ('owner', 'admin', 'finance') THEN
                RAISE EXCEPTION 'Permission denied: % cannot reset payments settings', _role;
            END IF;
        WHEN 'transfers', 'communication' THEN
            IF _role NOT IN ('owner', 'admin', 'support') THEN
                RAISE EXCEPTION 'Permission denied: % cannot reset % settings', _role, _domain;
            END IF;
        WHEN 'governance', 'legal' THEN
            IF _role NOT IN ('owner', 'admin') THEN
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
            _event_id,
            jsonb_build_object('override', _old_override),
            NULL,
            jsonb_build_object('domain', _domain)
        );
    END IF;

    -- 7. Return fresh merged config
    SELECT public.get_event_config(_event_id) INTO _merged_config;
    RETURN _merged_config;
END;
$$;

-- ========================================================
-- 7. Update get_event_config_permissions (add new domains)
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
        'can_edit_communication', _role IN ('owner', 'admin', 'support'),
        -- NEW: Governance and Legal permissions
        'can_edit_governance', _role IN ('owner', 'admin'),
        'can_edit_legal', _role IN ('owner', 'admin')
    );
END;
$$;

-- ========================================================
-- 8. Helper View: Public Events (respects is_private)
-- ========================================================

-- This view can be used for public event listings
-- It only shows events where governance.is_private is false (or default)

CREATE OR REPLACE VIEW public.public_events AS
SELECT e.*
FROM public.events e
WHERE e.status = 'published'
  AND e.deleted_at IS NULL
  AND NOT COALESCE(
    (
      SELECT (es.setting_value->>'is_private')::boolean
      FROM public.event_settings es
      WHERE es.event_id = e.id AND es.domain = 'governance'
    ),
    false
  );

COMMENT ON VIEW public.public_events IS 'Public events only - excludes private events and respects governance.is_private setting';

-- ========================================================
-- 9. Helper Function: Check if event is public
-- ========================================================

CREATE OR REPLACE FUNCTION public.is_event_public(_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _is_private boolean;
    _status text;
    _deleted_at timestamptz;
BEGIN
    -- Check event exists and is not deleted
    SELECT status, deleted_at INTO _status, _deleted_at
    FROM public.events WHERE id = _event_id;
    
    IF NOT FOUND OR _deleted_at IS NOT NULL THEN
        RETURN false;
    END IF;
    
    -- Check if published
    IF _status != 'published' THEN
        RETURN false;
    END IF;
    
    -- Check governance settings
    SELECT (setting_value->>'is_private')::boolean INTO _is_private
    FROM public.event_settings
    WHERE event_id = _event_id AND domain = 'governance';
    
    -- Default is public (is_private = false)
    RETURN NOT COALESCE(_is_private, false);
END;
$$;

COMMENT ON FUNCTION public.is_event_public IS 'Returns true if event is published, not deleted, and not private';
