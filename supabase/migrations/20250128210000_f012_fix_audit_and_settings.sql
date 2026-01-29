-- ===========================================================================
-- F012 Fix: Audit trigger column mismatch, missing 'messaging' domain,
--           search_vector column for FAQ full-text search, and permission hardening
-- Migration: 20250128210000_f012_fix_audit_and_settings.sql
--
-- Purpose:
--   1. Fix audit_chat_thread_status_change() to include resource_type + resource_id
--      (NOT NULL columns in audit_log that were missing from the trigger INSERT).
--   2. Add 'messaging' WHEN clause to validate_setting_domain() so that
--      org_settings / event_settings with domain='messaging' pass validation.
--   3. Add search_vector generated column to faq_items for full-text search.
--   4. Restrict EXECUTE on get_or_create_chat_thread to service_role only.
-- ===========================================================================

-- ===========================================================================
-- 1. FIX AUDIT TRIGGER: add resource_type + resource_id (NOT NULL)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.audit_chat_thread_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Only log if status actually changed
    IF OLD.status != NEW.status THEN
        INSERT INTO public.audit_log (
            org_id,
            actor_user_id,
            action,
            -- Legacy NOT NULL columns (mirrored to entity_* for dual-index support)
            resource_type,
            resource_id,
            -- New structured columns
            entity_type,
            entity_id,
            before_state,
            after_state,
            metadata
        ) VALUES (
            NEW.org_id,
            auth.uid(),
            'THREAD_STATUS_CHANGED',
            -- resource_type / resource_id mirror entity fields
            'chat_thread',
            NEW.id,
            -- entity fields
            'chat_thread',
            NEW.id,
            jsonb_build_object('status', OLD.status::text),
            jsonb_build_object('status', NEW.status::text),
            jsonb_build_object(
                'event_id', NEW.event_id,
                'participant_id', NEW.participant_id
            )
        );
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.audit_chat_thread_status_change IS
    'Trigger: logs thread status changes to audit_log. Includes both resource_* and entity_* columns.';

-- ===========================================================================
-- 2. FIX validate_setting_domain: add 'messaging' WHEN clause
-- ===========================================================================
-- We need to read the full existing function and add the WHEN 'messaging' branch
-- before the ELSE clause. Since CREATE OR REPLACE replaces the entire body,
-- we rebuild the function with the new branch inserted.
-- The approach: add a 'messaging' WHEN that delegates to validate_messaging_settings().

-- First, ensure validate_messaging_settings exists (created in F012 base migration).
-- Then patch validate_setting_domain to route 'messaging' to it.

DO $$
DECLARE
    _src text;
BEGIN
    -- Read current source
    SELECT prosrc INTO _src FROM pg_proc WHERE proname = 'validate_setting_domain';

    -- Only patch if 'messaging' WHEN is not already present
    IF _src IS NOT NULL AND _src NOT LIKE '%WHEN ''messaging''%' THEN
        -- Replace the ELSE clause with a messaging WHEN + the original ELSE
        _src := replace(
            _src,
            'ELSE
            RAISE EXCEPTION ''Unknown domain: %'', _domain;',
            'WHEN ''messaging'' THEN
            -- Delegate to the dedicated messaging validator
            PERFORM public.validate_messaging_settings(_value);

        ELSE
            RAISE EXCEPTION ''Unknown domain: %'', _domain;'
        );

        -- Execute the patched function definition
        EXECUTE format(
            'CREATE OR REPLACE FUNCTION public.validate_setting_domain(_domain text, _value jsonb) '
            'RETURNS boolean LANGUAGE plpgsql AS $fn$%s$fn$;',
            _src
        );

        RAISE NOTICE 'validate_setting_domain patched: added messaging WHEN clause.';
    ELSE
        RAISE NOTICE 'validate_setting_domain already contains messaging clause or source not found.';
    END IF;
END $$;

-- ===========================================================================
-- 3. ADD search_vector GENERATED COLUMN to faq_items
-- ===========================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'faq_items'
          AND column_name = 'search_vector'
    ) THEN
        ALTER TABLE public.faq_items
            ADD COLUMN search_vector tsvector
                GENERATED ALWAYS AS (
                    to_tsvector('dutch', coalesce(title, '') || ' ' || coalesce(content, ''))
                ) STORED;

        RAISE NOTICE 'Added search_vector generated column to faq_items.';
    ELSE
        RAISE NOTICE 'search_vector column already exists on faq_items.';
    END IF;
END $$;

-- Create GIN index on the generated column (drop expression-based index first if it exists)
DROP INDEX IF EXISTS idx_faq_items_search;
CREATE INDEX IF NOT EXISTS idx_faq_items_search
    ON public.faq_items USING GIN (search_vector);

-- ===========================================================================
-- 4. RESTRICT get_or_create_chat_thread to service_role only
-- ===========================================================================

REVOKE ALL ON FUNCTION public.get_or_create_chat_thread(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_or_create_chat_thread(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_or_create_chat_thread(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_chat_thread(uuid, uuid) TO service_role;

-- ===========================================================================
-- VERIFICATION
-- ===========================================================================

DO $$
BEGIN
    -- Verify audit trigger has resource_type + resource_id
    ASSERT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE proname = 'audit_chat_thread_status_change'
        AND prosrc LIKE '%resource_type%'
    ), 'Audit trigger still missing resource_type column';

    -- Verify search_vector column exists
    ASSERT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'faq_items'
          AND column_name = 'search_vector'
    ), 'search_vector column missing on faq_items';

    -- Verify GIN index exists
    ASSERT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'faq_items'
        AND indexname = 'idx_faq_items_search'
    ), 'GIN index idx_faq_items_search missing';

    RAISE NOTICE 'F012 fix migration: all verifications passed.';
END $$;

-- End of migration
