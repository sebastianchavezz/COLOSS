-- Migration: 20240121000001_settings_mvp.sql
-- Description: Implements the Settings MVP with org defaults and event overrides.
-- Handles migration from old event_settings table (Layer 2) to new JSONB-based structure.

-- ========================================================
-- 0. Migration / Cleanup of Old Structure
-- ========================================================

-- Drop the trigger that auto-created rows in the old table
DROP TRIGGER IF EXISTS on_event_created ON public.events;
DROP FUNCTION IF EXISTS public.handle_new_event();

-- Rename old table if it exists and has the old structure
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'event_settings' 
        AND column_name = 'vat_percentage' -- Old column
    ) THEN
        ALTER TABLE public.event_settings RENAME TO event_settings_old;
        
        -- Rename constraints to avoid conflict with new table
        -- We try to rename if they exist. 
        -- Note: Constraint names are unique per schema.
        
        -- PK
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_settings_pkey') THEN
            ALTER TABLE public.event_settings_old RENAME CONSTRAINT event_settings_pkey TO event_settings_old_pkey;
        END IF;

        -- FK
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_settings_event_id_fkey') THEN
            ALTER TABLE public.event_settings_old RENAME CONSTRAINT event_settings_event_id_fkey TO event_settings_old_event_id_fkey;
        END IF;
    END IF;
END $$;

-- ========================================================
-- 1. Tables
-- ========================================================

-- Org Settings (Defaults)
CREATE TABLE IF NOT EXISTS public.org_settings (
    org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
    domain text NOT NULL,
    setting_value jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    
    CONSTRAINT org_settings_pkey PRIMARY KEY (org_id, domain),
    CONSTRAINT org_settings_domain_check CHECK (domain IN ('payments', 'transfers', 'communication'))
);

-- Event Settings (Overrides)
CREATE TABLE IF NOT EXISTS public.event_settings (
    event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    domain text NOT NULL,
    setting_value jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    
    CONSTRAINT event_settings_pkey PRIMARY KEY (event_id, domain),
    CONSTRAINT event_settings_domain_check CHECK (domain IN ('payments', 'transfers', 'communication'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_org_settings_org_domain ON public.org_settings(org_id, domain);
CREATE INDEX IF NOT EXISTS idx_event_settings_event_domain ON public.event_settings(event_id, domain);

-- ========================================================
-- 1.5 Data Migration (from _old)
-- ========================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'event_settings_old') THEN
        -- Migrate Communication (support_email)
        INSERT INTO public.event_settings (event_id, domain, setting_value)
        SELECT 
            event_id, 
            'communication', 
            jsonb_build_object(
                'reply_to_email', COALESCE(support_email, ''), 
                'default_locale', 'nl', 
                'confirmation_message', ''
            )
        FROM public.event_settings_old
        WHERE support_email IS NOT NULL
        ON CONFLICT DO NOTHING;

        -- Migrate Payments (vat_percentage)
        INSERT INTO public.event_settings (event_id, domain, setting_value)
        SELECT 
            event_id, 
            'payments', 
            jsonb_build_object(
                'vat_rate', COALESCE(vat_percentage, 21), 
                'invoice_prefix', '', 
                'vat_number', '', 
                'payment_profile_id', null
            )
        FROM public.event_settings_old
        ON CONFLICT DO NOTHING;
    END IF;
END $$;

-- ========================================================
-- 2. RLS Policies (Default Deny)
-- ========================================================

ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_settings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid conflicts on re-run
DROP POLICY IF EXISTS "Org members can view org settings" ON public.org_settings;
DROP POLICY IF EXISTS "Org members can view event settings" ON public.event_settings;

-- Org Settings: Read-only for org members
CREATE POLICY "Org members can view org settings"
    ON public.org_settings
    FOR SELECT
    USING (public.is_org_member(org_id));

-- Event Settings: Read-only for org members (via event -> org)
CREATE POLICY "Org members can view event settings"
    ON public.event_settings
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.events e
            WHERE e.id = event_settings.event_id
            AND public.is_org_member(e.org_id)
        )
    );

-- Writes are ONLY allowed via RPC (Security Definer)

-- ========================================================
-- 3. Validation Helpers
-- ========================================================

CREATE OR REPLACE FUNCTION public.validate_setting_domain(_domain text, _value jsonb)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
    CASE _domain
        WHEN 'payments' THEN
            -- payment_profile_id (uuid/null), invoice_prefix (string), vat_number (string), vat_rate (number)
            IF (_value ? 'payment_profile_id') AND (_value->>'payment_profile_id' IS NOT NULL) THEN
                IF NOT (_value->>'payment_profile_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') THEN
                    RAISE EXCEPTION 'Invalid payment_profile_id format';
                END IF;
            END IF;
            IF (_value ? 'vat_rate') AND NOT (jsonb_typeof(_value->'vat_rate') = 'number') THEN
                RAISE EXCEPTION 'vat_rate must be a number';
            END IF;
            
        WHEN 'transfers' THEN
            -- transfers_enabled (bool), transfer_expiry_hours (int), cancel_roles (array)
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
            -- reply_to_email (string), default_locale (string), confirmation_message (string)
            IF (_value ? 'reply_to_email') AND NOT (jsonb_typeof(_value->'reply_to_email') = 'string') THEN
                RAISE EXCEPTION 'reply_to_email must be a string';
            END IF;
            IF (_value ? 'default_locale') AND NOT (_value->>'default_locale' IN ('nl', 'en', 'fr')) THEN
                RAISE EXCEPTION 'default_locale must be nl, en, or fr';
            END IF;
            
        ELSE
            RAISE EXCEPTION 'Unknown domain: %', _domain;
    END CASE;

    RETURN true;
END;
$$;

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
        ELSE
            RETURN '{}'::jsonb;
    END CASE;
END;
$$;

-- ========================================================
-- 4. RPC: Get Effective Event Settings
-- ========================================================

CREATE OR REPLACE FUNCTION public.get_effective_event_settings(_event_id uuid)
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
        RAISE EXCEPTION 'Event not found';
    END IF;

    -- 2. Check Access (Member of Org)
    IF NOT public.is_org_member(_org_id) THEN
        RAISE EXCEPTION 'Not authorized';
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

        -- D. Merge: Defaults || Org || Event
        _result := jsonb_set(_result, ARRAY[_domain], _defaults || _org_val || _event_val);
    END LOOP;

    RETURN _result;
END;
$$;

-- ========================================================
-- 5. RPC: Set Event Setting (Override)
-- ========================================================

CREATE OR REPLACE FUNCTION public.set_event_setting(_event_id uuid, _domain text, _value jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _org_id uuid;
    _role text;
    _old_value jsonb;
BEGIN
    -- 1. Get Org ID
    SELECT org_id INTO _org_id FROM public.events WHERE id = _event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event not found';
    END IF;

    -- 2. Get User Role
    SELECT role INTO _role
    FROM public.org_members
    WHERE org_id = _org_id AND user_id = auth.uid();

    IF _role IS NULL THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    -- 3. RBAC Checks
    IF _role = 'finance' THEN
        RAISE EXCEPTION 'Finance role is read-only';
    END IF;

    IF _domain = 'payments' AND _role NOT IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'Only owner/admin can manage payment settings';
    END IF;

    -- 4. Validate Schema
    PERFORM public.validate_setting_domain(_domain, _value);

    -- 5. Get Old Value (for audit)
    SELECT setting_value INTO _old_value
    FROM public.event_settings
    WHERE event_id = _event_id AND domain = _domain;

    -- 6. Upsert
    INSERT INTO public.event_settings (event_id, domain, setting_value, updated_by, updated_at)
    VALUES (_event_id, _domain, _value, auth.uid(), now())
    ON CONFLICT (event_id, domain) 
    DO UPDATE SET 
        setting_value = EXCLUDED.setting_value,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at;

    -- 7. Audit Log
    INSERT INTO public.audit_log (
        org_id, actor_user_id, action, resource_type, resource_id,
        entity_type, entity_id, before_state, after_state, metadata
    ) VALUES (
        _org_id, 
        auth.uid(), 
        'SETTINGS_EVENT_UPDATED', 
        'event', 
        _event_id,
        'setting', 
        _domain || ':event',
        CASE WHEN _old_value IS NOT NULL THEN jsonb_build_object('value', _old_value) ELSE NULL END,
        jsonb_build_object('value', _value),
        jsonb_build_object('domain', _domain)
    );

    RETURN true;
END;
$$;

-- ========================================================
-- 6. RPC: Set Org Setting (Default)
-- ========================================================

CREATE OR REPLACE FUNCTION public.set_org_setting(_org_id uuid, _domain text, _value jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _role text;
    _old_value jsonb;
BEGIN
    -- 1. Get User Role
    SELECT role INTO _role
    FROM public.org_members
    WHERE org_id = _org_id AND user_id = auth.uid();

    IF _role IS NULL THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    -- 2. RBAC Checks
    IF _role = 'finance' THEN
        RAISE EXCEPTION 'Finance role is read-only';
    END IF;

    IF _domain = 'payments' AND _role NOT IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'Only owner/admin can manage payment settings';
    END IF;

    -- 3. Validate Schema
    PERFORM public.validate_setting_domain(_domain, _value);

    -- 4. Get Old Value
    SELECT setting_value INTO _old_value
    FROM public.org_settings
    WHERE org_id = _org_id AND domain = _domain;

    -- 5. Upsert
    INSERT INTO public.org_settings (org_id, domain, setting_value, updated_by, updated_at)
    VALUES (_org_id, _domain, _value, auth.uid(), now())
    ON CONFLICT (org_id, domain) 
    DO UPDATE SET 
        setting_value = EXCLUDED.setting_value,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at;

    -- 6. Audit Log
    INSERT INTO public.audit_log (
        org_id, actor_user_id, action, resource_type, resource_id,
        entity_type, entity_id, before_state, after_state, metadata
    ) VALUES (
        _org_id, 
        auth.uid(), 
        'SETTINGS_ORG_UPDATED', 
        'org', 
        _org_id,
        'setting', 
        _domain || ':org',
        CASE WHEN _old_value IS NOT NULL THEN jsonb_build_object('value', _old_value) ELSE NULL END,
        jsonb_build_object('value', _value),
        jsonb_build_object('domain', _domain)
    );

    RETURN true;
END;
$$;
