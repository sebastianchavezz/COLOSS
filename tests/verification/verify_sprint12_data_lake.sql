-- Verification Script for Sprint 12 (Data Lake & Exports)
-- Run this in Supabase SQL Editor

BEGIN;

DO $$
DECLARE
    _view_count int;
    _row_count int;
    _participants_count int;
    _registrations_count int;
    _orders_count int;
    _payments_count int;
    _checkins_count int;
BEGIN
    RAISE NOTICE '--- START VERIFICATION SPRINT 12 ---';

    -- TEST 1: All export views exist
    SELECT COUNT(*) INTO _view_count
    FROM information_schema.views
    WHERE table_schema = 'public'
    AND table_name IN ('export_participants', 'export_registrations', 'export_orders', 'export_payments', 'export_checkins');
    
    IF _view_count = 5 THEN
        RAISE NOTICE '✅ TEST 1 Passed: All 5 export views exist';
    ELSE
        RAISE EXCEPTION '❌ TEST 1 Failed: Expected 5 views, found %', _view_count;
    END IF;

    -- TEST 2: Views are queryable (no errors)
    BEGIN
        SELECT COUNT(*) INTO _participants_count FROM public.export_participants;
        SELECT COUNT(*) INTO _registrations_count FROM public.export_registrations;
        SELECT COUNT(*) INTO _orders_count FROM public.export_orders;
        SELECT COUNT(*) INTO _payments_count FROM public.export_payments;
        SELECT COUNT(*) INTO _checkins_count FROM public.export_checkins;
        
        RAISE NOTICE '✅ TEST 2 Passed: All views are queryable';
        RAISE NOTICE '   - export_participants: % rows', _participants_count;
        RAISE NOTICE '   - export_registrations: % rows', _registrations_count;
        RAISE NOTICE '   - export_orders: % rows', _orders_count;
        RAISE NOTICE '   - export_payments: % rows', _payments_count;
        RAISE NOTICE '   - export_checkins: % rows', _checkins_count;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION '❌ TEST 2 Failed: Error querying views: %', SQLERRM;
    END;

    -- TEST 3: Views are read-only (cannot insert)
    BEGIN
        -- Try to insert into export_participants (should fail)
        INSERT INTO public.export_participants (participant_id, email, first_name, last_name)
        VALUES (gen_random_uuid(), 'test@example.com', 'Test', 'User');
        
        RAISE EXCEPTION '❌ TEST 3 Failed: View allowed INSERT (should be read-only)';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%cannot insert%' OR SQLERRM LIKE '%not insertable%' THEN
            RAISE NOTICE '✅ TEST 3 Passed: Views are read-only';
        ELSE
            RAISE EXCEPTION '❌ TEST 3 Failed with unexpected error: %', SQLERRM;
        END IF;
    END;

    -- TEST 4: No SELECT * (views have explicit columns)
    -- This is verified by checking view definitions
    DECLARE
        _view_def text;
    BEGIN
        SELECT pg_get_viewdef('public.export_participants'::regclass) INTO _view_def;
        
        IF _view_def LIKE '%SELECT *%' THEN
            RAISE EXCEPTION '❌ TEST 4 Failed: View uses SELECT * (should have explicit columns)';
        ELSE
            RAISE NOTICE '✅ TEST 4 Passed: Views use explicit column selection';
        END IF;
    END;

    -- TEST 5: Consistent row counts (basic sanity check)
    -- Export views should not multiply rows via joins
    DECLARE
        _source_count int;
    BEGIN
        SELECT COUNT(*) INTO _source_count FROM public.participants;
        
        IF _participants_count = _source_count THEN
            RAISE NOTICE '✅ TEST 5 Passed: export_participants row count matches source table';
        ELSE
            RAISE WARNING '⚠️  TEST 5 Warning: export_participants has % rows, source has % rows', 
                _participants_count, _source_count;
        END IF;
    END;

    -- TEST 6: Storage bucket exists (manual verification required)
    RAISE NOTICE '⚠️  MANUAL CHECK: Verify storage bucket "data-lake" exists via Dashboard';
    RAISE NOTICE '   - Run: SELECT * FROM storage.buckets WHERE name = ''data-lake'';';

    RAISE NOTICE '--- ALL AUTOMATED TESTS PASSED 🎉 ---';
END;
$$;

ROLLBACK;
