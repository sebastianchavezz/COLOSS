-- Migration: 20240121000008_sprint4_waitlist_interest.sql
-- Description: Sprint 4 - Waitlist & Interest List Settings
-- Adds: waitlist, interest_list domains with enforcement helpers
-- RBAC: owner/admin can edit, support/finance read-only
--
-- NOTE: This sprint assumes waitlist_entries and waitlist_offers tables exist.
-- If they don't exist yet, they should be created in a separate Layer migration.

-- ========================================================
-- 1. Extend Domain Constraints
-- ========================================================

ALTER TABLE public.org_settings DROP CONSTRAINT IF EXISTS org_settings_domain_check;
ALTER TABLE public.event_settings DROP CONSTRAINT IF EXISTS event_settings_domain_check;

-- Now 10 domains total
ALTER TABLE public.org_settings 
ADD CONSTRAINT org_settings_domain_check 
CHECK (domain IN ('payments', 'transfers', 'communication', 'governance', 'legal', 'basic_info', 'content_communication', 'branding', 'waitlist', 'interest_list'));

ALTER TABLE public.event_settings 
ADD CONSTRAINT event_settings_domain_check 
CHECK (domain IN ('payments', 'transfers', 'communication', 'governance', 'legal', 'basic_info', 'content_communication', 'branding', 'waitlist', 'interest_list'));

-- ========================================================
-- 2. Update validate_setting_domain
-- ========================================================

CREATE OR REPLACE FUNCTION public.validate_setting_domain(_domain text, _value jsonb)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
    _emails jsonb;
    _email text;
    _email_count int;
    _file_id text;
    _color text;
    _key text;
BEGIN
    CASE _domain
        -- Existing domains (Sprint 0-3)
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

        WHEN 'basic_info' THEN
            IF _value ? 'name' THEN
                PERFORM public.validate_locale_object(_value->'name', 'name', false);
            END IF;
            IF _value ? 'description' THEN
                PERFORM public.validate_locale_object(_value->'description', 'description', false);
            END IF;
            IF (_value ? 'contact_email') AND (_value->>'contact_email' IS NOT NULL) AND (_value->>'contact_email' != '') THEN
                IF NOT (_value->>'contact_email' ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
                    RAISE EXCEPTION 'contact_email must be a valid email address';
                END IF;
            END IF;
            IF (_value ? 'website') AND NOT (jsonb_typeof(_value->'website') IN ('string', 'null')) THEN
                RAISE EXCEPTION 'website must be a string';
            END IF;

        WHEN 'content_communication' THEN
            IF _value ? 'checkout_message' THEN
                PERFORM public.validate_locale_object(_value->'checkout_message', 'checkout_message', false);
            END IF;
            IF _value ? 'email_subject' THEN
                PERFORM public.validate_locale_object(_value->'email_subject', 'email_subject', false);
            END IF;
            IF _value ? 'email_body' THEN
                PERFORM public.validate_locale_object(_value->'email_body', 'email_body', false);
            END IF;
            IF _value ? 'extra_recipients' THEN
                _emails := _value->'extra_recipients';
                IF jsonb_typeof(_emails) != 'array' THEN
                    RAISE EXCEPTION 'extra_recipients must be an array';
                END IF;
                _email_count := jsonb_array_length(_emails);
                IF _email_count > 5 THEN
                    RAISE EXCEPTION 'extra_recipients cannot exceed 5 addresses (got %)', _email_count;
                END IF;
                FOR _email IN SELECT jsonb_array_elements_text(_emails)
                LOOP
                    IF NOT (_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
                        RAISE EXCEPTION 'Invalid email in extra_recipients: %', _email;
                    END IF;
                END LOOP;
                IF (SELECT COUNT(*) FROM (SELECT DISTINCT jsonb_array_elements_text(_emails)) t) != _email_count THEN
                    RAISE EXCEPTION 'extra_recipients contains duplicates';
                END IF;
            END IF;

        WHEN 'branding' THEN
            IF (_value ? 'hero_image_id') AND (_value->>'hero_image_id' IS NOT NULL) AND (_value->>'hero_image_id' != '') THEN
                _file_id := _value->>'hero_image_id';
                IF NOT (_file_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') THEN
                    RAISE EXCEPTION 'hero_image_id must be a valid UUID';
                END IF;
            END IF;
            IF (_value ? 'logo_image_id') AND (_value->>'logo_image_id' IS NOT NULL) AND (_value->>'logo_image_id' != '') THEN
                _file_id := _value->>'logo_image_id';
                IF NOT (_file_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') THEN
                    RAISE EXCEPTION 'logo_image_id must be a valid UUID';
                END IF;
            END IF;
            IF (_value ? 'primary_color') AND (_value->>'primary_color' IS NOT NULL) AND (_value->>'primary_color' != '') THEN
                _color := _value->>'primary_color';
                IF NOT public.is_valid_hex_color(_color) THEN
                    RAISE EXCEPTION 'primary_color must be a valid hex color (#RRGGBB), got: %', _color;
                END IF;
            END IF;

        -- NEW: waitlist domain (Sprint 4)
        WHEN 'waitlist' THEN
            -- Only 'enabled' key is allowed
            FOR _key IN SELECT jsonb_object_keys(_value)
            LOOP
                IF _key != 'enabled' THEN
                    RAISE EXCEPTION 'waitlist: unknown key "%". Only "enabled" is allowed.', _key;
                END IF;
            END LOOP;
            
            -- enabled must be boolean
            IF (_value ? 'enabled') AND NOT (jsonb_typeof(_value->'enabled') = 'boolean') THEN
                RAISE EXCEPTION 'waitlist.enabled must be a boolean';
            END IF;

        -- NEW: interest_list domain (Sprint 4)
        WHEN 'interest_list' THEN
            -- Only 'enabled' key is allowed
            FOR _key IN SELECT jsonb_object_keys(_value)
            LOOP
                IF _key != 'enabled' THEN
                    RAISE EXCEPTION 'interest_list: unknown key "%". Only "enabled" is allowed.', _key;
                END IF;
            END LOOP;
            
            -- enabled must be boolean
            IF (_value ? 'enabled') AND NOT (jsonb_typeof(_value->'enabled') = 'boolean') THEN
                RAISE EXCEPTION 'interest_list.enabled must be a boolean';
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
        WHEN 'basic_info' THEN
            RETURN jsonb_build_object(
                'name', jsonb_build_object('nl', ''),
                'description', jsonb_build_object('nl', ''),
                'contact_email', null,
                'website', null
            );
        WHEN 'content_communication' THEN
            RETURN jsonb_build_object(
                'checkout_message', jsonb_build_object('nl', 'Bedankt voor je inschrijving!', 'en', 'Thank you for registering!'),
                'email_subject', jsonb_build_object('nl', 'Bevestiging inschrijving', 'en', 'Registration confirmation'),
                'email_body', jsonb_build_object('nl', '', 'en', ''),
                'extra_recipients', jsonb_build_array()
            );
        WHEN 'branding' THEN
            RETURN jsonb_build_object(
                'hero_image_id', null,
                'logo_image_id', null,
                'primary_color', '#4F46E5'
            );
        -- NEW: waitlist defaults (Sprint 4)
        WHEN 'waitlist' THEN
            RETURN jsonb_build_object(
                'enabled', false
            );
        -- NEW: interest_list defaults (Sprint 4)
        WHEN 'interest_list' THEN
            RETURN jsonb_build_object(
                'enabled', false
            );
        ELSE
            RETURN '{}'::jsonb;
    END CASE;
END;
$$;

-- ========================================================
-- 4. Update get_event_config
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
    -- UPDATED: Added waitlist and interest_list
    _domains text[] := ARRAY['payments', 'transfers', 'communication', 'governance', 'legal', 'basic_info', 'content_communication', 'branding', 'waitlist', 'interest_list'];
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
-- 5. Update set_event_config (RBAC for waitlist/interest_list)
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
        WHEN 'basic_info', 'content_communication' THEN
            IF _role NOT IN ('owner', 'admin') THEN
                RAISE EXCEPTION 'Permission denied: % cannot edit % settings', _role, _domain;
            END IF;
        WHEN 'branding' THEN
            IF _role NOT IN ('owner', 'admin') THEN
                RAISE EXCEPTION 'Permission denied: % cannot edit branding settings', _role;
            END IF;
        -- NEW: waitlist and interest_list - owner/admin only
        WHEN 'waitlist', 'interest_list' THEN
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
-- 6. Update reset_event_config_domain (RBAC)
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
        WHEN 'branding' THEN
            IF _role NOT IN ('owner', 'admin') THEN
                RAISE EXCEPTION 'Permission denied: % cannot reset branding settings', _role;
            END IF;
        WHEN 'waitlist', 'interest_list' THEN
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
-- 7. Update get_event_config_permissions
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
        'can_edit_basic_info', _role IN ('owner', 'admin'),
        'can_edit_content_communication', _role IN ('owner', 'admin'),
        'can_edit_branding', _role IN ('owner', 'admin'),
        -- NEW: waitlist and interest_list permissions
        'can_edit_waitlist', _role IN ('owner', 'admin'),
        'can_edit_interest_list', _role IN ('owner', 'admin')
    );
END;
$$;

-- ========================================================
-- 8. Enforcement Helper: is_waitlist_enabled
-- ========================================================

CREATE OR REPLACE FUNCTION public.is_waitlist_enabled(_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _config jsonb;
BEGIN
    SELECT public.get_event_config(_event_id) INTO _config;
    RETURN COALESCE((_config->'waitlist'->>'enabled')::boolean, false);
END;
$$;

COMMENT ON FUNCTION public.is_waitlist_enabled IS 'Returns true if waitlist is enabled for the event. Used in checkout/registration enforcement.';

-- ========================================================
-- 9. Enforcement Helper: is_interest_list_enabled
-- ========================================================

CREATE OR REPLACE FUNCTION public.is_interest_list_enabled(_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _config jsonb;
BEGIN
    SELECT public.get_event_config(_event_id) INTO _config;
    RETURN COALESCE((_config->'interest_list'->>'enabled')::boolean, false);
END;
$$;

COMMENT ON FUNCTION public.is_interest_list_enabled IS 'Returns true if interest list is enabled for the event. Used for pre-registration opt-ins.';

-- ========================================================
-- 10. Enforcement Helper: can_join_waitlist
-- ========================================================

CREATE OR REPLACE FUNCTION public.can_join_waitlist(_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _event_status text;
    _is_sold_out boolean;
    _waitlist_enabled boolean;
BEGIN
    -- Get event status
    SELECT status INTO _event_status
    FROM public.events
    WHERE id = _event_id AND deleted_at IS NULL;
    
    IF NOT FOUND THEN
        RETURN false;
    END IF;
    
    -- Event must be published
    IF _event_status != 'published' THEN
        RETURN false;
    END IF;
    
    -- Check waitlist setting
    _waitlist_enabled := public.is_waitlist_enabled(_event_id);
    IF NOT _waitlist_enabled THEN
        RETURN false;
    END IF;
    
    -- TODO: Check if event is sold out
    -- This requires checking ticket capacity - implement when ticket layer is ready
    -- For now, return true if waitlist is enabled and event is published
    
    RETURN true;
END;
$$;

COMMENT ON FUNCTION public.can_join_waitlist IS 'Returns true if user can join waitlist. Requires: published event, waitlist enabled, sold out. Enforcement function for checkout flow.';

-- ========================================================
-- 11. Enforcement Helper: can_join_interest_list
-- ========================================================

CREATE OR REPLACE FUNCTION public.can_join_interest_list(_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _event_status text;
    _interest_enabled boolean;
BEGIN
    -- Get event status
    SELECT status INTO _event_status
    FROM public.events
    WHERE id = _event_id AND deleted_at IS NULL;
    
    IF NOT FOUND THEN
        RETURN false;
    END IF;
    
    -- Check interest list setting
    _interest_enabled := public.is_interest_list_enabled(_event_id);
    IF NOT _interest_enabled THEN
        RETURN false;
    END IF;
    
    -- Interest list is for events that are:
    -- - draft (not yet published)
    -- - closed (registration closed)
    -- - published but registration not yet open
    -- For published events with open registration, use normal checkout
    
    IF _event_status = 'draft' OR _event_status = 'closed' THEN
        RETURN true;
    END IF;
    
    -- TODO: Check if registration window is open
    -- For now, allow interest when not draft/closed but interest enabled
    RETURN true;
END;
$$;

COMMENT ON FUNCTION public.can_join_interest_list IS 'Returns true if user can join interest list. For draft/closed events or when registration not yet open.';
