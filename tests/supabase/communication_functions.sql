-- =============================================================================
-- Test: Communication Module Database Functions
-- Purpose: Verify helper functions work correctly for email queueing and delivery
-- Author: @tester
-- Date: 2025-01-27
--
-- Test Strategy:
--   - Test queue_email() with valid and invalid inputs
--   - Test is_email_deliverable() with various bounce/unsubscribe scenarios
--   - Test update_email_status() for event logging and bounce recording
--   - Verify idempotency guarantees
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

DO $$
DECLARE
    _test_org_id uuid := gen_random_uuid();
    _test_user_id uuid := gen_random_uuid();
BEGIN
    -- Store IDs for later use
    PERFORM set_config('test.org_id', _test_org_id::text, true);
    PERFORM set_config('test.user_id', _test_user_id::text, true);

    -- Insert test user
    INSERT INTO auth.users (id, email)
    VALUES (_test_user_id, 'testuser@functions.test')
    ON CONFLICT (id) DO NOTHING;

    -- Insert test organization
    INSERT INTO public.orgs (id, name, slug)
    VALUES (_test_org_id, 'Function Test Org', 'func-test-' || substr(md5(random()::text), 1, 8))
    ON CONFLICT (id) DO NOTHING;

    -- Make user owner of org
    INSERT INTO public.org_members (org_id, user_id, role)
    VALUES (_test_org_id, _test_user_id, 'owner')
    ON CONFLICT (org_id, user_id) DO NOTHING;

    RAISE NOTICE 'Setup complete: org_id=%, user_id=%', _test_org_id, _test_user_id;
END $$;

-- =============================================================================
-- SECTION: queue_email() Function Tests
-- =============================================================================

-- =============================================================================
-- TEST 1: Valid email gets queued
-- Expected: Returns a valid UUID for the queued email
-- =============================================================================
DO $$
DECLARE
    _result_id uuid;
    _org_id uuid := current_setting('test.org_id')::uuid;
    _idempotency_key text := 'test-queue-valid-' || gen_random_uuid()::text;
BEGIN
    RAISE NOTICE 'TEST 1: Valid email gets queued';

    -- ARRANGE: Prepare valid email data

    -- ACT: Call queue_email
    SELECT public.queue_email(
        _org_id := _org_id,
        _event_id := NULL,
        _idempotency_key := _idempotency_key,
        _to_email := 'valid@recipient.com',
        _subject := 'Test Subject',
        _html_body := '<p>Test body</p>',
        _email_type := 'transactional'
    ) INTO _result_id;

    -- ASSERT: Should return a valid UUID
    IF _result_id IS NULL THEN
        RAISE EXCEPTION 'TEST 1 FAILED: queue_email returned NULL for valid email';
    END IF;

    -- Verify email exists in outbox
    IF NOT EXISTS (SELECT 1 FROM public.email_outbox WHERE id = _result_id) THEN
        RAISE EXCEPTION 'TEST 1 FAILED: Email not found in outbox';
    END IF;

    -- Verify status is queued
    IF NOT EXISTS (SELECT 1 FROM public.email_outbox WHERE id = _result_id AND status = 'queued') THEN
        RAISE EXCEPTION 'TEST 1 FAILED: Email status is not queued';
    END IF;

    -- Verify event was created
    IF NOT EXISTS (SELECT 1 FROM public.email_outbox_events WHERE email_id = _result_id AND event_type = 'created') THEN
        RAISE EXCEPTION 'TEST 1 FAILED: Created event not logged';
    END IF;

    RAISE NOTICE 'TEST 1 PASSED: Email queued with id=%', _result_id;
END $$;

-- =============================================================================
-- TEST 2: Idempotency - same key returns existing ID (no duplicate)
-- Expected: Second call with same key returns the original email ID
-- =============================================================================
DO $$
DECLARE
    _first_id uuid;
    _second_id uuid;
    _org_id uuid := current_setting('test.org_id')::uuid;
    _idempotency_key text := 'test-idempotency-' || gen_random_uuid()::text;
    _email_count integer;
BEGIN
    RAISE NOTICE 'TEST 2: Idempotency - same key returns existing ID';

    -- ARRANGE: Queue first email
    SELECT public.queue_email(
        _org_id := _org_id,
        _event_id := NULL,
        _idempotency_key := _idempotency_key,
        _to_email := 'idempotent@test.com',
        _subject := 'First Subject',
        _html_body := '<p>First body</p>'
    ) INTO _first_id;

    -- ACT: Try to queue with same idempotency key
    SELECT public.queue_email(
        _org_id := _org_id,
        _event_id := NULL,
        _idempotency_key := _idempotency_key,
        _to_email := 'different@test.com',  -- Different email, but same key
        _subject := 'Different Subject',
        _html_body := '<p>Different body</p>'
    ) INTO _second_id;

    -- ASSERT: Both calls should return the same ID
    IF _first_id != _second_id THEN
        RAISE EXCEPTION 'TEST 2 FAILED: Idempotency violated! first_id=% != second_id=%', _first_id, _second_id;
    END IF;

    -- Verify only one email exists with this key
    SELECT COUNT(*) INTO _email_count
    FROM public.email_outbox
    WHERE idempotency_key = _idempotency_key;

    IF _email_count != 1 THEN
        RAISE EXCEPTION 'TEST 2 FAILED: Expected 1 email, found %', _email_count;
    END IF;

    RAISE NOTICE 'TEST 2 PASSED: Idempotency preserved, same id returned: %', _first_id;
END $$;

-- =============================================================================
-- TEST 3: Unsubscribed email returns NULL (not queued)
-- Expected: Marketing email to unsubscribed address returns NULL
-- =============================================================================
DO $$
DECLARE
    _result_id uuid;
    _org_id uuid := current_setting('test.org_id')::uuid;
    _unsubscribed_email text := 'unsubscribed_test@functions.test';
BEGIN
    RAISE NOTICE 'TEST 3: Unsubscribed email returns NULL';

    -- ARRANGE: Add email to unsubscribe list
    INSERT INTO public.email_unsubscribes (email, org_id, email_type, source)
    VALUES (_unsubscribed_email, _org_id, 'marketing', 'user_request');

    -- ACT: Try to queue marketing email
    SELECT public.queue_email(
        _org_id := _org_id,
        _event_id := NULL,
        _idempotency_key := 'test-unsub-' || gen_random_uuid()::text,
        _to_email := _unsubscribed_email,
        _subject := 'Marketing Email',
        _html_body := '<p>Buy now!</p>',
        _email_type := 'marketing'  -- Marketing type respects unsubscribe
    ) INTO _result_id;

    -- ASSERT: Should return NULL (not deliverable)
    IF _result_id IS NOT NULL THEN
        RAISE EXCEPTION 'TEST 3 FAILED: Expected NULL for unsubscribed email, got %', _result_id;
    END IF;

    RAISE NOTICE 'TEST 3 PASSED: Unsubscribed email correctly rejected';

    -- Cleanup
    DELETE FROM public.email_unsubscribes WHERE email = _unsubscribed_email;
END $$;

-- =============================================================================
-- TEST 4: Hard bounced email returns NULL (blocked)
-- Expected: Email to hard-bounced address returns NULL
-- =============================================================================
DO $$
DECLARE
    _result_id uuid;
    _org_id uuid := current_setting('test.org_id')::uuid;
    _bounced_email text := 'hard_bounced@functions.test';
BEGIN
    RAISE NOTICE 'TEST 4: Hard bounced email returns NULL';

    -- ARRANGE: Add 3+ hard bounces for email (threshold is 3)
    INSERT INTO public.email_bounces (email, bounce_type, org_id)
    VALUES
        (_bounced_email, 'hard', _org_id),
        (_bounced_email, 'hard', _org_id),
        (_bounced_email, 'hard', _org_id);

    -- ACT: Try to queue email
    SELECT public.queue_email(
        _org_id := _org_id,
        _event_id := NULL,
        _idempotency_key := 'test-bounce-' || gen_random_uuid()::text,
        _to_email := _bounced_email,
        _subject := 'Test Subject',
        _html_body := '<p>Test body</p>',
        _email_type := 'transactional'  -- Even transactional is blocked
    ) INTO _result_id;

    -- ASSERT: Should return NULL (not deliverable due to bounces)
    IF _result_id IS NOT NULL THEN
        RAISE EXCEPTION 'TEST 4 FAILED: Expected NULL for hard bounced email, got %', _result_id;
    END IF;

    RAISE NOTICE 'TEST 4 PASSED: Hard bounced email correctly blocked';

    -- Cleanup
    DELETE FROM public.email_bounces WHERE email = _bounced_email;
END $$;

-- =============================================================================
-- SECTION: is_email_deliverable() Function Tests
-- =============================================================================

-- =============================================================================
-- TEST 5: Normal email returns true
-- Expected: Clean email is deliverable
-- =============================================================================
DO $$
DECLARE
    _result boolean;
    _org_id uuid := current_setting('test.org_id')::uuid;
BEGIN
    RAISE NOTICE 'TEST 5: Normal email returns true';

    -- ACT: Check deliverability
    SELECT public.is_email_deliverable('clean@email.com', _org_id, 'transactional')
    INTO _result;

    -- ASSERT: Should be deliverable
    IF _result != true THEN
        RAISE EXCEPTION 'TEST 5 FAILED: Clean email should be deliverable';
    END IF;

    RAISE NOTICE 'TEST 5 PASSED: Clean email is deliverable';
END $$;

-- =============================================================================
-- TEST 6: Unsubscribed email returns false (for marketing)
-- Expected: Unsubscribed email is not deliverable for marketing
-- =============================================================================
DO $$
DECLARE
    _result_marketing boolean;
    _result_transactional boolean;
    _org_id uuid := current_setting('test.org_id')::uuid;
    _test_email text := 'unsub_deliverable@test.com';
BEGIN
    RAISE NOTICE 'TEST 6: Unsubscribed email returns false for marketing';

    -- ARRANGE: Add unsubscribe
    INSERT INTO public.email_unsubscribes (email, org_id, email_type, source)
    VALUES (_test_email, _org_id, 'marketing', 'user_request');

    -- ACT: Check deliverability for both types
    SELECT public.is_email_deliverable(_test_email, _org_id, 'marketing')
    INTO _result_marketing;

    SELECT public.is_email_deliverable(_test_email, _org_id, 'transactional')
    INTO _result_transactional;

    -- ASSERT: Marketing should be false, transactional should be true
    IF _result_marketing != false THEN
        RAISE EXCEPTION 'TEST 6 FAILED: Unsubscribed email should NOT be deliverable for marketing';
    END IF;

    IF _result_transactional != true THEN
        RAISE EXCEPTION 'TEST 6 FAILED: Unsubscribed email SHOULD be deliverable for transactional';
    END IF;

    RAISE NOTICE 'TEST 6 PASSED: Unsubscribe respected for marketing, allowed for transactional';

    -- Cleanup
    DELETE FROM public.email_unsubscribes WHERE email = _test_email;
END $$;

-- =============================================================================
-- TEST 7: Hard bounced email returns false
-- Expected: Email with 3+ hard bounces is not deliverable
-- =============================================================================
DO $$
DECLARE
    _result boolean;
    _org_id uuid := current_setting('test.org_id')::uuid;
    _test_email text := 'bounce_deliverable@test.com';
BEGIN
    RAISE NOTICE 'TEST 7: Hard bounced email returns false';

    -- ARRANGE: Add 3 hard bounces
    INSERT INTO public.email_bounces (email, bounce_type, org_id)
    VALUES
        (_test_email, 'hard', _org_id),
        (_test_email, 'hard', _org_id),
        (_test_email, 'hard', _org_id);

    -- ACT: Check deliverability
    SELECT public.is_email_deliverable(_test_email, _org_id, 'transactional')
    INTO _result;

    -- ASSERT: Should not be deliverable
    IF _result != false THEN
        RAISE EXCEPTION 'TEST 7 FAILED: Hard bounced email should NOT be deliverable';
    END IF;

    RAISE NOTICE 'TEST 7 PASSED: Hard bounced email is not deliverable';

    -- Cleanup
    DELETE FROM public.email_bounces WHERE email = _test_email;
END $$;

-- =============================================================================
-- TEST 8: Soft bounce under threshold returns true
-- Expected: 1-2 soft bounces still allows delivery
-- =============================================================================
DO $$
DECLARE
    _result boolean;
    _org_id uuid := current_setting('test.org_id')::uuid;
    _test_email text := 'soft_bounce@test.com';
BEGIN
    RAISE NOTICE 'TEST 8: Soft bounce under threshold returns true';

    -- ARRANGE: Add 2 soft bounces (under threshold of 3)
    INSERT INTO public.email_bounces (email, bounce_type, org_id)
    VALUES
        (_test_email, 'soft', _org_id),
        (_test_email, 'soft', _org_id);

    -- ACT: Check deliverability
    SELECT public.is_email_deliverable(_test_email, _org_id, 'transactional')
    INTO _result;

    -- ASSERT: Should be deliverable (soft bounces don't count toward threshold)
    IF _result != true THEN
        RAISE EXCEPTION 'TEST 8 FAILED: Soft bounced email should still be deliverable';
    END IF;

    RAISE NOTICE 'TEST 8 PASSED: Soft bounce under threshold is still deliverable';

    -- Cleanup
    DELETE FROM public.email_bounces WHERE email = _test_email;
END $$;

-- =============================================================================
-- TEST 9: Global unsubscribe blocks all orgs
-- Expected: NULL org_id unsubscribe blocks email for any org
-- =============================================================================
DO $$
DECLARE
    _result boolean;
    _org_id uuid := current_setting('test.org_id')::uuid;
    _test_email text := 'global_unsub@test.com';
BEGIN
    RAISE NOTICE 'TEST 9: Global unsubscribe blocks all orgs';

    -- ARRANGE: Add global unsubscribe (NULL org_id)
    INSERT INTO public.email_unsubscribes (email, org_id, email_type, source)
    VALUES (_test_email, NULL, 'marketing', 'user_request');

    -- ACT: Check deliverability for our specific org
    SELECT public.is_email_deliverable(_test_email, _org_id, 'marketing')
    INTO _result;

    -- ASSERT: Should not be deliverable (global unsubscribe applies)
    IF _result != false THEN
        RAISE EXCEPTION 'TEST 9 FAILED: Global unsubscribe should block delivery';
    END IF;

    RAISE NOTICE 'TEST 9 PASSED: Global unsubscribe blocks delivery for all orgs';

    -- Cleanup
    DELETE FROM public.email_unsubscribes WHERE email = _test_email;
END $$;

-- =============================================================================
-- SECTION: update_email_status() Function Tests
-- =============================================================================

-- =============================================================================
-- TEST 10: Status update creates event record
-- Expected: Calling update_email_status creates an event in email_outbox_events
-- =============================================================================
DO $$
DECLARE
    _email_id uuid;
    _result boolean;
    _event_count integer;
    _org_id uuid := current_setting('test.org_id')::uuid;
BEGIN
    RAISE NOTICE 'TEST 10: Status update creates event record';

    -- ARRANGE: Create a test email
    INSERT INTO public.email_outbox (
        org_id, idempotency_key, from_name, from_email, to_email, subject, html_body, status
    )
    VALUES (
        _org_id, 'test-status-update-' || gen_random_uuid()::text,
        'Test', 'test@test.com', 'recipient@test.com', 'Test', '<p>Test</p>', 'queued'
    )
    RETURNING id INTO _email_id;

    -- ACT: Update status to 'sent'
    SELECT public.update_email_status(
        _email_id := _email_id,
        _new_status := 'sent',
        _provider_message_id := 'provider-123'
    ) INTO _result;

    -- ASSERT: Function should return true
    IF _result != true THEN
        RAISE EXCEPTION 'TEST 10 FAILED: update_email_status returned false';
    END IF;

    -- ASSERT: Event should be logged
    SELECT COUNT(*) INTO _event_count
    FROM public.email_outbox_events
    WHERE email_id = _email_id AND event_type = 'sent';

    IF _event_count != 1 THEN
        RAISE EXCEPTION 'TEST 10 FAILED: Expected 1 sent event, found %', _event_count;
    END IF;

    -- ASSERT: Status should be updated
    IF NOT EXISTS (SELECT 1 FROM public.email_outbox WHERE id = _email_id AND status = 'sent') THEN
        RAISE EXCEPTION 'TEST 10 FAILED: Email status was not updated to sent';
    END IF;

    RAISE NOTICE 'TEST 10 PASSED: Status update created event record';
END $$;

-- =============================================================================
-- TEST 11: Exponential backoff calculates correctly for soft bounce
-- Expected: Soft bounce sets next_attempt_at with exponential backoff
-- =============================================================================
DO $$
DECLARE
    _email_id uuid;
    _next_attempt timestamptz;
    _expected_min timestamptz;
    _expected_max timestamptz;
    _org_id uuid := current_setting('test.org_id')::uuid;
BEGIN
    RAISE NOTICE 'TEST 11: Exponential backoff calculates correctly';

    -- ARRANGE: Create a test email that has been attempted once
    INSERT INTO public.email_outbox (
        org_id, idempotency_key, from_name, from_email, to_email, subject, html_body,
        status, attempt_count, max_attempts
    )
    VALUES (
        _org_id, 'test-backoff-' || gen_random_uuid()::text,
        'Test', 'test@test.com', 'recipient@test.com', 'Test', '<p>Test</p>',
        'processing', 1, 3  -- Already one attempt
    )
    RETURNING id INTO _email_id;

    -- ACT: Update status to soft_bounced
    PERFORM public.update_email_status(
        _email_id := _email_id,
        _new_status := 'soft_bounced'
    );

    -- ASSERT: Check next_attempt_at is set with exponential backoff
    -- With attempt_count=1, backoff should be 2^1 = 2 minutes
    SELECT next_attempt_at INTO _next_attempt
    FROM public.email_outbox
    WHERE id = _email_id;

    _expected_min := now() + interval '1 minute' + interval '30 seconds';  -- Allow some tolerance
    _expected_max := now() + interval '2 minutes' + interval '30 seconds';

    IF _next_attempt IS NULL THEN
        RAISE EXCEPTION 'TEST 11 FAILED: next_attempt_at was not set';
    END IF;

    IF _next_attempt < _expected_min OR _next_attempt > _expected_max THEN
        RAISE EXCEPTION 'TEST 11 FAILED: next_attempt_at (%) not in expected range (% to %)',
            _next_attempt, _expected_min, _expected_max;
    END IF;

    RAISE NOTICE 'TEST 11 PASSED: Exponential backoff calculated correctly: %', _next_attempt;
END $$;

-- =============================================================================
-- TEST 12: Bounce creates email_bounces record
-- Expected: Updating to 'bounced' status creates a bounce record
-- =============================================================================
DO $$
DECLARE
    _email_id uuid;
    _bounce_count integer;
    _org_id uuid := current_setting('test.org_id')::uuid;
    _test_recipient text := 'bounce_record@test.com';
BEGIN
    RAISE NOTICE 'TEST 12: Bounce creates email_bounces record';

    -- ARRANGE: Create a test email
    INSERT INTO public.email_outbox (
        org_id, idempotency_key, from_name, from_email, to_email, subject, html_body, status
    )
    VALUES (
        _org_id, 'test-bounce-record-' || gen_random_uuid()::text,
        'Test', 'test@test.com', _test_recipient, 'Test', '<p>Test</p>', 'sent'
    )
    RETURNING id INTO _email_id;

    -- ACT: Update status to bounced
    PERFORM public.update_email_status(
        _email_id := _email_id,
        _new_status := 'bounced',
        _error_message := 'User unknown',
        _error_code := '550',
        _provider_event_id := 'bounce-event-' || gen_random_uuid()::text
    );

    -- ASSERT: Bounce record should be created
    SELECT COUNT(*) INTO _bounce_count
    FROM public.email_bounces
    WHERE email = _test_recipient AND email_outbox_id = _email_id;

    IF _bounce_count != 1 THEN
        RAISE EXCEPTION 'TEST 12 FAILED: Expected 1 bounce record, found %', _bounce_count;
    END IF;

    -- Verify bounce type is 'hard'
    IF NOT EXISTS (
        SELECT 1 FROM public.email_bounces
        WHERE email = _test_recipient AND bounce_type = 'hard'
    ) THEN
        RAISE EXCEPTION 'TEST 12 FAILED: Bounce type should be hard';
    END IF;

    RAISE NOTICE 'TEST 12 PASSED: Bounce record created correctly';
END $$;

-- =============================================================================
-- TEST 13: Final status prevents further updates
-- Expected: Once in 'delivered' status, further updates return false
-- =============================================================================
DO $$
DECLARE
    _email_id uuid;
    _result boolean;
    _org_id uuid := current_setting('test.org_id')::uuid;
BEGIN
    RAISE NOTICE 'TEST 13: Final status prevents further updates';

    -- ARRANGE: Create a delivered email
    INSERT INTO public.email_outbox (
        org_id, idempotency_key, from_name, from_email, to_email, subject, html_body, status
    )
    VALUES (
        _org_id, 'test-final-status-' || gen_random_uuid()::text,
        'Test', 'test@test.com', 'recipient@test.com', 'Test', '<p>Test</p>', 'delivered'
    )
    RETURNING id INTO _email_id;

    -- ACT: Try to update to 'bounced'
    SELECT public.update_email_status(
        _email_id := _email_id,
        _new_status := 'bounced'
    ) INTO _result;

    -- ASSERT: Should return false (no update made)
    IF _result != false THEN
        RAISE EXCEPTION 'TEST 13 FAILED: Update should be rejected for final status';
    END IF;

    -- Verify status is still delivered
    IF NOT EXISTS (SELECT 1 FROM public.email_outbox WHERE id = _email_id AND status = 'delivered') THEN
        RAISE EXCEPTION 'TEST 13 FAILED: Status should still be delivered';
    END IF;

    RAISE NOTICE 'TEST 13 PASSED: Final status correctly prevents updates';
END $$;

-- =============================================================================
-- TEST 14: Complaint creates bounce record with correct type
-- Expected: 'complained' status creates a bounce with type 'complaint'
-- =============================================================================
DO $$
DECLARE
    _email_id uuid;
    _bounce_count integer;
    _org_id uuid := current_setting('test.org_id')::uuid;
    _test_recipient text := 'complainer@test.com';
BEGIN
    RAISE NOTICE 'TEST 14: Complaint creates correct bounce record';

    -- ARRANGE: Create a sent email
    INSERT INTO public.email_outbox (
        org_id, idempotency_key, from_name, from_email, to_email, subject, html_body, status
    )
    VALUES (
        _org_id, 'test-complaint-' || gen_random_uuid()::text,
        'Test', 'test@test.com', _test_recipient, 'Test', '<p>Test</p>', 'sent'
    )
    RETURNING id INTO _email_id;

    -- ACT: Update status to complained
    PERFORM public.update_email_status(
        _email_id := _email_id,
        _new_status := 'complained',
        _provider_event_id := 'complaint-' || gen_random_uuid()::text
    );

    -- ASSERT: Bounce record with type 'complaint' should be created
    SELECT COUNT(*) INTO _bounce_count
    FROM public.email_bounces
    WHERE email = _test_recipient AND bounce_type = 'complaint';

    IF _bounce_count != 1 THEN
        RAISE EXCEPTION 'TEST 14 FAILED: Expected 1 complaint record, found %', _bounce_count;
    END IF;

    RAISE NOTICE 'TEST 14 PASSED: Complaint creates correct bounce record';
END $$;

-- =============================================================================
-- TEST 15: Invalid email format raises exception
-- Expected: queue_email raises exception for invalid email format
-- =============================================================================
DO $$
DECLARE
    _org_id uuid := current_setting('test.org_id')::uuid;
BEGIN
    RAISE NOTICE 'TEST 15: Invalid email format raises exception';

    -- ACT & ASSERT: Try to queue invalid email
    BEGIN
        PERFORM public.queue_email(
            _org_id := _org_id,
            _event_id := NULL,
            _idempotency_key := 'test-invalid-email-' || gen_random_uuid()::text,
            _to_email := 'invalid-email-no-at-sign',
            _subject := 'Test',
            _html_body := '<p>Test</p>'
        );

        -- If we get here, the test failed
        RAISE EXCEPTION 'TEST 15 FAILED: Expected exception for invalid email format';
    EXCEPTION
        WHEN OTHERS THEN
            -- Expected exception
            IF SQLERRM LIKE '%Invalid email format%' THEN
                RAISE NOTICE 'TEST 15 PASSED: Invalid email correctly rejected';
            ELSE
                RAISE EXCEPTION 'TEST 15 FAILED: Unexpected exception: %', SQLERRM;
            END IF;
    END;
END $$;

-- =============================================================================
-- CLEANUP
-- =============================================================================
DO $$
DECLARE
    _org_id uuid := current_setting('test.org_id')::uuid;
    _user_id uuid := current_setting('test.user_id')::uuid;
BEGIN
    RAISE NOTICE 'Cleaning up test data...';

    -- Delete test data
    DELETE FROM public.email_bounces WHERE org_id = _org_id;
    DELETE FROM public.email_unsubscribes WHERE org_id = _org_id;
    DELETE FROM public.email_outbox_events WHERE email_id IN (
        SELECT id FROM public.email_outbox WHERE org_id = _org_id
    );
    DELETE FROM public.email_outbox WHERE org_id = _org_id;
    DELETE FROM public.org_members WHERE org_id = _org_id;
    DELETE FROM public.orgs WHERE id = _org_id;
    DELETE FROM auth.users WHERE id = _user_id;

    RAISE NOTICE 'Cleanup complete';
END $$;

-- Rollback to clean state
ROLLBACK;

-- =============================================================================
-- SUMMARY
-- =============================================================================
-- If you see this message without exceptions, all function tests passed!
--
-- Tests executed:
--   TEST 1:  Valid email gets queued
--   TEST 2:  Idempotency - same key returns existing ID
--   TEST 3:  Unsubscribed email returns NULL
--   TEST 4:  Hard bounced email returns NULL
--   TEST 5:  Normal email returns true (is_email_deliverable)
--   TEST 6:  Unsubscribed email returns false for marketing
--   TEST 7:  Hard bounced email returns false
--   TEST 8:  Soft bounce under threshold returns true
--   TEST 9:  Global unsubscribe blocks all orgs
--   TEST 10: Status update creates event record
--   TEST 11: Exponential backoff calculates correctly
--   TEST 12: Bounce creates email_bounces record
--   TEST 13: Final status prevents further updates
--   TEST 14: Complaint creates correct bounce record
--   TEST 15: Invalid email format raises exception
-- =============================================================================
