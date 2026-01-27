-- ========================================================
-- Verification SQL for Sprint 3: Branding
-- Run these queries in Supabase SQL Editor
-- ========================================================

-- Replace YOUR_EVENT_ID_HERE with an actual event UUID
-- SELECT id, name FROM events LIMIT 5;

-- ========================================================
-- 1. VERIFY: Branding domain in get_event_config
-- ========================================================

SELECT public.get_event_config('YOUR_EVENT_ID_HERE');

-- Expected: config now contains 8 domains including 'branding':
-- {
--   ...
--   "branding": {
--     "hero_image_id": null,
--     "logo_image_id": null,
--     "primary_color": "#4F46E5"
--   }
-- }

-- ========================================================
-- 2. VERIFY: Permissions include can_edit_branding
-- ========================================================

SELECT public.get_event_config_permissions('YOUR_EVENT_ID_HERE');

-- Expected (for owner/admin):
-- {
--   "role": "owner",
--   "can_edit_branding": true,
--   ...
-- }

-- ========================================================
-- 3. TEST: Valid hex color
-- ========================================================

SELECT public.set_event_config(
    'YOUR_EVENT_ID_HERE',
    'branding',
    '{"primary_color": "#FF5733"}'::jsonb
);

-- Expected: SUCCESS, returns merged config with new color

-- ========================================================
-- 4. TEST: INVALID hex color (short format) - should FAIL
-- ========================================================

INSERT INTO public.event_settings (event_id, domain, setting_value)
VALUES (
    'YOUR_EVENT_ID_HERE',
    'branding',
    '{"primary_color": "#FFF"}'::jsonb
)
ON CONFLICT (event_id, domain) DO UPDATE SET setting_value = EXCLUDED.setting_value;

-- Expected ERROR: primary_color must be a valid hex color (#RRGGBB), got: #FFF

-- ========================================================
-- 5. TEST: INVALID hex color (not hex) - should FAIL
-- ========================================================

INSERT INTO public.event_settings (event_id, domain, setting_value)
VALUES (
    'YOUR_EVENT_ID_HERE',
    'branding',
    '{"primary_color": "red"}'::jsonb
)
ON CONFLICT (event_id, domain) DO UPDATE SET setting_value = EXCLUDED.setting_value;

-- Expected ERROR: primary_color must be a valid hex color (#RRGGBB), got: red

-- ========================================================
-- 6. TEST: Valid UUID for image ID
-- ========================================================

SELECT public.set_event_config(
    'YOUR_EVENT_ID_HERE',
    'branding',
    '{"hero_image_id": "12345678-1234-1234-1234-123456789abc"}'::jsonb
);

-- Expected: SUCCESS

-- ========================================================
-- 7. TEST: INVALID UUID format - should FAIL
-- ========================================================

INSERT INTO public.event_settings (event_id, domain, setting_value)
VALUES (
    'YOUR_EVENT_ID_HERE',
    'branding',
    '{"hero_image_id": "not-a-uuid"}'::jsonb
)
ON CONFLICT (event_id, domain) DO UPDATE SET setting_value = EXCLUDED.setting_value;

-- Expected ERROR: hero_image_id must be a valid UUID

-- ========================================================
-- 8. VERIFY: Audit log entries for branding
-- ========================================================

SELECT action, metadata->>'domain' as domain, created_at
FROM public.audit_log
WHERE resource_id = 'YOUR_EVENT_ID_HERE'
  AND metadata->>'domain' = 'branding'
ORDER BY created_at DESC
LIMIT 5;

-- ========================================================
-- 9. TEST: Reset branding to defaults
-- ========================================================

SELECT public.reset_event_config_domain('YOUR_EVENT_ID_HERE', 'branding');

-- Verify it's back to defaults
SELECT setting_value 
FROM public.event_settings 
WHERE event_id = 'YOUR_EVENT_ID_HERE' AND domain = 'branding';

-- Expected: No rows (override deleted, falls back to default #4F46E5)

-- ========================================================
-- 10. CLEANUP
-- ========================================================

DELETE FROM public.event_settings 
WHERE event_id = 'YOUR_EVENT_ID_HERE' AND domain = 'branding';
