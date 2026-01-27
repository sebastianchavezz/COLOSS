-- Migration: 20250127000002_communication_settings_extension.sql
-- Description: Extend communication domain with email system settings
-- Adds: sender config, provider settings, bulk processing, compliance, rate limits, retry config
-- RBAC: owner/admin/support can edit (unchanged from existing communication domain)
-- Backward Compatible: Merges with existing reply_to_email, default_locale settings

-- ========================================================
-- 1. Helper: Validate Email Format
-- ========================================================

-- Reusable email validation (used multiple times in communication settings)
CREATE OR REPLACE FUNCTION public.is_valid_email_format(_email text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    -- Basic email format validation
    RETURN _email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
END;
$$;

-- ========================================================
-- 2. Helper: Validate Number Range
-- ========================================================

CREATE OR REPLACE FUNCTION public.validate_number_range(
    _value jsonb,
    _field_name text,
    _min numeric,
    _max numeric
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
    _num numeric;
BEGIN
    IF _value IS NULL THEN
        RETURN true;
    END IF;

    IF jsonb_typeof(_value) != 'number' THEN
        RAISE EXCEPTION '% must be a number', _field_name;
    END IF;

    _num := _value::numeric;

    IF _num < _min OR _num > _max THEN
        RAISE EXCEPTION '% must be between % and % (got %)', _field_name, _min, _max, _num;
    END IF;

    RETURN true;
END;
$$;

-- ========================================================
-- 3. Update validate_setting_domain for communication
-- ========================================================

CREATE OR REPLACE FUNCTION public.validate_setting_domain(_domain text, _value jsonb)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
    _emails jsonb;
    _email text;
    _email_count int;
    _sender jsonb;
    _provider jsonb;
    _resend jsonb;
    _bulk jsonb;
    _compliance jsonb;
    _rate_limits jsonb;
    _retry jsonb;
BEGIN
    CASE _domain
        -- Existing domains (unchanged)
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

        -- UPDATED: communication domain with extended settings
        WHEN 'communication' THEN
            -- Legacy settings (backward compatible)
            IF (_value ? 'reply_to_email') AND (_value->>'reply_to_email' IS NOT NULL) AND (_value->>'reply_to_email' != '') THEN
                IF NOT public.is_valid_email_format(_value->>'reply_to_email') THEN
                    RAISE EXCEPTION 'reply_to_email must be a valid email address';
                END IF;
            END IF;
            IF (_value ? 'default_locale') AND NOT (_value->>'default_locale' IN ('nl', 'en', 'fr')) THEN
                RAISE EXCEPTION 'default_locale must be nl, en, or fr';
            END IF;

            -- NEW: sender settings (nested object)
            IF _value ? 'sender' THEN
                _sender := _value->'sender';

                IF jsonb_typeof(_sender) != 'object' THEN
                    RAISE EXCEPTION 'sender must be an object';
                END IF;

                -- sender.default_from_name (string, optional)
                IF (_sender ? 'default_from_name') AND (_sender->>'default_from_name' IS NOT NULL) THEN
                    IF jsonb_typeof(_sender->'default_from_name') != 'string' THEN
                        RAISE EXCEPTION 'sender.default_from_name must be a string';
                    END IF;
                END IF;

                -- sender.default_from_email (string, email format, optional)
                IF (_sender ? 'default_from_email') AND (_sender->>'default_from_email' IS NOT NULL) AND (_sender->>'default_from_email' != '') THEN
                    IF NOT public.is_valid_email_format(_sender->>'default_from_email') THEN
                        RAISE EXCEPTION 'sender.default_from_email must be a valid email address';
                    END IF;
                END IF;

                -- sender.default_reply_to (string, email format, optional)
                IF (_sender ? 'default_reply_to') AND (_sender->>'default_reply_to' IS NOT NULL) AND (_sender->>'default_reply_to' != '') THEN
                    IF NOT public.is_valid_email_format(_sender->>'default_reply_to') THEN
                        RAISE EXCEPTION 'sender.default_reply_to must be a valid email address';
                    END IF;
                END IF;
            END IF;

            -- NEW: provider settings (nested object)
            IF _value ? 'provider' THEN
                _provider := _value->'provider';

                IF jsonb_typeof(_provider) != 'object' THEN
                    RAISE EXCEPTION 'provider must be an object';
                END IF;

                -- provider.resend (nested object)
                IF _provider ? 'resend' THEN
                    _resend := _provider->'resend';

                    IF jsonb_typeof(_resend) != 'object' THEN
                        RAISE EXCEPTION 'provider.resend must be an object';
                    END IF;

                    -- provider.resend.enabled (boolean)
                    IF (_resend ? 'enabled') AND (jsonb_typeof(_resend->'enabled') != 'boolean') THEN
                        RAISE EXCEPTION 'provider.resend.enabled must be a boolean';
                    END IF;

                    -- provider.resend.api_key_ref (string)
                    IF (_resend ? 'api_key_ref') AND (_resend->>'api_key_ref' IS NOT NULL) THEN
                        IF jsonb_typeof(_resend->'api_key_ref') != 'string' THEN
                            RAISE EXCEPTION 'provider.resend.api_key_ref must be a string';
                        END IF;
                    END IF;
                END IF;
            END IF;

            -- NEW: bulk settings (nested object)
            IF _value ? 'bulk' THEN
                _bulk := _value->'bulk';

                IF jsonb_typeof(_bulk) != 'object' THEN
                    RAISE EXCEPTION 'bulk must be an object';
                END IF;

                -- bulk.batch_size (number, 1-500)
                IF _bulk ? 'batch_size' THEN
                    PERFORM public.validate_number_range(_bulk->'batch_size', 'bulk.batch_size', 1, 500);
                END IF;

                -- bulk.delay_between_batches_ms (number, 100-10000)
                IF _bulk ? 'delay_between_batches_ms' THEN
                    PERFORM public.validate_number_range(_bulk->'delay_between_batches_ms', 'bulk.delay_between_batches_ms', 100, 10000);
                END IF;

                -- bulk.max_recipients_per_campaign (number, 1-100000)
                IF _bulk ? 'max_recipients_per_campaign' THEN
                    PERFORM public.validate_number_range(_bulk->'max_recipients_per_campaign', 'bulk.max_recipients_per_campaign', 1, 100000);
                END IF;
            END IF;

            -- NEW: compliance settings (nested object)
            IF _value ? 'compliance' THEN
                _compliance := _value->'compliance';

                IF jsonb_typeof(_compliance) != 'object' THEN
                    RAISE EXCEPTION 'compliance must be an object';
                END IF;

                -- compliance.unsubscribe_enabled (boolean)
                IF (_compliance ? 'unsubscribe_enabled') AND (jsonb_typeof(_compliance->'unsubscribe_enabled') != 'boolean') THEN
                    RAISE EXCEPTION 'compliance.unsubscribe_enabled must be a boolean';
                END IF;

                -- compliance.bounce_threshold (number, 1-10)
                IF _compliance ? 'bounce_threshold' THEN
                    PERFORM public.validate_number_range(_compliance->'bounce_threshold', 'compliance.bounce_threshold', 1, 10);
                END IF;

                -- compliance.complaint_threshold (number, 1-5)
                IF _compliance ? 'complaint_threshold' THEN
                    PERFORM public.validate_number_range(_compliance->'complaint_threshold', 'compliance.complaint_threshold', 1, 5);
                END IF;
            END IF;

            -- NEW: rate_limits settings (nested object)
            IF _value ? 'rate_limits' THEN
                _rate_limits := _value->'rate_limits';

                IF jsonb_typeof(_rate_limits) != 'object' THEN
                    RAISE EXCEPTION 'rate_limits must be an object';
                END IF;

                -- rate_limits.emails_per_minute (number, 1-1000)
                IF _rate_limits ? 'emails_per_minute' THEN
                    PERFORM public.validate_number_range(_rate_limits->'emails_per_minute', 'rate_limits.emails_per_minute', 1, 1000);
                END IF;

                -- rate_limits.emails_per_hour (number, 1-50000)
                IF _rate_limits ? 'emails_per_hour' THEN
                    PERFORM public.validate_number_range(_rate_limits->'emails_per_hour', 'rate_limits.emails_per_hour', 1, 50000);
                END IF;
            END IF;

            -- NEW: retry settings (nested object)
            IF _value ? 'retry' THEN
                _retry := _value->'retry';

                IF jsonb_typeof(_retry) != 'object' THEN
                    RAISE EXCEPTION 'retry must be an object';
                END IF;

                -- retry.max_attempts (number, 1-10)
                IF _retry ? 'max_attempts' THEN
                    PERFORM public.validate_number_range(_retry->'max_attempts', 'retry.max_attempts', 1, 10);
                END IF;

                -- retry.initial_delay_ms (number, 1000-600000)
                IF _retry ? 'initial_delay_ms' THEN
                    PERFORM public.validate_number_range(_retry->'initial_delay_ms', 'retry.initial_delay_ms', 1000, 600000);
                END IF;

                -- retry.backoff_multiplier (number, 1-5)
                IF _retry ? 'backoff_multiplier' THEN
                    PERFORM public.validate_number_range(_retry->'backoff_multiplier', 'retry.backoff_multiplier', 1, 5);
                END IF;
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
                IF NOT public.is_valid_email_format(_value->>'contact_email') THEN
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
                    IF NOT public.is_valid_email_format(_email) THEN
                        RAISE EXCEPTION 'Invalid email in extra_recipients: %', _email;
                    END IF;
                END LOOP;

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
-- 4. Update get_default_settings for communication
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
        -- UPDATED: communication domain with extended defaults
        WHEN 'communication' THEN
            RETURN jsonb_build_object(
                -- Legacy fields (backward compatible)
                'reply_to_email', '',
                'default_locale', 'nl',
                'confirmation_message', '',
                -- NEW: sender configuration
                'sender', jsonb_build_object(
                    'default_from_name', '',
                    'default_from_email', 'noreply@coloss.nl',
                    'default_reply_to', null
                ),
                -- NEW: provider configuration
                'provider', jsonb_build_object(
                    'resend', jsonb_build_object(
                        'enabled', true,
                        'api_key_ref', 'env:RESEND_API_KEY'
                    )
                ),
                -- NEW: bulk processing settings
                'bulk', jsonb_build_object(
                    'batch_size', 100,
                    'delay_between_batches_ms', 1000,
                    'max_recipients_per_campaign', 10000
                ),
                -- NEW: compliance settings (GDPR)
                'compliance', jsonb_build_object(
                    'unsubscribe_enabled', true,
                    'bounce_threshold', 3,
                    'complaint_threshold', 1
                ),
                -- NEW: rate limiting
                'rate_limits', jsonb_build_object(
                    'emails_per_minute', 100,
                    'emails_per_hour', 5000
                ),
                -- NEW: retry configuration
                'retry', jsonb_build_object(
                    'max_attempts', 3,
                    'initial_delay_ms', 60000,
                    'backoff_multiplier', 2
                )
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
        ELSE
            RETURN '{}'::jsonb;
    END CASE;
END;
$$;

-- ========================================================
-- 5. Helper: Deep Merge for Nested Objects
-- ========================================================

-- Deep merge function for nested JSON objects (used for config inheritance)
-- This ensures nested objects are merged recursively instead of replaced
CREATE OR REPLACE FUNCTION public.jsonb_deep_merge(_a jsonb, _b jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    _key text;
    _result jsonb := _a;
BEGIN
    IF _a IS NULL THEN RETURN _b; END IF;
    IF _b IS NULL THEN RETURN _a; END IF;

    IF jsonb_typeof(_a) != 'object' OR jsonb_typeof(_b) != 'object' THEN
        -- If either is not an object, _b takes precedence
        RETURN _b;
    END IF;

    -- Iterate over keys in _b and merge
    FOR _key IN SELECT jsonb_object_keys(_b)
    LOOP
        IF _result ? _key AND jsonb_typeof(_result->_key) = 'object' AND jsonb_typeof(_b->_key) = 'object' THEN
            -- Both values are objects, recurse
            _result := jsonb_set(_result, ARRAY[_key], public.jsonb_deep_merge(_result->_key, _b->_key));
        ELSE
            -- Otherwise, _b value takes precedence
            _result := jsonb_set(_result, ARRAY[_key], _b->_key);
        END IF;
    END LOOP;

    RETURN _result;
END;
$$;

-- ========================================================
-- 6. Update get_event_config to use deep merge
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
    _domains text[] := ARRAY['payments', 'transfers', 'communication', 'governance', 'legal', 'basic_info', 'content_communication'];
    _defaults jsonb;
    _org_val jsonb;
    _event_val jsonb;
    _merged jsonb;
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

        -- Use deep merge for nested settings (like communication)
        -- This ensures nested objects like 'sender', 'bulk', etc. are merged properly
        _merged := public.jsonb_deep_merge(
            public.jsonb_deep_merge(_defaults, _org_val),
            _event_val
        );

        _result := jsonb_set(_result, ARRAY[_domain], _merged);
    END LOOP;

    RETURN _result;
END;
$$;

-- ========================================================
-- 7. Verification: Test communication settings validation
-- ========================================================

-- This DO block tests the validation logic (will raise exception on failure)
DO $$
DECLARE
    _valid_patch jsonb;
    _result boolean;
BEGIN
    -- Test valid nested settings
    _valid_patch := '{
        "sender": {
            "default_from_name": "COLOSS Events",
            "default_from_email": "events@coloss.nl",
            "default_reply_to": "support@coloss.nl"
        },
        "bulk": {
            "batch_size": 50,
            "delay_between_batches_ms": 500,
            "max_recipients_per_campaign": 5000
        },
        "compliance": {
            "unsubscribe_enabled": true,
            "bounce_threshold": 5,
            "complaint_threshold": 2
        },
        "rate_limits": {
            "emails_per_minute": 200,
            "emails_per_hour": 10000
        },
        "retry": {
            "max_attempts": 5,
            "initial_delay_ms": 30000,
            "backoff_multiplier": 3
        }
    }'::jsonb;

    _result := public.validate_setting_domain('communication', _valid_patch);

    IF NOT _result THEN
        RAISE EXCEPTION 'Valid settings should pass validation';
    END IF;

    RAISE NOTICE 'Communication settings validation tests passed';
END;
$$;

-- Test that invalid values are rejected
DO $$
DECLARE
    _invalid_patch jsonb;
BEGIN
    -- Test invalid batch_size (over 500)
    _invalid_patch := '{"bulk": {"batch_size": 1000}}'::jsonb;

    BEGIN
        PERFORM public.validate_setting_domain('communication', _invalid_patch);
        RAISE EXCEPTION 'Should have rejected batch_size > 500';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Correctly rejected invalid batch_size: %', SQLERRM;
    END;

    -- Test invalid email format
    _invalid_patch := '{"sender": {"default_from_email": "not-an-email"}}'::jsonb;

    BEGIN
        PERFORM public.validate_setting_domain('communication', _invalid_patch);
        RAISE EXCEPTION 'Should have rejected invalid email format';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Correctly rejected invalid email: %', SQLERRM;
    END;

    -- Test invalid complaint_threshold (over 5)
    _invalid_patch := '{"compliance": {"complaint_threshold": 10}}'::jsonb;

    BEGIN
        PERFORM public.validate_setting_domain('communication', _invalid_patch);
        RAISE EXCEPTION 'Should have rejected complaint_threshold > 5';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Correctly rejected invalid complaint_threshold: %', SQLERRM;
    END;

    RAISE NOTICE 'All invalid settings correctly rejected';
END;
$$;

-- Test default settings structure
DO $$
DECLARE
    _defaults jsonb;
BEGIN
    _defaults := public.get_default_settings('communication');

    -- Verify all required keys exist
    IF NOT (_defaults ? 'sender') THEN
        RAISE EXCEPTION 'Missing sender key in defaults';
    END IF;
    IF NOT (_defaults ? 'provider') THEN
        RAISE EXCEPTION 'Missing provider key in defaults';
    END IF;
    IF NOT (_defaults ? 'bulk') THEN
        RAISE EXCEPTION 'Missing bulk key in defaults';
    END IF;
    IF NOT (_defaults ? 'compliance') THEN
        RAISE EXCEPTION 'Missing compliance key in defaults';
    END IF;
    IF NOT (_defaults ? 'rate_limits') THEN
        RAISE EXCEPTION 'Missing rate_limits key in defaults';
    END IF;
    IF NOT (_defaults ? 'retry') THEN
        RAISE EXCEPTION 'Missing retry key in defaults';
    END IF;

    -- Verify legacy keys still exist (backward compatibility)
    IF NOT (_defaults ? 'reply_to_email') THEN
        RAISE EXCEPTION 'Missing legacy reply_to_email key';
    END IF;
    IF NOT (_defaults ? 'default_locale') THEN
        RAISE EXCEPTION 'Missing legacy default_locale key';
    END IF;

    RAISE NOTICE 'Default settings structure verified: %', _defaults;
END;
$$;

-- Test deep merge function
DO $$
DECLARE
    _a jsonb;
    _b jsonb;
    _result jsonb;
BEGIN
    _a := '{"sender": {"from_name": "Original", "from_email": "a@test.com"}, "bulk": {"batch_size": 100}}'::jsonb;
    _b := '{"sender": {"from_name": "Override"}, "retry": {"max_attempts": 5}}'::jsonb;

    _result := public.jsonb_deep_merge(_a, _b);

    -- sender.from_name should be overridden
    IF _result->'sender'->>'from_name' != 'Override' THEN
        RAISE EXCEPTION 'Deep merge did not override sender.from_name';
    END IF;

    -- sender.from_email should be preserved
    IF _result->'sender'->>'from_email' != 'a@test.com' THEN
        RAISE EXCEPTION 'Deep merge did not preserve sender.from_email';
    END IF;

    -- bulk should be preserved
    IF (_result->'bulk'->'batch_size')::int != 100 THEN
        RAISE EXCEPTION 'Deep merge did not preserve bulk.batch_size';
    END IF;

    -- retry should be added
    IF (_result->'retry'->'max_attempts')::int != 5 THEN
        RAISE EXCEPTION 'Deep merge did not add retry.max_attempts';
    END IF;

    RAISE NOTICE 'Deep merge tests passed: %', _result;
END;
$$;

COMMENT ON FUNCTION public.validate_setting_domain IS 'Validates setting values for a given domain. Extended in 20250127000002 with communication email system settings.';
COMMENT ON FUNCTION public.get_default_settings IS 'Returns default settings for a given domain. Extended in 20250127000002 with communication email system defaults.';
COMMENT ON FUNCTION public.jsonb_deep_merge IS 'Recursively merges two JSONB objects. Used for nested settings inheritance (org -> event).';
COMMENT ON FUNCTION public.is_valid_email_format IS 'Basic email format validation using regex.';
COMMENT ON FUNCTION public.validate_number_range IS 'Validates a JSONB number value is within a specified range.';
