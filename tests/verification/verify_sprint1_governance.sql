-- ========================================================
-- Verification SQL for Sprint 1: Governance & Legal
-- Run these queries in Supabase SQL Editor
-- ========================================================

-- Replace with actual UUIDs from your database
-- SELECT id, name FROM events LIMIT 5;

-- ========================================================
-- 1. VERIFY: New domains exist in constraints
-- ========================================================

-- Should show the updated constraint with 5 domains
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conname IN ('org_settings_domain_check', 'event_settings_domain_check');

-- ========================================================
-- 2. VERIFY: get_event_config returns all 5 domains
-- ========================================================

-- Replace YOUR_EVENT_ID_HERE with an actual event UUID
SELECT public.get_event_config('YOUR_EVENT_ID_HERE');

-- Expected shape:
-- {
--   "payments": {...},
--   "transfers": {...},
--   "communication": {...},
--   "governance": {"is_private": false},
--   "legal": {"mode": "none", "url": null, "pdf_file_id": null, "inline_text": null}
-- }

-- ========================================================
-- 3. VERIFY: Permissions include new domains
-- ========================================================

SELECT public.get_event_config_permissions('YOUR_EVENT_ID_HERE');

-- Expected (for owner/admin):
-- {
--   "role": "owner",
--   "can_edit_payments": true,
--   "can_edit_transfers": true,
--   "can_edit_communication": true,
--   "can_edit_governance": true,
--   "can_edit_legal": true
-- }

-- ========================================================
-- 4. TEST: Set governance.is_private = true
-- ========================================================

SELECT public.set_event_config(
    'YOUR_EVENT_ID_HERE',
    'governance',
    '{"is_private": true}'::jsonb
);

-- Verify it was saved
SELECT * FROM public.event_settings 
WHERE event_id = 'YOUR_EVENT_ID_HERE' AND domain = 'governance';

-- ========================================================
-- 5. TEST: Set legal terms mode
-- ========================================================

SELECT public.set_event_config(
    'YOUR_EVENT_ID_HERE',
    'legal',
    '{"mode": "url", "url": "https://example.com/terms"}'::jsonb
);

-- Verify
SELECT * FROM public.event_settings 
WHERE event_id = 'YOUR_EVENT_ID_HERE' AND domain = 'legal';

-- ========================================================
-- 6. VERIFY: is_event_public helper function
-- ========================================================

-- Should return false for private events
SELECT public.is_event_public('YOUR_EVENT_ID_HERE');

-- ========================================================
-- 7. VERIFY: public_events view excludes private events
-- ========================================================

-- First, count all published events
SELECT COUNT(*) as total_published FROM public.events WHERE status = 'published' AND deleted_at IS NULL;

-- Then count public events (should be fewer if any are private)
SELECT COUNT(*) as total_public FROM public.public_events;

-- ========================================================
-- 8. VERIFY: Audit log entries for governance/legal
-- ========================================================

SELECT action, entity_id, metadata->>'domain' as domain, created_at
FROM public.audit_log
WHERE action IN ('CONFIG_UPDATED', 'CONFIG_RESET')
  AND metadata->>'domain' IN ('governance', 'legal')
ORDER BY created_at DESC
LIMIT 10;

-- ========================================================
-- 9. EDGE CASE: Invalid terms mode should fail
-- ========================================================

-- This should raise an error
SELECT public.set_event_config(
    'YOUR_EVENT_ID_HERE',
    'legal',
    '{"mode": "invalid_mode"}'::jsonb
);
-- Expected: ERROR: terms mode must be none, pdf, url, or inline_text

-- ========================================================
-- 10. EDGE CASE: Support role cannot edit governance
-- ========================================================

-- First, find a user with 'support' role
SELECT om.user_id, om.role, u.email
FROM public.org_members om
JOIN auth.users u ON u.id = om.user_id
WHERE om.role = 'support'
LIMIT 1;

-- Then impersonate that user and try to set governance
-- (This requires using the Supabase client with that user's session)
-- The RPC should return: ERROR: Permission denied: support cannot edit governance settings

-- ========================================================
-- CLEANUP: Reset test event to public
-- ========================================================

SELECT public.reset_event_config_domain('YOUR_EVENT_ID_HERE', 'governance');
SELECT public.reset_event_config_domain('YOUR_EVENT_ID_HERE', 'legal');
