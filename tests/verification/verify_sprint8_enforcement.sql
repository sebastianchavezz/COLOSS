-- Verify Sprint 8: Public Exposure & Governance Enforcement

BEGIN;

-- 1. Setup Test Data
DO $$
DECLARE
    _org_id uuid;
    _event_id uuid;
    _is_public boolean;
    _count int;
BEGIN
    RAISE NOTICE 'Starting Sprint 8 Verification...';

    -- Create Org
    INSERT INTO public.orgs (name, slug) VALUES ('Test Org Sprint 8', 'test-org-sprint-8') RETURNING id INTO _org_id;
    
    -- Create Event (Published)
    INSERT INTO public.events (org_id, name, slug, status, start_date, end_date) 
    VALUES (_org_id, 'Public Event', 'public-event', 'published', now(), now() + interval '1 day') 
    RETURNING id INTO _event_id;

    -- 2. Test Default (Should be public)
    _is_public := public.is_event_public(_event_id);
    IF _is_public IS NOT TRUE THEN
        RAISE EXCEPTION 'Default event should be public';
    END IF;
    
    SELECT count(*) INTO _count FROM public.public_events WHERE id = _event_id;
    IF _count != 1 THEN
        RAISE EXCEPTION 'Event should be visible in public_events view';
    END IF;
    
    RAISE NOTICE '✅ Default public check passed';

    -- 3. Test Private Setting
    -- Set is_private = true
    INSERT INTO public.event_settings (event_id, domain, setting_value)
    VALUES (_event_id, 'governance', '{"is_private": true}');
    
    _is_public := public.is_event_public(_event_id);
    IF _is_public IS TRUE THEN
        RAISE EXCEPTION 'Event should be private after setting is_private=true';
    END IF;
    
    SELECT count(*) INTO _count FROM public.public_events WHERE id = _event_id;
    IF _count != 0 THEN
        RAISE EXCEPTION 'Event should NOT be visible in public_events view when private';
    END IF;
    
    RAISE NOTICE '✅ Private setting check passed';

    -- 4. Test Draft Status (Should be private regardless of setting)
    UPDATE public.events SET status = 'draft' WHERE id = _event_id;
    
    _is_public := public.is_event_public(_event_id);
    IF _is_public IS TRUE THEN
        RAISE EXCEPTION 'Draft event should never be public';
    END IF;
    
    RAISE NOTICE '✅ Draft status check passed';

    -- Cleanup (Rollback will handle it, but good to be explicit in logic)
END $$;

ROLLBACK; -- Always rollback test data
