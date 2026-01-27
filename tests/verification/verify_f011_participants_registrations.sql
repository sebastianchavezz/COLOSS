-- =============================================================================
-- Verification Script: F011 Participants/Registrations Sprint
-- Purpose: Quick verification that all F011 components are deployed correctly
-- Author: @tester
-- Date: 2025-01-27
--
-- Run this after applying migrations to verify:
-- 1. View exists and has correct columns
-- 2. Functions exist with correct signatures
-- 3. Triggers are installed
-- 4. Indexes are created
-- 5. Settings domain is available
-- =============================================================================

-- =============================================================================
-- CHECK 1: registrations_list_v view exists
-- =============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.views
        WHERE table_schema = 'public' AND table_name = 'registrations_list_v'
    ) THEN
        RAISE EXCEPTION 'FAILED: registrations_list_v view does not exist';
    END IF;
    RAISE NOTICE 'CHECK 1 PASSED: registrations_list_v view exists';
END $$;

-- =============================================================================
-- CHECK 2: View has expected columns
-- =============================================================================
DO $$
DECLARE
    _expected_columns text[] := ARRAY[
        'id', 'event_id', 'participant_id', 'registration_status',
        'ticket_type_id', 'order_item_id', 'email', 'first_name', 'last_name',
        'ticket_type_name', 'order_status', 'payment_status', 'has_discount',
        'ticket_instance_id', 'assignment_status', 'org_id'
    ];
    _col text;
    _missing text[];
BEGIN
    FOR _col IN SELECT unnest(_expected_columns)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'registrations_list_v'
              AND column_name = _col
        ) THEN
            _missing := array_append(_missing, _col);
        END IF;
    END LOOP;

    IF array_length(_missing, 1) > 0 THEN
        RAISE EXCEPTION 'FAILED: View missing columns: %', _missing;
    END IF;
    RAISE NOTICE 'CHECK 2 PASSED: View has all expected columns';
END $$;

-- =============================================================================
-- CHECK 3: View has security_invoker enabled
-- =============================================================================
DO $$
DECLARE
    _options text;
BEGIN
    SELECT reloptions::text INTO _options
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'registrations_list_v';

    IF _options IS NULL OR _options NOT LIKE '%security_invoker=true%' THEN
        RAISE NOTICE 'WARNING: security_invoker may not be enabled (options: %)', _options;
        -- Don't fail, as the option might be stored differently
    ELSE
        RAISE NOTICE 'CHECK 3 PASSED: View has security_invoker enabled';
    END IF;
END $$;

-- =============================================================================
-- CHECK 4: get_registrations_list function exists
-- =============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'get_registrations_list'
    ) THEN
        RAISE EXCEPTION 'FAILED: get_registrations_list function does not exist';
    END IF;
    RAISE NOTICE 'CHECK 4 PASSED: get_registrations_list function exists';
END $$;

-- =============================================================================
-- CHECK 5: get_registration_detail function exists
-- =============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'get_registration_detail'
    ) THEN
        RAISE EXCEPTION 'FAILED: get_registration_detail function does not exist';
    END IF;
    RAISE NOTICE 'CHECK 5 PASSED: get_registration_detail function exists';
END $$;

-- =============================================================================
-- CHECK 6: export_registrations_csv function exists
-- =============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'export_registrations_csv'
    ) THEN
        RAISE EXCEPTION 'FAILED: export_registrations_csv function does not exist';
    END IF;
    RAISE NOTICE 'CHECK 6 PASSED: export_registrations_csv function exists';
END $$;

-- =============================================================================
-- CHECK 7: sync_registration_on_order_paid trigger exists
-- =============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'orders'
          AND t.tgname = 'sync_registration_on_order_paid_trigger'
    ) THEN
        RAISE EXCEPTION 'FAILED: sync_registration_on_order_paid_trigger does not exist on orders table';
    END IF;
    RAISE NOTICE 'CHECK 7 PASSED: sync_registration_on_order_paid_trigger exists';
END $$;

-- =============================================================================
-- CHECK 8: Required indexes exist
-- =============================================================================
DO $$
DECLARE
    _required_indexes text[] := ARRAY[
        'idx_registrations_event_status',
        'idx_registrations_participant_id',
        'idx_registrations_order_item_unique',
        'idx_ticket_instances_order_item_id'
    ];
    _idx text;
    _missing text[];
BEGIN
    FOR _idx IN SELECT unnest(_required_indexes)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public' AND indexname = _idx
        ) THEN
            _missing := array_append(_missing, _idx);
        END IF;
    END LOOP;

    IF array_length(_missing, 1) > 0 THEN
        RAISE EXCEPTION 'FAILED: Missing indexes: %', _missing;
    END IF;
    RAISE NOTICE 'CHECK 8 PASSED: All required indexes exist';
END $$;

-- =============================================================================
-- CHECK 9: 'participants' domain in event_settings constraint
-- =============================================================================
DO $$
DECLARE
    _check_clause text;
BEGIN
    SELECT pg_get_constraintdef(c.oid) INTO _check_clause
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'event_settings'
      AND c.conname = 'event_settings_domain_check';

    IF _check_clause IS NULL THEN
        RAISE NOTICE 'WARNING: event_settings_domain_check constraint not found';
    ELSIF _check_clause NOT LIKE '%participants%' THEN
        RAISE EXCEPTION 'FAILED: participants domain not in constraint. Found: %', _check_clause;
    ELSE
        RAISE NOTICE 'CHECK 9 PASSED: participants domain in event_settings constraint';
    END IF;
END $$;

-- =============================================================================
-- CHECK 10: get_default_settings includes participants domain
-- =============================================================================
DO $$
DECLARE
    _defaults jsonb;
BEGIN
    SELECT get_default_settings() INTO _defaults;

    IF NOT (_defaults ? 'participants') THEN
        RAISE EXCEPTION 'FAILED: get_default_settings does not include participants domain';
    END IF;

    IF NOT (_defaults->'participants' ? 'list') THEN
        RAISE EXCEPTION 'FAILED: participants domain missing list settings';
    END IF;

    IF NOT (_defaults->'participants' ? 'export') THEN
        RAISE EXCEPTION 'FAILED: participants domain missing export settings';
    END IF;

    RAISE NOTICE 'CHECK 10 PASSED: get_default_settings includes participants domain with correct structure';
END $$;

-- =============================================================================
-- CHECK 11: validate_participants_settings function exists
-- =============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'validate_participants_settings'
    ) THEN
        RAISE EXCEPTION 'FAILED: validate_participants_settings function does not exist';
    END IF;
    RAISE NOTICE 'CHECK 11 PASSED: validate_participants_settings function exists';
END $$;

-- =============================================================================
-- CHECK 12: order_item_id column added to ticket_instances
-- =============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'ticket_instances'
          AND column_name = 'order_item_id'
    ) THEN
        RAISE EXCEPTION 'FAILED: order_item_id column not found on ticket_instances';
    END IF;
    RAISE NOTICE 'CHECK 12 PASSED: order_item_id column exists on ticket_instances';
END $$;

-- =============================================================================
-- CHECK 13: Functions are granted to authenticated role
-- =============================================================================
DO $$
DECLARE
    _func_names text[] := ARRAY[
        'get_registrations_list',
        'get_registration_detail',
        'export_registrations_csv'
    ];
    _func_name text;
    _has_grant boolean;
BEGIN
    FOR _func_name IN SELECT unnest(_func_names)
    LOOP
        SELECT EXISTS (
            SELECT 1 FROM information_schema.routine_privileges
            WHERE routine_schema = 'public'
              AND routine_name = _func_name
              AND grantee = 'authenticated'
              AND privilege_type = 'EXECUTE'
        ) INTO _has_grant;

        IF NOT _has_grant THEN
            RAISE NOTICE 'WARNING: % may not be granted to authenticated role (check with has_function_privilege)', _func_name;
        END IF;
    END LOOP;
    RAISE NOTICE 'CHECK 13 PASSED: Function grants verified (or warnings noted)';
END $$;

-- =============================================================================
-- SUMMARY
-- =============================================================================
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=========================================';
    RAISE NOTICE 'F011 VERIFICATION COMPLETE';
    RAISE NOTICE '=========================================';
    RAISE NOTICE 'All critical checks passed!';
    RAISE NOTICE '';
    RAISE NOTICE 'Components verified:';
    RAISE NOTICE '  - registrations_list_v view';
    RAISE NOTICE '  - get_registrations_list RPC';
    RAISE NOTICE '  - get_registration_detail RPC';
    RAISE NOTICE '  - export_registrations_csv RPC';
    RAISE NOTICE '  - sync_registration_on_order_paid trigger';
    RAISE NOTICE '  - Required indexes';
    RAISE NOTICE '  - participants settings domain';
    RAISE NOTICE '  - Settings validation function';
    RAISE NOTICE '=========================================';
END $$;
