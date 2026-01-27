-- =============================================================================
-- Test: Communication Module RLS Policies
-- Purpose: Verify Row Level Security policies enforce proper multi-tenant isolation
-- Author: @tester
-- Date: 2025-01-27
--
-- Test Strategy:
--   - Create test users in different organizations
--   - Verify org members CAN access their own org's data
--   - Verify users CANNOT access other org's data (strict isolation)
--   - Test edge cases: NULL org_id, public access tables
--
-- Prerequisites:
--   - Communication module migration must be applied
--   - Layer 1 (orgs, org_members) must exist
--
-- Usage:
--   Run this script via psql or Supabase SQL editor
--   Expected: All ASSERT statements should pass (no exceptions raised)
-- =============================================================================

-- Start transaction for cleanup
BEGIN;

-- =============================================================================
-- SETUP: Create test data
-- =============================================================================

-- Create a helper function to set the auth context (simulates logged-in user)
CREATE OR REPLACE FUNCTION test_set_auth_uid(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    PERFORM set_config('request.jwt.claim.sub', _user_id::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _user_id::text)::text, true);
END;
$$;

-- Create test users in auth.users
-- Note: In real Supabase, these would be created via Auth API
DO $$
DECLARE
    _user_a_id uuid := gen_random_uuid();
    _user_b_id uuid := gen_random_uuid();
    _user_c_id uuid := gen_random_uuid();
    _org_a_id uuid := gen_random_uuid();
    _org_b_id uuid := gen_random_uuid();
    _template_a_id uuid := gen_random_uuid();
    _template_b_id uuid := gen_random_uuid();
    _batch_a_id uuid := gen_random_uuid();
    _batch_b_id uuid := gen_random_uuid();
    _email_a_id uuid := gen_random_uuid();
    _email_b_id uuid := gen_random_uuid();
BEGIN
    -- Store IDs for later use
    PERFORM set_config('test.user_a_id', _user_a_id::text, true);
    PERFORM set_config('test.user_b_id', _user_b_id::text, true);
    PERFORM set_config('test.user_c_id', _user_c_id::text, true);
    PERFORM set_config('test.org_a_id', _org_a_id::text, true);
    PERFORM set_config('test.org_b_id', _org_b_id::text, true);
    PERFORM set_config('test.template_a_id', _template_a_id::text, true);
    PERFORM set_config('test.template_b_id', _template_b_id::text, true);
    PERFORM set_config('test.batch_a_id', _batch_a_id::text, true);
    PERFORM set_config('test.batch_b_id', _batch_b_id::text, true);
    PERFORM set_config('test.email_a_id', _email_a_id::text, true);
    PERFORM set_config('test.email_b_id', _email_b_id::text, true);

    -- Insert test users
    INSERT INTO auth.users (id, email)
    VALUES
        (_user_a_id, 'user_a@test.com'),
        (_user_b_id, 'user_b@test.com'),
        (_user_c_id, 'user_c@test.com')
    ON CONFLICT (id) DO NOTHING;

    -- Insert test organizations (bypass RLS with service role)
    INSERT INTO public.orgs (id, name, slug)
    VALUES
        (_org_a_id, 'Test Org A', 'test-org-a-' || substr(md5(random()::text), 1, 8)),
        (_org_b_id, 'Test Org B', 'test-org-b-' || substr(md5(random()::text), 1, 8))
    ON CONFLICT (id) DO NOTHING;

    -- User A is member of Org A (owner)
    -- User B is member of Org B (owner)
    -- User C has no membership (outsider)
    INSERT INTO public.org_members (org_id, user_id, role)
    VALUES
        (_org_a_id, _user_a_id, 'owner'),
        (_org_b_id, _user_b_id, 'owner')
    ON CONFLICT (org_id, user_id) DO NOTHING;

    -- Insert test message_templates
    INSERT INTO public.message_templates (id, org_id, name, subject, html_body, created_by)
    VALUES
        (_template_a_id, _org_a_id, 'Template A', '{"nl": "Subject A"}'::jsonb, '{"nl": "<p>Body A</p>"}'::jsonb, _user_a_id),
        (_template_b_id, _org_b_id, 'Template B', '{"nl": "Subject B"}'::jsonb, '{"nl": "<p>Body B</p>"}'::jsonb, _user_b_id);

    -- Insert test message_batches
    INSERT INTO public.message_batches (id, org_id, name, subject, html_body, recipient_filter, created_by)
    VALUES
        (_batch_a_id, _org_a_id, 'Batch A', 'Subject A', '<p>Body A</p>', '{"type": "all"}'::jsonb, _user_a_id),
        (_batch_b_id, _org_b_id, 'Batch B', 'Subject B', '<p>Body B</p>', '{"type": "all"}'::jsonb, _user_b_id);

    -- Insert test email_outbox records
    INSERT INTO public.email_outbox (
        id, org_id, idempotency_key, from_name, from_email, to_email, subject, html_body
    )
    VALUES
        (_email_a_id, _org_a_id, 'test-email-a-' || gen_random_uuid()::text, 'Org A', 'noreply@orga.com', 'recipient@test.com', 'Test A', '<p>A</p>'),
        (_email_b_id, _org_b_id, 'test-email-b-' || gen_random_uuid()::text, 'Org B', 'noreply@orgb.com', 'recipient@test.com', 'Test B', '<p>B</p>');

    -- Insert email_outbox_events
    INSERT INTO public.email_outbox_events (email_id, event_type, new_status)
    VALUES
        (_email_a_id, 'created', 'queued'),
        (_email_b_id, 'created', 'queued');

    -- Insert message_batch_items
    INSERT INTO public.message_batch_items (batch_id, email, variables)
    VALUES
        (_batch_a_id, 'item@orga.com', '{}'::jsonb),
        (_batch_b_id, 'item@orgb.com', '{}'::jsonb);

    -- Insert email_unsubscribes (public access)
    INSERT INTO public.email_unsubscribes (email, org_id, email_type)
    VALUES
        ('unsubscribed@test.com', _org_a_id, 'marketing'),
        ('global_unsub@test.com', NULL, 'all');

    -- Insert email_bounces
    INSERT INTO public.email_bounces (email, bounce_type, org_id)
    VALUES
        ('bounced_a@test.com', 'hard', _org_a_id),
        ('bounced_b@test.com', 'hard', _org_b_id),
        ('bounced_global@test.com', 'soft', NULL);

    RAISE NOTICE 'Setup complete: Created test users, orgs, and communication data';
END $$;

-- =============================================================================
-- TEST 1: Owner can view own org's email_outbox
-- Expected: User A can see Org A's emails
-- =============================================================================
DO $$
DECLARE
    _count integer;
    _user_a_id uuid := current_setting('test.user_a_id')::uuid;
    _org_a_id uuid := current_setting('test.org_a_id')::uuid;
BEGIN
    RAISE NOTICE 'TEST 1: Owner can view own org email_outbox';

    -- ARRANGE: Set auth context to User A
    PERFORM test_set_auth_uid(_user_a_id);

    -- ACT: Query email_outbox for Org A
    SELECT COUNT(*) INTO _count
    FROM public.email_outbox
    WHERE org_id = _org_a_id;

    -- ASSERT: Should find at least 1 email
    IF _count < 1 THEN
        RAISE EXCEPTION 'TEST 1 FAILED: Expected at least 1 email for Org A, found %', _count;
    END IF;

    RAISE NOTICE 'TEST 1 PASSED: User A can view % email(s) from Org A', _count;
END $$;

-- =============================================================================
-- TEST 2: Other user CANNOT view other org's email_outbox
-- Expected: User A cannot see Org B's emails
-- =============================================================================
DO $$
DECLARE
    _count integer;
    _user_a_id uuid := current_setting('test.user_a_id')::uuid;
    _org_b_id uuid := current_setting('test.org_b_id')::uuid;
BEGIN
    RAISE NOTICE 'TEST 2: Cross-org access prevention for email_outbox';

    -- ARRANGE: Set auth context to User A
    PERFORM test_set_auth_uid(_user_a_id);

    -- ACT: Try to query email_outbox for Org B
    SELECT COUNT(*) INTO _count
    FROM public.email_outbox
    WHERE org_id = _org_b_id;

    -- ASSERT: Should find 0 emails (RLS blocks access)
    IF _count != 0 THEN
        RAISE EXCEPTION 'TEST 2 FAILED: User A should NOT see Org B emails, but found %', _count;
    END IF;

    RAISE NOTICE 'TEST 2 PASSED: User A cannot see Org B emails (found 0)';
END $$;

-- =============================================================================
-- TEST 3: Org member can view message_batches
-- Expected: User A can see Org A's batches
-- =============================================================================
DO $$
DECLARE
    _count integer;
    _user_a_id uuid := current_setting('test.user_a_id')::uuid;
    _org_a_id uuid := current_setting('test.org_a_id')::uuid;
BEGIN
    RAISE NOTICE 'TEST 3: Org member can view message_batches';

    -- ARRANGE: Set auth context to User A
    PERFORM test_set_auth_uid(_user_a_id);

    -- ACT: Query message_batches for Org A
    SELECT COUNT(*) INTO _count
    FROM public.message_batches
    WHERE org_id = _org_a_id;

    -- ASSERT: Should find at least 1 batch
    IF _count < 1 THEN
        RAISE EXCEPTION 'TEST 3 FAILED: Expected at least 1 batch for Org A, found %', _count;
    END IF;

    RAISE NOTICE 'TEST 3 PASSED: User A can view % batch(es) from Org A', _count;
END $$;

-- =============================================================================
-- TEST 4: Non-member cannot view message_batches
-- Expected: User C (no membership) cannot see any batches
-- =============================================================================
DO $$
DECLARE
    _count integer;
    _user_c_id uuid := current_setting('test.user_c_id')::uuid;
BEGIN
    RAISE NOTICE 'TEST 4: Non-member cannot view message_batches';

    -- ARRANGE: Set auth context to User C (no org membership)
    PERFORM test_set_auth_uid(_user_c_id);

    -- ACT: Query all message_batches
    SELECT COUNT(*) INTO _count
    FROM public.message_batches;

    -- ASSERT: Should find 0 batches (no membership = no access)
    IF _count != 0 THEN
        RAISE EXCEPTION 'TEST 4 FAILED: Non-member should NOT see any batches, but found %', _count;
    END IF;

    RAISE NOTICE 'TEST 4 PASSED: Non-member cannot see any batches (found 0)';
END $$;

-- =============================================================================
-- TEST 5: Anyone can read email_unsubscribes (for compliance check)
-- Expected: Even User C can check unsubscribe status
-- =============================================================================
DO $$
DECLARE
    _count integer;
    _user_c_id uuid := current_setting('test.user_c_id')::uuid;
BEGIN
    RAISE NOTICE 'TEST 5: Public access to email_unsubscribes';

    -- ARRANGE: Set auth context to User C (no org membership)
    PERFORM test_set_auth_uid(_user_c_id);

    -- ACT: Query email_unsubscribes
    SELECT COUNT(*) INTO _count
    FROM public.email_unsubscribes;

    -- ASSERT: Should find at least 2 unsubscribes (our test data)
    IF _count < 2 THEN
        RAISE EXCEPTION 'TEST 5 FAILED: Expected at least 2 unsubscribes (public access), found %', _count;
    END IF;

    RAISE NOTICE 'TEST 5 PASSED: Public can read unsubscribes (found %)', _count;
END $$;

-- =============================================================================
-- TEST 6: User A cannot see User B's email_bounces (org-specific)
-- Expected: User A can see Org A bounces and NULL org bounces, but not Org B
-- =============================================================================
DO $$
DECLARE
    _count_a integer;
    _count_b integer;
    _count_null integer;
    _user_a_id uuid := current_setting('test.user_a_id')::uuid;
    _org_a_id uuid := current_setting('test.org_a_id')::uuid;
    _org_b_id uuid := current_setting('test.org_b_id')::uuid;
BEGIN
    RAISE NOTICE 'TEST 6: email_bounces org isolation';

    -- ARRANGE: Set auth context to User A
    PERFORM test_set_auth_uid(_user_a_id);

    -- ACT: Count bounces by org
    SELECT COUNT(*) INTO _count_a
    FROM public.email_bounces
    WHERE org_id = _org_a_id;

    SELECT COUNT(*) INTO _count_b
    FROM public.email_bounces
    WHERE org_id = _org_b_id;

    SELECT COUNT(*) INTO _count_null
    FROM public.email_bounces
    WHERE org_id IS NULL;

    -- ASSERT: User A can see Org A bounces
    IF _count_a < 1 THEN
        RAISE EXCEPTION 'TEST 6 FAILED: User A should see Org A bounces, found %', _count_a;
    END IF;

    -- ASSERT: User A cannot see Org B bounces
    IF _count_b != 0 THEN
        RAISE EXCEPTION 'TEST 6 FAILED: User A should NOT see Org B bounces, found %', _count_b;
    END IF;

    -- ASSERT: User A can see NULL org bounces (global)
    IF _count_null < 1 THEN
        RAISE EXCEPTION 'TEST 6 FAILED: User A should see global (NULL org) bounces, found %', _count_null;
    END IF;

    RAISE NOTICE 'TEST 6 PASSED: User A sees Org A (%) and global (%) bounces, not Org B (%)', _count_a, _count_null, _count_b;
END $$;

-- =============================================================================
-- TEST 7: Org member can view message_templates
-- Expected: User A can see Org A's templates
-- =============================================================================
DO $$
DECLARE
    _count integer;
    _user_a_id uuid := current_setting('test.user_a_id')::uuid;
    _org_a_id uuid := current_setting('test.org_a_id')::uuid;
BEGIN
    RAISE NOTICE 'TEST 7: Org member can view message_templates';

    -- ARRANGE: Set auth context to User A
    PERFORM test_set_auth_uid(_user_a_id);

    -- ACT: Query message_templates for Org A
    SELECT COUNT(*) INTO _count
    FROM public.message_templates
    WHERE org_id = _org_a_id;

    -- ASSERT: Should find at least 1 template
    IF _count < 1 THEN
        RAISE EXCEPTION 'TEST 7 FAILED: Expected at least 1 template for Org A, found %', _count;
    END IF;

    RAISE NOTICE 'TEST 7 PASSED: User A can view % template(s) from Org A', _count;
END $$;

-- =============================================================================
-- TEST 8: Cross-org access prevention (strict isolation) - comprehensive check
-- Expected: User A cannot access ANY of Org B's communication data
-- =============================================================================
DO $$
DECLARE
    _templates integer;
    _batches integer;
    _emails integer;
    _events integer;
    _batch_items integer;
    _user_a_id uuid := current_setting('test.user_a_id')::uuid;
    _org_b_id uuid := current_setting('test.org_b_id')::uuid;
BEGIN
    RAISE NOTICE 'TEST 8: Comprehensive cross-org isolation check';

    -- ARRANGE: Set auth context to User A
    PERFORM test_set_auth_uid(_user_a_id);

    -- ACT: Try to access all of Org B's data
    SELECT COUNT(*) INTO _templates
    FROM public.message_templates
    WHERE org_id = _org_b_id;

    SELECT COUNT(*) INTO _batches
    FROM public.message_batches
    WHERE org_id = _org_b_id;

    SELECT COUNT(*) INTO _emails
    FROM public.email_outbox
    WHERE org_id = _org_b_id;

    -- Events and batch items are accessed via parent, so check those too
    SELECT COUNT(*) INTO _events
    FROM public.email_outbox_events eoe
    JOIN public.email_outbox eo ON eo.id = eoe.email_id
    WHERE eo.org_id = _org_b_id;

    SELECT COUNT(*) INTO _batch_items
    FROM public.message_batch_items mbi
    JOIN public.message_batches mb ON mb.id = mbi.batch_id
    WHERE mb.org_id = _org_b_id;

    -- ASSERT: All counts should be 0
    IF _templates != 0 OR _batches != 0 OR _emails != 0 OR _events != 0 OR _batch_items != 0 THEN
        RAISE EXCEPTION 'TEST 8 FAILED: Cross-org access detected! templates=%, batches=%, emails=%, events=%, batch_items=%',
            _templates, _batches, _emails, _events, _batch_items;
    END IF;

    RAISE NOTICE 'TEST 8 PASSED: Complete isolation - User A cannot access any Org B data';
END $$;

-- =============================================================================
-- TEST 9: email_outbox_events access via parent (hierarchical RLS)
-- Expected: User A can see events for their org's emails only
-- =============================================================================
DO $$
DECLARE
    _count integer;
    _user_a_id uuid := current_setting('test.user_a_id')::uuid;
    _email_a_id uuid := current_setting('test.email_a_id')::uuid;
BEGIN
    RAISE NOTICE 'TEST 9: email_outbox_events hierarchical RLS';

    -- ARRANGE: Set auth context to User A
    PERFORM test_set_auth_uid(_user_a_id);

    -- ACT: Query events for User A's email
    SELECT COUNT(*) INTO _count
    FROM public.email_outbox_events
    WHERE email_id = _email_a_id;

    -- ASSERT: Should find at least 1 event
    IF _count < 1 THEN
        RAISE EXCEPTION 'TEST 9 FAILED: Expected at least 1 event for email A, found %', _count;
    END IF;

    RAISE NOTICE 'TEST 9 PASSED: User A can view % event(s) for their email', _count;
END $$;

-- =============================================================================
-- TEST 10: message_batch_items access via parent (hierarchical RLS)
-- Expected: User A can see items for their org's batches only
-- =============================================================================
DO $$
DECLARE
    _count integer;
    _user_a_id uuid := current_setting('test.user_a_id')::uuid;
    _batch_a_id uuid := current_setting('test.batch_a_id')::uuid;
BEGIN
    RAISE NOTICE 'TEST 10: message_batch_items hierarchical RLS';

    -- ARRANGE: Set auth context to User A
    PERFORM test_set_auth_uid(_user_a_id);

    -- ACT: Query items for User A's batch
    SELECT COUNT(*) INTO _count
    FROM public.message_batch_items
    WHERE batch_id = _batch_a_id;

    -- ASSERT: Should find at least 1 item
    IF _count < 1 THEN
        RAISE EXCEPTION 'TEST 10 FAILED: Expected at least 1 item for batch A, found %', _count;
    END IF;

    RAISE NOTICE 'TEST 10 PASSED: User A can view % item(s) for their batch', _count;
END $$;

-- =============================================================================
-- CLEANUP
-- =============================================================================
DO $$
DECLARE
    _user_a_id uuid := current_setting('test.user_a_id')::uuid;
    _user_b_id uuid := current_setting('test.user_b_id')::uuid;
    _user_c_id uuid := current_setting('test.user_c_id')::uuid;
    _org_a_id uuid := current_setting('test.org_a_id')::uuid;
    _org_b_id uuid := current_setting('test.org_b_id')::uuid;
BEGIN
    RAISE NOTICE 'Cleaning up test data...';

    -- Delete in correct order (respecting foreign keys)
    DELETE FROM public.email_bounces WHERE org_id IN (_org_a_id, _org_b_id) OR email LIKE '%@test.com';
    DELETE FROM public.email_unsubscribes WHERE org_id IN (_org_a_id, _org_b_id) OR email LIKE '%@test.com';
    DELETE FROM public.message_batch_items WHERE batch_id IN (
        SELECT id FROM public.message_batches WHERE org_id IN (_org_a_id, _org_b_id)
    );
    DELETE FROM public.email_outbox_events WHERE email_id IN (
        SELECT id FROM public.email_outbox WHERE org_id IN (_org_a_id, _org_b_id)
    );
    DELETE FROM public.email_outbox WHERE org_id IN (_org_a_id, _org_b_id);
    DELETE FROM public.message_batches WHERE org_id IN (_org_a_id, _org_b_id);
    DELETE FROM public.message_templates WHERE org_id IN (_org_a_id, _org_b_id);
    DELETE FROM public.org_members WHERE org_id IN (_org_a_id, _org_b_id);
    DELETE FROM public.orgs WHERE id IN (_org_a_id, _org_b_id);
    DELETE FROM auth.users WHERE id IN (_user_a_id, _user_b_id, _user_c_id);

    RAISE NOTICE 'Cleanup complete';
END $$;

-- Drop helper function
DROP FUNCTION IF EXISTS test_set_auth_uid(uuid);

-- Rollback to clean state (use COMMIT; in production to persist)
ROLLBACK;

-- =============================================================================
-- SUMMARY
-- =============================================================================
-- If you see this message without exceptions, all RLS tests passed!
--
-- Tests executed:
--   TEST 1: Owner can view own org's email_outbox
--   TEST 2: Cross-org access prevention for email_outbox
--   TEST 3: Org member can view message_batches
--   TEST 4: Non-member cannot view message_batches
--   TEST 5: Public access to email_unsubscribes (GDPR compliance)
--   TEST 6: email_bounces org isolation (with NULL org support)
--   TEST 7: Org member can view message_templates
--   TEST 8: Comprehensive cross-org isolation check
--   TEST 9: email_outbox_events hierarchical RLS
--   TEST 10: message_batch_items hierarchical RLS
-- =============================================================================
