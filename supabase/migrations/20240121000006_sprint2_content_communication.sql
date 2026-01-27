-- Migration: 20240121000006_sprint2_content_communication.sql
-- Description: Sprint 2 - Content & Communication Settings
-- Adds: basic_info, communication domains with i18n support
-- RBAC: owner/admin can edit, support/finance read-only

-- ========================================================
-- 1. Extend Domain Constraints
-- ========================================================

ALTER TABLE public.org_settings DROP CONSTRAINT IF EXISTS org_settings_domain_check;
ALTER TABLE public.event_settings DROP CONSTRAINT IF EXISTS event_settings_domain_check;

-- Now 7 domains total
ALTER TABLE public.org_settings 
ADD CONSTRAINT org_settings_domain_check 
CHECK (domain IN ('payments', 'transfers', 'communication', 'governance', 'legal', 'basic_info', 'content_communication'));

ALTER TABLE public.event_settings 
ADD CONSTRAINT event_settings_domain_check 
CHECK (domain IN ('payments', 'transfers', 'communication', 'governance', 'legal', 'basic_info', 'content_communication'));

-- ========================================================
-- 2. Helper: Validate Locale Keys
-- ========================================================

CREATE OR REPLACE FUNCTION public.is_valid_locale(_locale text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    -- Allowed locales (extend as needed)
    RETURN _locale IN ('nl', 'en', 'fr', 'de', 'es', 'it', 'pt');
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_locale_object(_obj jsonb, _field_name text, _required boolean DEFAULT false)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
    _key text;
    _has_at_least_one boolean := false;
BEGIN
    IF _obj IS NULL THEN
        IF _required THEN
            RAISE EXCEPTION '% is required', _field_name;
        END IF;
        RETURN true;
    END IF;

    IF jsonb_typeof(_obj) != 'object' THEN
        RAISE EXCEPTION '% must be an object with locale keys', _field_name;
    END IF;

    -- Validate each key is a valid locale
    FOR _key IN SELECT jsonb_object_keys(_obj)
    LOOP
        IF NOT public.is_valid_locale(_key) THEN
            RAISE EXCEPTION 'Invalid locale key "%" in %. Allowed: nl, en, fr, de, es, it, pt', _key, _field_name;
        END IF;
        
        -- Check value is string
        IF jsonb_typeof(_obj->_key) != 'string' THEN
            RAISE EXCEPTION '%.% must be a string', _field_name, _key;
        END IF;
        
        _has_at_least_one := true;
    END LOOP;

    IF _required AND NOT _has_at_least_one THEN
        RAISE EXCEPTION '% requires at least one locale', _field_name;
    END IF;

    RETURN true;
END;
$$;

-- ========================================================
-- 3. Update validate_setting_domain
-- ========================================================

CREATE OR REPLACE FUNCTION public.validate_setting_domain(_domain text, _value jsonb)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
    _emails jsonb;
    _email text;
    _email_count int;
BEGIN
    CASE _domain
        -- Existing domains
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

        WHEN 'governance' THEN
            IF (_value ? 'is_private') AND NOT (jsonb_typeof(_value->'is_private') = 'boolean') THEN
                RAISE EXCEPTION 'is_private must be a boolean';
            END IF;

        WHEN 'legal' THEN
            IF (_value ? 'mode') THEN
                IF NOT (_value->>'mode' IN ('none', 'pdf', 'url', 'inline_text')) THEN
                    RAISE EXCEPTION 'terms mode must be none, pdf, url, or inline_text';
                END IF;
            END IF;
            IF (_value ? 'pdf_file_id') AND (_value->>'pdf_file_id' IS NOT NULL) AND (_value->>'pdf_file_id' != '') THEN
                IF NOT (_value->>'pdf_file_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') THEN
                    RAISE EXCEPTION 'pdf_file_id must be a valid UUID';
                END IF;
            END IF;
            IF (_value ? 'url') AND (_value->>'url' IS NOT NULL) AND NOT (jsonb_typeof(_value->'url') = 'string') THEN
                RAISE EXCEPTION 'url must be a string';
            END IF;
            IF (_value ? 'inline_text') AND (_value->'inline_text' IS NOT NULL) AND NOT (jsonb_typeof(_value->'inline_text') = 'object') THEN
                RAISE EXCEPTION 'inline_text must be an object with locale keys';
            END IF;

        -- NEW: basic_info domain
        WHEN 'basic_info' THEN
            -- Validate name (i18n object, required at least 1 locale)
            IF _value ? 'name' THEN
                PERFORM public.validate_locale_object(_value->'name', 'name', false);
            END IF;
            
            -- Validate description (i18n object, optional)
            IF _value ? 'description' THEN
                PERFORM public.validate_locale_object(_value->'description', 'description', false);
            END IF;
            
            -- Validate contact_email
            IF (_value ? 'contact_email') AND (_value->>'contact_email' IS NOT NULL) AND (_value->>'contact_email' != '') THEN
                IF NOT (_value->>'contact_email' ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
                    RAISE EXCEPTION 'contact_email must be a valid email address';
                END IF;
            END IF;
            
            -- Validate website (optional string)
            IF (_value ? 'website') AND NOT (jsonb_typeof(_value->'website') IN ('string', 'null')) THEN
                RAISE EXCEPTION 'website must be a string';
            END IF;

        -- NEW: content_communication domain
        WHEN 'content_communication' THEN
            -- Validate checkout_message (i18n object)
            IF _value ? 'checkout_message' THEN
                PERFORM public.validate_locale_object(_value->'checkout_message', 'checkout_message', false);
            END IF;
            
            -- Validate email_subject (i18n object)
            IF _value ? 'email_subject' THEN
                PERFORM public.validate_locale_object(_value->'email_subject', 'email_subject', false);
            END IF;
            
            -- Validate email_body (i18n object)
            IF _value ? 'email_body' THEN
                PERFORM public.validate_locale_object(_value->'email_body', 'email_body', false);
            END IF;
            
            -- Validate extra_recipients (array of max 5 emails)
            IF _value ? 'extra_recipients' THEN
                _emails := _value->'extra_recipients';
                
                IF jsonb_typeof(_emails) != 'array' THEN
                    RAISE EXCEPTION 'extra_recipients must be an array';
                END IF;
                
                _email_count := jsonb_array_length(_emails);
                
                IF _email_count > 5 THEN
                    RAISE EXCEPTION 'extra_recipients cannot exceed 5 addresses (got %)', _email_count;
                END IF;
                
                -- Validate each email
                FOR _email IN SELECT jsonb_array_elements_text(_emails)
                LOOP
                    IF NOT (_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
                        RAISE EXCEPTION 'Invalid email in extra_recipients: %', _email;
                    END IF;
                END LOOP;
                
                -- Check for duplicates
                IF (SELECT COUNT(*) FROM (SELECT DISTINCT jsonb_array_elements_text(_emails)) t) != _email_count THEN
                    RAISE EXCEPTION 'extra_recipients contains duplicates';
                END IF;
            END IF;
            
        ELSE
            RAISE EXCEPTION 'Unknown domain: %', _domain;
    END CASE;

    RETURN true;
END;
$$;

-- ========================================================
-- 4. Update get_default_settings
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
        WHEN 'governance' THEN
            RETURN jsonb_build_object(
                'is_private', false
            );
        WHEN 'legal' THEN
            RETURN jsonb_build_object(
                'mode', 'none',
                'pdf_file_id', null,
                'url', null,
                'inline_text', null
            );
        -- NEW: basic_info defaults
        WHEN 'basic_info' THEN
            RETURN jsonb_build_object(
                'name', jsonb_build_object('nl', ''),
                'description', jsonb_build_object('nl', ''),
                'contact_email', null,
                'website', null
            );
        -- NEW: content_communication defaults
        WHEN 'content_communication' THEN
            RETURN jsonb_build_object(
                'checkout_message', jsonb_build_object('nl', 'Bedankt voor je inschrijving!', 'en', 'Thank you for registering!'),
                'email_subject', jsonb_build_object('nl', 'Bevestiging inschrijving', 'en', 'Registration confirmation'),
                'email_body', jsonb_build_object('nl', '', 'en', ''),
                'extra_recipients', jsonb_build_array()
            );
        ELSE
            RETURN '{}'::jsonb;
    END CASE;
END;
$$;

-- ========================================================
-- 5. Update get_event_config
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
    -- UPDATED: Added basic_info and content_communication
    _domains text[] := ARRAY['payments', 'transfers', 'communication', 'governance', 'legal', 'basic_info', 'content_communication'];
    _defaults jsonb;
    _org_val jsonb;
    _event_val jsonb;
BEGIN
    SELECT org_id INTO _org_id FROM public.events WHERE id = _event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event not found: %', _event_id;
    END IF;

    IF NOT public.is_org_member(_org_id) THEN
        RAISE EXCEPTION 'Not authorized to view this event config';
    END IF;

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
-- 6. Update set_event_config (RBAC for new domains)
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
    SELECT org_id INTO _org_id FROM public.events WHERE id = _event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event not found: %', _event_id;
    END IF;

    SELECT role INTO _role
    FROM public.org_members
    WHERE org_id = _org_id AND user_id = auth.uid();

    IF _role IS NULL THEN
        RAISE EXCEPTION 'Not authorized: not a member of this organization';
    END IF;

    -- RBAC Checks per domain
    CASE _domain
        WHEN 'payments' THEN
            IF _role NOT IN ('owner', 'admin', 'finance') THEN
                RAISE EXCEPTION 'Permission denied: % cannot edit payments settings', _role;
            END IF;
        WHEN 'transfers', 'communication' THEN
            IF _role NOT IN ('owner', 'admin', 'support') THEN
                RAISE EXCEPTION 'Permission denied: % cannot edit % settings', _role, _domain;
            END IF;
        WHEN 'governance', 'legal' THEN
            IF _role NOT IN ('owner', 'admin') THEN
                RAISE EXCEPTION 'Permission denied: % cannot edit % settings', _role, _domain;
            END IF;
        -- NEW: basic_info and content_communication - owner/admin only
        WHEN 'basic_info', 'content_communication' THEN
            IF _role NOT IN ('owner', 'admin') THEN
                RAISE EXCEPTION 'Permission denied: % cannot edit % settings', _role, _domain;
            END IF;
        ELSE
            RAISE EXCEPTION 'Unknown domain: %', _domain;
    END CASE;

    PERFORM public.validate_setting_domain(_domain, _patch);

    SELECT setting_value INTO _current_override
    FROM public.event_settings
    WHERE event_id = _event_id AND domain = _domain;
    
    IF _current_override IS NULL THEN 
        _current_override := '{}'::jsonb; 
    END IF;

    _new_override := _current_override || _patch;

    INSERT INTO public.event_settings (event_id, domain, setting_value, updated_by, updated_at)
    VALUES (_event_id, _domain, _new_override, auth.uid(), now())
    ON CONFLICT (event_id, domain) 
    DO UPDATE SET 
        setting_value = EXCLUDED.setting_value,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at;

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

    SELECT public.get_event_config(_event_id) INTO _merged_config;
    RETURN _merged_config;
END;
$$;

-- ========================================================
-- 7. Update reset_event_config_domain (RBAC for new domains)
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
    SELECT org_id INTO _org_id FROM public.events WHERE id = _event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event not found: %', _event_id;
    END IF;

    SELECT role INTO _role
    FROM public.org_members
    WHERE org_id = _org_id AND user_id = auth.uid();

    IF _role IS NULL THEN
        RAISE EXCEPTION 'Not authorized: not a member of this organization';
    END IF;

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
        WHEN 'basic_info', 'content_communication' THEN
            IF _role NOT IN ('owner', 'admin') THEN
                RAISE EXCEPTION 'Permission denied: % cannot reset % settings', _role, _domain;
            END IF;
        ELSE
            RAISE EXCEPTION 'Unknown domain: %', _domain;
    END CASE;

    SELECT setting_value INTO _old_override
    FROM public.event_settings
    WHERE event_id = _event_id AND domain = _domain;

    DELETE FROM public.event_settings
    WHERE event_id = _event_id AND domain = _domain;

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

    SELECT public.get_event_config(_event_id) INTO _merged_config;
    RETURN _merged_config;
END;
$$;

-- ========================================================
-- 8. Update get_event_config_permissions
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
        'can_edit_governance', _role IN ('owner', 'admin'),
        'can_edit_legal', _role IN ('owner', 'admin'),
        -- NEW: Sprint 2 domains
        'can_edit_basic_info', _role IN ('owner', 'admin'),
        'can_edit_content_communication', _role IN ('owner', 'admin')
    );
END;
$$;
