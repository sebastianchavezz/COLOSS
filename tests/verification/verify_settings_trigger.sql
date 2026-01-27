-- ========================================================
-- Regression Test: Settings Validation Trigger
-- Run these in Supabase SQL Editor to verify enforcement
-- ========================================================

-- ========================================================
-- 1. VERIFY: Trigger exists on event_settings
-- ========================================================

SELECT tgname AS trigger_name, pg_get_triggerdef(t.oid) AS trigger_def
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' 
  AND c.relname = 'event_settings' 
  AND NOT t.tgisinternal
ORDER BY tgname;

-- Expected: 1 row with trigger_name = 'enforce_event_settings_validation'

-- ========================================================
-- 2. VERIFY: Trigger exists on org_settings
-- ========================================================

SELECT tgname AS trigger_name, pg_get_triggerdef(t.oid) AS trigger_def
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' 
  AND c.relname = 'org_settings' 
  AND NOT t.tgisinternal
ORDER BY tgname;

-- Expected: 1 row with trigger_name = 'enforce_org_settings_validation'

-- ========================================================
-- 3. TEST: Invalid legal.mode MUST FAIL
-- ========================================================

-- Get a valid event_id first
-- SELECT id FROM events LIMIT 1;

-- This should ERROR:
INSERT INTO public.event_settings (event_id, domain, setting_value)
VALUES (
    'YOUR_EVENT_ID_HERE',  -- Replace with actual UUID
    'legal',
    '{"mode": "invalid"}'::jsonb
)
ON CONFLICT (event_id, domain) DO UPDATE SET setting_value = EXCLUDED.setting_value;

-- Expected ERROR: terms mode must be none, pdf, url, or inline_text

-- ========================================================
-- 4. TEST: Valid legal.mode MUST SUCCEED
-- ========================================================

INSERT INTO public.event_settings (event_id, domain, setting_value)
VALUES (
    'YOUR_EVENT_ID_HERE',  -- Replace with actual UUID
    'legal',
    '{"mode": "url", "url": "https://example.com/terms"}'::jsonb
)
ON CONFLICT (event_id, domain) DO UPDATE SET setting_value = EXCLUDED.setting_value;

-- Expected: INSERT 0 1 (success)

-- Verify it was inserted
SELECT * FROM public.event_settings 
WHERE event_id = 'YOUR_EVENT_ID_HERE' AND domain = 'legal';

-- ========================================================
-- 5. TEST: Invalid governance.is_private type MUST FAIL
-- ========================================================

INSERT INTO public.event_settings (event_id, domain, setting_value)
VALUES (
    'YOUR_EVENT_ID_HERE',
    'governance',
    '{"is_private": "yes"}'::jsonb  -- String instead of boolean
)
ON CONFLICT (event_id, domain) DO UPDATE SET setting_value = EXCLUDED.setting_value;

-- Expected ERROR: is_private must be a boolean

-- ========================================================
-- 6. TEST: Valid governance MUST SUCCEED
-- ========================================================

INSERT INTO public.event_settings (event_id, domain, setting_value)
VALUES (
    'YOUR_EVENT_ID_HERE',
    'governance',
    '{"is_private": true}'::jsonb
)
ON CONFLICT (event_id, domain) DO UPDATE SET setting_value = EXCLUDED.setting_value;

-- Expected: INSERT 0 1 (success)

-- ========================================================
-- 7. CLEANUP: Reset test data
-- ========================================================

DELETE FROM public.event_settings 
WHERE event_id = 'YOUR_EVENT_ID_HERE' 
  AND domain IN ('legal', 'governance');
