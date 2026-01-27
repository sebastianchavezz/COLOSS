-- Verification Script for Sprint 9 (Runtime Enforcement Helpers)
-- Run this in Supabase SQL Editor

BEGIN;

-- 1. Setup Test Data
INSERT INTO public.orgs (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'Test Org', 'test-org')
ON CONFLICT DO NOTHING;

INSERT INTO public.events (id, org_id, slug, name, status, start_time)
VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'test-event-sprint9', 'Test Event Sprint 9', 'published', now() + interval '1 day')
ON CONFLICT DO NOTHING;

-- Clear settings
DELETE FROM public.event_settings WHERE event_id = '00000000-0000-0000-0000-000000000002';
DELETE FROM public.org_settings WHERE org_id = '00000000-0000-0000-0000-000000000001';

DO $$
DECLARE
    _event_id uuid := '00000000-0000-0000-0000-000000000002';
    _res boolean;
BEGIN
    RAISE NOTICE '--- START VERIFICATION SPRINT 9 ---';

    -- TEST 1: are_tickets_available (Default)
    -- Default is null -> should be false
    _res := public.are_tickets_available(_event_id);
    IF _res = false THEN
        RAISE NOTICE '✅ TEST 1 Passed: Default availability is false';
    ELSE
        RAISE EXCEPTION '❌ TEST 1 Failed: Default availability should be false';
    END IF;

    -- TEST 2: are_tickets_available (Future Date)
    INSERT INTO public.event_settings (event_id, domain, setting_value)
    VALUES (_event_id, 'ticket_pdf', jsonb_build_object('available_from', (now() + interval '1 hour')::text));
    
    _res := public.are_tickets_available(_event_id);
    IF _res = false THEN
        RAISE NOTICE '✅ TEST 2 Passed: Future availability returns false';
    ELSE
        RAISE EXCEPTION '❌ TEST 2 Failed: Future availability should be false';
    END IF;

    -- TEST 3: are_tickets_available (Past Date)
    UPDATE public.event_settings 
    SET setting_value = jsonb_build_object('available_from', (now() - interval '1 hour')::text)
    WHERE event_id = _event_id AND domain = 'ticket_pdf';
    
    _res := public.are_tickets_available(_event_id);
    IF _res = true THEN
        RAISE NOTICE '✅ TEST 3 Passed: Past availability returns true';
    ELSE
        RAISE EXCEPTION '❌ TEST 3 Failed: Past availability should be true';
    END IF;

    -- TEST 4: is_waitlist_enabled (Default)
    _res := public.is_waitlist_enabled(_event_id);
    IF _res = false THEN
        RAISE NOTICE '✅ TEST 4 Passed: Default waitlist is false';
    ELSE
        RAISE EXCEPTION '❌ TEST 4 Failed: Default waitlist should be false';
    END IF;

    -- TEST 5: is_waitlist_enabled (Enabled)
    INSERT INTO public.event_settings (event_id, domain, setting_value)
    VALUES (_event_id, 'waitlist', '{"enabled": true}');
    
    _res := public.is_waitlist_enabled(_event_id);
    IF _res = true THEN
        RAISE NOTICE '✅ TEST 5 Passed: Waitlist enabled returns true';
    ELSE
        RAISE EXCEPTION '❌ TEST 5 Failed: Waitlist enabled should be true';
    END IF;

    -- TEST 6: is_interest_list_enabled (Default)
    _res := public.is_interest_list_enabled(_event_id);
    IF _res = false THEN
        RAISE NOTICE '✅ TEST 6 Passed: Default interest list is false';
    ELSE
        RAISE EXCEPTION '❌ TEST 6 Failed: Default interest list should be false';
    END IF;

    -- TEST 7: is_interest_list_enabled (Enabled via Org)
    INSERT INTO public.org_settings (org_id, domain, setting_value)
    VALUES ('00000000-0000-0000-0000-000000000001', 'interest_list', '{"enabled": true}');
    
    _res := public.is_interest_list_enabled(_event_id);
    IF _res = true THEN
        RAISE NOTICE '✅ TEST 7 Passed: Interest list enabled via Org returns true';
    ELSE
        RAISE EXCEPTION '❌ TEST 7 Failed: Interest list enabled via Org should be true';
    END IF;

    RAISE NOTICE '--- ALL TESTS PASSED 🎉 ---';
END;
$$;

ROLLBACK; -- Clean up
