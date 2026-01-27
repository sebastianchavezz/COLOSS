-- Verification Script for Sprint 11 (Privacy Enforcement)
-- Run this in Supabase SQL Editor

BEGIN;

-- 1. Setup Test Data
INSERT INTO public.orgs (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'Test Org', 'test-org')
ON CONFLICT DO NOTHING;

INSERT INTO public.events (id, org_id, slug, name, status, start_time)
VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'test-event-sprint11', 'Test Event Sprint 11', 'published', now() + interval '1 day')
ON CONFLICT DO NOTHING;

-- Clear settings
DELETE FROM public.event_settings WHERE event_id = '00000000-0000-0000-0000-000000000002';
DELETE FROM public.org_settings WHERE org_id = '00000000-0000-0000-0000-000000000001';

DO $$
DECLARE
    _event_id uuid := '00000000-0000-0000-0000-000000000002';
    _res jsonb;
    _data jsonb;
BEGIN
    RAISE NOTICE '--- START VERIFICATION SPRINT 11 ---';

    -- TEST 1: Default Privacy (No config)
    -- Should be: name=true, email=false
    _res := public.get_ticket_privacy(_event_id);
    IF (_res->>'name')::boolean = true AND (_res->>'email')::boolean = false THEN
        RAISE NOTICE '✅ TEST 1 Passed: Default privacy is correct';
    ELSE
        RAISE EXCEPTION '❌ TEST 1 Failed: Default privacy incorrect: %', _res;
    END IF;

    -- TEST 2: sanitize_ticket_data (Default)
    _data := jsonb_build_object('name', 'John Doe', 'email', 'john@example.com', 'phone', '123456');
    _res := public.sanitize_ticket_data(_event_id, _data);
    
    IF (_res ? 'name') AND NOT (_res ? 'email') AND NOT (_res ? 'phone') THEN
        RAISE NOTICE '✅ TEST 2 Passed: Sanitization (Default) works';
    ELSE
        RAISE EXCEPTION '❌ TEST 2 Failed: Sanitization (Default) failed: %', _res;
    END IF;

    -- TEST 3: Custom Privacy (Allow Email)
    INSERT INTO public.event_settings (event_id, domain, setting_value)
    VALUES (_event_id, 'ticket_privacy', jsonb_build_object('show', jsonb_build_object('name', true, 'email', true)));
    
    _res := public.sanitize_ticket_data(_event_id, _data);
    
    IF (_res ? 'name') AND (_res ? 'email') AND NOT (_res ? 'phone') THEN
        RAISE NOTICE '✅ TEST 3 Passed: Sanitization (Custom) works';
    ELSE
        RAISE EXCEPTION '❌ TEST 3 Failed: Sanitization (Custom) failed: %', _res;
    END IF;

    RAISE NOTICE '--- ALL TESTS PASSED 🎉 ---';
END;
$$;

ROLLBACK;
