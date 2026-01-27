-- ========================================================
-- Verification SQL for Sprint 6: Ticket PDF & Privacy
-- Run these queries in Supabase SQL Editor
-- ========================================================

-- Replace YOUR_EVENT_ID_HERE with an actual event UUID
-- SELECT id, name FROM events LIMIT 5;

-- ========================================================
-- 1. VERIFY: New domains in get_event_config
-- ========================================================

SELECT public.get_event_config('YOUR_EVENT_ID_HERE');

-- Expected: config now contains 12 domains including 'ticket_pdf' and 'ticket_privacy':
-- {
--   ...
--   "ticket_pdf": { "available_from": null, "banner_image_id": null },
--   "ticket_privacy": { "show": { "name": true, "email": false, ... } }
-- }

-- ========================================================
-- 2. VERIFY: Permissions include can_edit_ticket_pdf/privacy
-- ========================================================

SELECT public.get_event_config_permissions('YOUR_EVENT_ID_HERE');

-- Expected (for owner/admin):
-- {
--   "role": "owner",
--   "can_edit_ticket_pdf": true,
--   "can_edit_ticket_privacy": true,
--   ...
-- }

-- ========================================================
-- 3. TEST: Update Ticket PDF Settings (Valid)
-- ========================================================

SELECT public.set_event_config(
    'YOUR_EVENT_ID_HERE',
    'ticket_pdf',
    jsonb_build_object(
        'available_from', (now() + interval '1 day')::text,
        'banner_image_id', '00000000-0000-0000-0000-000000000000'
    )
);

-- Expected: SUCCESS

-- ========================================================
-- 4. TEST: Update Ticket Privacy Settings (Valid)
-- ========================================================

SELECT public.set_event_config(
    'YOUR_EVENT_ID_HERE',
    'ticket_privacy',
    '{"show": {"name": true, "email": true, "phone": false}}'::jsonb
);

-- Expected: SUCCESS, merged with defaults for missing keys

-- ========================================================
-- 5. TEST: INVALID available_from (should fail)
-- ========================================================

INSERT INTO public.event_settings (event_id, domain, setting_value)
VALUES (
    'YOUR_EVENT_ID_HERE',
    'ticket_pdf',
    '{"available_from": "not-a-date"}'::jsonb
)
ON CONFLICT (event_id, domain) DO UPDATE SET setting_value = EXCLUDED.setting_value;

-- Expected ERROR: available_from must be a valid ISO-8601 datetime

-- ========================================================
-- 6. TEST: INVALID banner_image_id (should fail)
-- ========================================================

INSERT INTO public.event_settings (event_id, domain, setting_value)
VALUES (
    'YOUR_EVENT_ID_HERE',
    'ticket_pdf',
    '{"banner_image_id": "invalid-uuid"}'::jsonb
)
ON CONFLICT (event_id, domain) DO UPDATE SET setting_value = EXCLUDED.setting_value;

-- Expected ERROR: banner_image_id must be a valid UUID

-- ========================================================
-- 7. TEST: INVALID privacy key (should fail)
-- ========================================================

INSERT INTO public.event_settings (event_id, domain, setting_value)
VALUES (
    'YOUR_EVENT_ID_HERE',
    'ticket_privacy',
    '{"show": {"invalid_key": true}}'::jsonb
)
ON CONFLICT (event_id, domain) DO UPDATE SET setting_value = EXCLUDED.setting_value;

-- Expected ERROR: ticket_privacy: unknown key "invalid_key". Allowed: ...

-- ========================================================
-- 8. TEST: INVALID privacy value type (should fail)
-- ========================================================

INSERT INTO public.event_settings (event_id, domain, setting_value)
VALUES (
    'YOUR_EVENT_ID_HERE',
    'ticket_privacy',
    '{"show": {"email": "yes"}}'::jsonb
)
ON CONFLICT (event_id, domain) DO UPDATE SET setting_value = EXCLUDED.setting_value;

-- Expected ERROR: ticket_privacy.show.email must be a boolean

-- ========================================================
-- 9. VERIFY: Enforcement Helpers
-- ========================================================

-- Check availability (should be false if set to future in step 3)
SELECT public.are_tickets_available('YOUR_EVENT_ID_HERE');

-- Check privacy whitelist
SELECT public.get_ticket_privacy('YOUR_EVENT_ID_HERE');

-- ========================================================
-- 10. TEST: Reset to defaults
-- ========================================================

SELECT public.reset_event_config_domain('YOUR_EVENT_ID_HERE', 'ticket_pdf');
SELECT public.reset_event_config_domain('YOUR_EVENT_ID_HERE', 'ticket_privacy');

-- Verify back to defaults
SELECT public.get_event_config('YOUR_EVENT_ID_HERE');

-- ========================================================
-- 11. CLEANUP
-- ========================================================

DELETE FROM public.event_settings 
WHERE event_id = 'YOUR_EVENT_ID_HERE' 
  AND domain IN ('ticket_pdf', 'ticket_privacy');
