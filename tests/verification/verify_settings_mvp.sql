-- Verify Settings MVP
-- 1. Check Tables
SELECT 'org_settings exists' as check, exists(select 1 from information_schema.tables where table_name = 'org_settings') as passed
UNION ALL
SELECT 'event_settings exists', exists(select 1 from information_schema.tables where table_name = 'event_settings');

-- 2. Setup Test Data (assuming we are running as a user who is an org owner)
-- We need a valid event_id and org_id. 
-- REPLACE THESE WITH REAL IDs IF RUNNING MANUALLY, OR RELY ON APP CONTEXT
-- For this script, we'll try to find one.

DO $$
DECLARE
    _org_id uuid;
    _event_id uuid;
    _user_id uuid := auth.uid();
    _settings jsonb;
BEGIN
    -- Find an org where current user is owner/admin
    SELECT org_id INTO _org_id 
    FROM public.org_members 
    WHERE user_id = _user_id AND role IN ('owner', 'admin') 
    LIMIT 1;

    IF _org_id IS NULL THEN
        RAISE NOTICE 'No org found for current user, skipping functional tests';
        RETURN;
    END IF;

    -- Find an event
    SELECT id INTO _event_id FROM public.events WHERE org_id = _org_id LIMIT 1;
    
    IF _event_id IS NULL THEN
        RAISE NOTICE 'No event found, skipping event tests';
        RETURN;
    END IF;

    RAISE NOTICE 'Testing with Org: % and Event: %', _org_id, _event_id;

    -- Test 1: Set Org Default for Communication
    PERFORM public.set_org_setting(_org_id, 'communication', '{"default_locale": "en", "reply_to_email": "org@test.com"}'::jsonb);
    
    -- Test 2: Set Event Override for Communication
    PERFORM public.set_event_setting(_event_id, 'communication', '{"default_locale": "fr"}'::jsonb);

    -- Test 3: Get Effective Settings
    _settings := public.get_effective_event_settings(_event_id);
    
    RAISE NOTICE 'Effective Settings: %', _settings;

    -- Verify Merge
    IF (_settings->'communication'->>'default_locale' != 'fr') THEN
        RAISE EXCEPTION 'Merge failed: expected fr (event override), got %', _settings->'communication'->>'default_locale';
    END IF;
    
    IF (_settings->'communication'->>'reply_to_email' != 'org@test.com') THEN
        RAISE EXCEPTION 'Merge failed: expected org@test.com (org default), got %', _settings->'communication'->>'reply_to_email';
    END IF;

    -- Test 4: Verify Audit Log
    IF NOT EXISTS (
        SELECT 1 FROM public.audit_log 
        WHERE resource_id = _event_id::text 
        AND action = 'SETTINGS_EVENT_UPDATED'
        AND actor_user_id = _user_id
    ) THEN
        RAISE EXCEPTION 'Audit log missing for event update';
    END IF;

    RAISE NOTICE 'All Settings MVP tests passed!';
END $$;
