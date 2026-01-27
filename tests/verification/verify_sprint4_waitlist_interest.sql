-- ========================================================
-- Verification SQL for Sprint 4: Waitlist & Interest List
-- Run these queries in Supabase SQL Editor
-- ========================================================

-- Replace YOUR_EVENT_ID_HERE with an actual event UUID
-- SELECT id, name FROM events LIMIT 5;

-- ========================================================
-- 1. VERIFY: New domains in get_event_config
-- ========================================================

SELECT public.get_event_config('YOUR_EVENT_ID_HERE');

-- Expected: config now contains 10 domains including 'waitlist' and 'interest_list':
-- {
--   ...
--   "waitlist": { "enabled": false },
--   "interest_list": { "enabled": false }
-- }

-- ========================================================
-- 2. VERIFY: Permissions include can_edit_waitlist/interest_list
-- ========================================================

SELECT public.get_event_config_permissions('YOUR_EVENT_ID_HERE');

-- Expected (for owner/admin):
-- {
--   "role": "owner",
--   "can_edit_waitlist": true,
--   "can_edit_interest_list": true,
--   ...
-- }

-- ========================================================
-- 3. TEST: Enable Waitlist
-- ========================================================

SELECT public.set_event_config(
    'YOUR_EVENT_ID_HERE',
    'waitlist',
    '{"enabled": true}'::jsonb
);

-- Expected: SUCCESS, returns merged config with enabled: true

-- ========================================================
-- 4. TEST: Enable Interest List
-- ========================================================

SELECT public.set_event_config(
    'YOUR_EVENT_ID_HERE',
    'interest_list',
    '{"enabled": true}'::jsonb
);

-- Expected: SUCCESS, returns merged config with enabled: true

-- ========================================================
-- 5. TEST: INVALID key (should fail)
-- ========================================================

INSERT INTO public.event_settings (event_id, domain, setting_value)
VALUES (
    'YOUR_EVENT_ID_HERE',
    'waitlist',
    '{"enabled": true, "invalid_key": 123}'::jsonb
)
ON CONFLICT (event_id, domain) DO UPDATE SET setting_value = EXCLUDED.setting_value;

-- Expected ERROR: waitlist: unknown key "invalid_key". Only "enabled" is allowed.

-- ========================================================
-- 6. TEST: INVALID type (should fail)
-- ========================================================

INSERT INTO public.event_settings (event_id, domain, setting_value)
VALUES (
    'YOUR_EVENT_ID_HERE',
    'interest_list',
    '{"enabled": "yes"}'::jsonb
)
ON CONFLICT (event_id, domain) DO UPDATE SET setting_value = EXCLUDED.setting_value;

-- Expected ERROR: interest_list.enabled must be a boolean

-- ========================================================
-- 7. VERIFY: Enforcement Helpers
-- ========================================================

-- Check if waitlist is enabled (should be true from step 3)
SELECT public.is_waitlist_enabled('YOUR_EVENT_ID_HERE');

-- Check if interest list is enabled (should be true from step 4)
SELECT public.is_interest_list_enabled('YOUR_EVENT_ID_HERE');

-- Check join logic (depends on event status)
-- Assuming event is 'published'
SELECT public.can_join_waitlist('YOUR_EVENT_ID_HERE'); 
-- Should be true if published + enabled

SELECT public.can_join_interest_list('YOUR_EVENT_ID_HERE');
-- Should be false if published (unless draft/closed)

-- ========================================================
-- 8. TEST: Reset to defaults
-- ========================================================

SELECT public.reset_event_config_domain('YOUR_EVENT_ID_HERE', 'waitlist');
SELECT public.reset_event_config_domain('YOUR_EVENT_ID_HERE', 'interest_list');

-- Verify back to defaults (false)
SELECT public.get_event_config('YOUR_EVENT_ID_HERE');

-- ========================================================
-- 9. CLEANUP
-- ========================================================

DELETE FROM public.event_settings 
WHERE event_id = 'YOUR_EVENT_ID_HERE' 
  AND domain IN ('waitlist', 'interest_list');
