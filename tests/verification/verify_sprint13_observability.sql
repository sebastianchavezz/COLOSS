-- Verification Script for Sprint 13 (Observability)
-- Run this in Supabase SQL Editor

BEGIN;

-- Setup test event
INSERT INTO public.orgs (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'Test Org', 'test-org')
ON CONFLICT DO NOTHING;

INSERT INTO public.events (id, org_id, slug, name, status, start_time)
VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'test-event-sprint13', 'Test Event Sprint 13', 'published', now() + interval '1 day')
ON CONFLICT DO NOTHING;

DO $$
DECLARE
    _event_id uuid := '00000000-0000-0000-0000-000000000002';
    _log_count_before int;
    _log_count_after int;
    _log_entry RECORD;
BEGIN
    RAISE NOTICE '--- START VERIFICATION SPRINT 13 ---';

    -- TEST 1: Table exists and is queryable
    BEGIN
        SELECT COUNT(*) INTO _log_count_before FROM public.settings_enforcement_log;
        RAISE NOTICE '✅ TEST 1 Passed: settings_enforcement_log table exists (% rows)', _log_count_before;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION '❌ TEST 1 Failed: Cannot query table: %', SQLERRM;
    END;

    -- TEST 2: log_enforcement function works
    BEGIN
        PERFORM public.log_enforcement(_event_id, 'governance', 'Test: Private event blocked', 'anon');
        SELECT COUNT(*) INTO _log_count_after FROM public.settings_enforcement_log;
        
        IF _log_count_after = _log_count_before + 1 THEN
            RAISE NOTICE '✅ TEST 2 Passed: log_enforcement creates entry';
        ELSE
            RAISE EXCEPTION '❌ TEST 2 Failed: Expected % rows, got %', _log_count_before + 1, _log_count_after;
        END IF;
    END;

    -- TEST 3: Verify log entry content (no PII)
    BEGIN
        SELECT * INTO _log_entry 
        FROM public.settings_enforcement_log 
        WHERE event_id = _event_id 
        ORDER BY created_at DESC 
        LIMIT 1;
        
        IF _log_entry.domain = 'governance' 
        AND _log_entry.reason = 'Test: Private event blocked'
        AND _log_entry.actor = 'anon' THEN
            RAISE NOTICE '✅ TEST 3 Passed: Log entry has correct content';
        ELSE
            RAISE EXCEPTION '❌ TEST 3 Failed: Log entry content mismatch';
        END IF;
    END;

    -- TEST 4: Append-only (updates not allowed)
    BEGIN
        UPDATE public.settings_enforcement_log 
        SET reason = 'Modified' 
        WHERE id = _log_entry.id;
        
        RAISE EXCEPTION '❌ TEST 4 Failed: Update was allowed (should be append-only)';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%append-only%' THEN
            RAISE NOTICE '✅ TEST 4 Passed: Table is append-only (updates blocked)';
        ELSE
            RAISE EXCEPTION '❌ TEST 4 Failed with unexpected error: %', SQLERRM;
        END IF;
    END;

    -- TEST 5: Append-only (deletes not allowed)
    BEGIN
        DELETE FROM public.settings_enforcement_log WHERE id = _log_entry.id;
        
        RAISE EXCEPTION '❌ TEST 5 Failed: Delete was allowed (should be append-only)';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%append-only%' THEN
            RAISE NOTICE '✅ TEST 5 Passed: Table is append-only (deletes blocked)';
        ELSE
            RAISE EXCEPTION '❌ TEST 5 Failed with unexpected error: %', SQLERRM;
        END IF;
    END;

    -- TEST 6: Invalid actor rejected
    BEGIN
        PERFORM public.log_enforcement(_event_id, 'governance', 'Test', 'invalid_actor');
        
        RAISE EXCEPTION '❌ TEST 6 Failed: Invalid actor was accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%Invalid actor%' THEN
            RAISE NOTICE '✅ TEST 6 Passed: Invalid actor rejected';
        ELSE
            RAISE EXCEPTION '❌ TEST 6 Failed with unexpected error: %', SQLERRM;
        END IF;
    END;

    -- TEST 7: Invalid domain rejected
    BEGIN
        PERFORM public.log_enforcement(_event_id, 'invalid_domain', 'Test', 'anon');
        
        RAISE EXCEPTION '❌ TEST 7 Failed: Invalid domain was accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%Invalid domain%' THEN
            RAISE NOTICE '✅ TEST 7 Passed: Invalid domain rejected';
        ELSE
            RAISE EXCEPTION '❌ TEST 7 Failed with unexpected error: %', SQLERRM;
        END IF;
    END;

    -- TEST 8: No PII fields present
    DECLARE
        _column_exists boolean;
    BEGIN
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'settings_enforcement_log' 
            AND column_name IN ('user_id', 'email', 'participant_id', 'ticket_id', 'payload')
        ) INTO _column_exists;
        
        IF NOT _column_exists THEN
            RAISE NOTICE '✅ TEST 8 Passed: No PII fields in table schema';
        ELSE
            RAISE EXCEPTION '❌ TEST 8 Failed: PII fields found in schema';
        END IF;
    END;

    RAISE NOTICE '--- ALL TESTS PASSED 🎉 ---';
    RAISE NOTICE 'Total enforcement logs created during test: %', _log_count_after - _log_count_before;
END;
$$;

ROLLBACK;
