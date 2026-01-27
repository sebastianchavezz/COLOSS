-- ========================================================
-- Verification SQL for Sprint 2: Content & Communication
-- Run these queries in Supabase SQL Editor
-- ========================================================

-- Replace YOUR_EVENT_ID_HERE with an actual event UUID
-- SELECT id, name FROM events LIMIT 5;

-- ========================================================
-- 1. VERIFY: New domains in get_event_config
-- ========================================================

SELECT public.get_event_config('YOUR_EVENT_ID_HERE');

-- Expected: config now contains 7 domains:
-- payments, transfers, communication, governance, legal, basic_info, content_communication

-- ========================================================
-- 2. VERIFY: Permissions include new domains
-- ========================================================

SELECT public.get_event_config_permissions('YOUR_EVENT_ID_HERE');

-- Expected (for owner/admin):
-- can_edit_basic_info: true
-- can_edit_content_communication: true

-- ========================================================
-- 3. TEST: i18n validation - valid locale
-- ========================================================

SELECT public.set_event_config(
    'YOUR_EVENT_ID_HERE',
    'basic_info',
    '{"name": {"nl": "Test Event", "en": "Test Event EN"}}'::jsonb
);

-- Expected: SUCCESS, returns merged config

-- ========================================================
-- 4. TEST: i18n validation - INVALID locale (should fail)
-- ========================================================

INSERT INTO public.event_settings (event_id, domain, setting_value)
VALUES (
    'YOUR_EVENT_ID_HERE',
    'basic_info',
    '{"name": {"xx": "Invalid Locale"}}'::jsonb
)
ON CONFLICT (event_id, domain) DO UPDATE SET setting_value = EXCLUDED.setting_value;

-- Expected ERROR: Invalid locale key "xx" in name. Allowed: nl, en, fr, de, es, it, pt

-- ========================================================
-- 5. TEST: Extra recipients - valid (5 emails)
-- ========================================================

SELECT public.set_event_config(
    'YOUR_EVENT_ID_HERE',
    'content_communication',
    '{"extra_recipients": ["a@test.com", "b@test.com", "c@test.com", "d@test.com", "e@test.com"]}'::jsonb
);

-- Expected: SUCCESS

-- ========================================================
-- 6. TEST: Extra recipients - INVALID (6 emails, should fail)
-- ========================================================

INSERT INTO public.event_settings (event_id, domain, setting_value)
VALUES (
    'YOUR_EVENT_ID_HERE',
    'content_communication',
    '{"extra_recipients": ["a@test.com", "b@test.com", "c@test.com", "d@test.com", "e@test.com", "f@test.com"]}'::jsonb
)
ON CONFLICT (event_id, domain) DO UPDATE SET setting_value = EXCLUDED.setting_value;

-- Expected ERROR: extra_recipients cannot exceed 5 addresses (got 6)

-- ========================================================
-- 7. TEST: Extra recipients - INVALID email format
-- ========================================================

INSERT INTO public.event_settings (event_id, domain, setting_value)
VALUES (
    'YOUR_EVENT_ID_HERE',
    'content_communication',
    '{"extra_recipients": ["not-an-email"]}'::jsonb
)
ON CONFLICT (event_id, domain) DO UPDATE SET setting_value = EXCLUDED.setting_value;

-- Expected ERROR: Invalid email in extra_recipients: not-an-email

-- ========================================================
-- 8. TEST: Extra recipients - DUPLICATES not allowed
-- ========================================================

INSERT INTO public.event_settings (event_id, domain, setting_value)
VALUES (
    'YOUR_EVENT_ID_HERE',
    'content_communication',
    '{"extra_recipients": ["a@test.com", "a@test.com"]}'::jsonb
)
ON CONFLICT (event_id, domain) DO UPDATE SET setting_value = EXCLUDED.setting_value;

-- Expected ERROR: extra_recipients contains duplicates

-- ========================================================
-- 9. VERIFY: Audit log entries
-- ========================================================

SELECT action, metadata->>'domain' as domain, created_at
FROM public.audit_log
WHERE resource_id = 'YOUR_EVENT_ID_HERE'
  AND metadata->>'domain' IN ('basic_info', 'content_communication')
ORDER BY created_at DESC
LIMIT 10;

-- ========================================================
-- 10. CLEANUP
-- ========================================================

DELETE FROM public.event_settings 
WHERE event_id = 'YOUR_EVENT_ID_HERE' 
  AND domain IN ('basic_info', 'content_communication');
