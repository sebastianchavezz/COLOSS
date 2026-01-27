-- ========================================================
-- Verification SQL for Settings Production RPCs
-- Run these queries in Supabase SQL Editor to verify behavior
-- ========================================================

-- SETUP: Replace these UUIDs with actual values from your database
-- You can find them with:
--   SELECT id, name FROM events LIMIT 5;
--   SELECT id, email FROM auth.users LIMIT 5;

-- ========================================================
-- 1. TEST: get_event_config returns merged config
-- ========================================================

-- First, check what events exist
SELECT id, name, org_id FROM public.events LIMIT 5;

-- Then test the RPC (replace UUID)
-- This should return: { payments: {...}, transfers: {...}, communication: {...} }
SELECT public.get_event_config('YOUR_EVENT_ID_HERE');

-- ========================================================
-- 2. TEST: get_event_config_permissions returns RBAC info
-- ========================================================

-- Should return role + can_edit_* booleans
SELECT public.get_event_config_permissions('YOUR_EVENT_ID_HERE');

-- ========================================================
-- 3. TEST: set_event_config with PATCH semantics
-- ========================================================

-- This should:
-- 1. Update only the vat_rate field (not replace entire payments object)
-- 2. Write to audit_log
-- 3. Return full merged config

-- Before: check current event_settings row
SELECT * FROM public.event_settings WHERE event_id = 'YOUR_EVENT_ID_HERE';

-- Perform PATCH (only updates vat_rate)
SELECT public.set_event_config(
    'YOUR_EVENT_ID_HERE',
    'payments',
    '{"vat_rate": 9}'::jsonb
);

-- After: verify the override was merged (should have vat_rate=9 but keep other fields)
SELECT * FROM public.event_settings WHERE event_id = 'YOUR_EVENT_ID_HERE' AND domain = 'payments';

-- Verify audit log entry was created
SELECT action, entity_id, before_state, after_state, metadata, created_at
FROM public.audit_log
WHERE resource_id = 'YOUR_EVENT_ID_HERE'
  AND action IN ('CONFIG_UPDATED', 'CONFIG_RESET')
ORDER BY created_at DESC
LIMIT 5;

-- ========================================================
-- 4. TEST: reset_event_config_domain clears override
-- ========================================================

-- This should:
-- 1. Delete the event_settings row for this domain
-- 2. Write to audit_log
-- 3. Return config with org/system defaults (no event override)

SELECT public.reset_event_config_domain(
    'YOUR_EVENT_ID_HERE',
    'payments'
);

-- Verify: event_settings row should be gone
SELECT * FROM public.event_settings WHERE event_id = 'YOUR_EVENT_ID_HERE' AND domain = 'payments';
-- Should return 0 rows

-- Verify audit log
SELECT action, entity_id, before_state, after_state, created_at
FROM public.audit_log
WHERE resource_id = 'YOUR_EVENT_ID_HERE'
  AND action = 'CONFIG_RESET'
ORDER BY created_at DESC
LIMIT 1;

-- ========================================================
-- 5. TEST: RBAC enforcement
-- ========================================================

-- To properly test RBAC, you need to:
-- 1. Impersonate a user with a specific role
-- 2. Call the RPC
-- 3. Verify it succeeds or fails based on role

-- Check existing org_members roles
SELECT om.user_id, om.role, u.email, o.name as org_name
FROM public.org_members om
JOIN auth.users u ON u.id = om.user_id
JOIN public.orgs o ON o.id = om.org_id
LIMIT 10;

-- Example: Create a test user with 'support' role if needed
-- Then test that support CAN edit transfers but CANNOT edit payments

-- ========================================================
-- 6. QUICK HEALTH CHECK
-- ========================================================

-- This query verifies all RPCs exist and are callable
SELECT 
    proname as function_name,
    prosecdef as security_definer
FROM pg_proc
WHERE proname IN (
    'get_event_config',
    'set_event_config',
    'reset_event_config_domain',
    'get_event_config_permissions'
)
AND pronamespace = 'public'::regnamespace;

-- Expected: 4 rows, all with security_definer = true
