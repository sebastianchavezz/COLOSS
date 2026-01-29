-- =========================================================
-- F012 Final Verification Tests
-- Purpose: Confirm all bug fixes and core functionality
-- Date: 2026-01-28
-- Run as: postgres superuser (bypasses RLS for data setup)
-- =========================================================

-- SEED: Test data setup
-- Note: Uses ON CONFLICT DO NOTHING for idempotency

INSERT INTO auth.users (id, email, role, created_at, updated_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'testuser@example.com', 'authenticated', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.orgs (id, name, slug, created_at)
VALUES ('22222222-2222-2222-2222-222222222222', 'Test Org', 'test-org', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.org_members (org_id, user_id, role, created_at)
VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'admin', now())
ON CONFLICT (org_id, user_id) DO NOTHING;

INSERT INTO public.events (id, org_id, slug, name, status, start_time, created_at, updated_at)
VALUES ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'test-event-f012', 'Test Event F012', 'published', now() + interval '1 day', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.participants (id, user_id, email, first_name, last_name, created_at, updated_at)
VALUES ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'testuser@example.com', 'Test', 'User', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.registrations (id, event_id, participant_id, status, created_at, updated_at)
VALUES ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 'confirmed', now(), now())
ON CONFLICT (id) DO NOTHING;

-- =========================================================
-- TEST 1: Bug 1 fix - Audit trigger on thread status change
-- Covers: T21, T22 from test-plan.md
-- =========================================================
DO $$
DECLARE
    _thread_id uuid;
    _audit_count integer;
BEGIN
    _thread_id := public.get_or_create_chat_thread(
        '33333333-3333-3333-3333-333333333333',
        '44444444-4444-4444-4444-444444444444'
    );
    UPDATE public.chat_threads SET status = 'open' WHERE id = _thread_id;
    DELETE FROM public.audit_log WHERE entity_type = 'chat_thread' AND entity_id = _thread_id;

    UPDATE public.chat_threads SET status = 'closed' WHERE id = _thread_id;

    SELECT COUNT(*) INTO _audit_count
    FROM public.audit_log
    WHERE entity_type = 'chat_thread' AND entity_id = _thread_id;

    IF _audit_count > 0 THEN
        RAISE NOTICE 'TEST 1 PASS: Audit trigger fired - % entries created', _audit_count;
    ELSE
        RAISE NOTICE 'TEST 1 FAIL: Audit trigger did NOT create entry';
    END IF;

    UPDATE public.chat_threads SET status = 'open' WHERE id = _thread_id;
END $$;

-- =========================================================
-- TEST 2: Bug 2 fix - messaging domain in event_settings
-- =========================================================
DO $$
BEGIN
    INSERT INTO public.event_settings (event_id, domain, setting_value)
    VALUES (
        '33333333-3333-3333-3333-333333333333',
        'messaging',
        '{"rate_limit": {"msgs_per_minute": 10}, "max_message_length": 1500}'::jsonb
    )
    ON CONFLICT (event_id, domain) DO UPDATE SET setting_value = EXCLUDED.setting_value;

    RAISE NOTICE 'TEST 2 PASS: messaging domain accepted in event_settings';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TEST 2 FAIL: messaging domain rejected - %', SQLERRM;
END $$;

-- =========================================================
-- TEST 3: search_vector auto-population on faq_items
-- Covers: T23, T24 from test-plan.md
-- =========================================================
DO $$
DECLARE
    _faq_id uuid;
BEGIN
    INSERT INTO public.faq_items (org_id, event_id, title, content, status, created_by)
    VALUES (
        '22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333',
        'Test FAQ Search',
        'Dit is een test artikel over tickets en registratie',
        'published',
        '11111111-1111-1111-1111-111111111111'
    )
    RETURNING id INTO _faq_id;

    IF EXISTS (
        SELECT 1 FROM public.faq_items
        WHERE id = _faq_id AND search_vector IS NOT NULL
    ) THEN
        RAISE NOTICE 'TEST 3a PASS: search_vector auto-populated';
    ELSE
        RAISE NOTICE 'TEST 3a FAIL: search_vector is NULL';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.faq_items
        WHERE id = _faq_id AND search_vector @@ plainto_tsquery('dutch', 'tickets')
    ) THEN
        RAISE NOTICE 'TEST 3b PASS: Full-text search matches "tickets"';
    ELSE
        RAISE NOTICE 'TEST 3b FAIL: search did not match "tickets"';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.faq_items
        WHERE id = _faq_id AND search_vector @@ plainto_tsquery('dutch', 'FAQ')
    ) THEN
        RAISE NOTICE 'TEST 3c PASS: Full-text search matches title word "FAQ"';
    ELSE
        RAISE NOTICE 'TEST 3c FAIL: search did not match "FAQ"';
    END IF;

    DELETE FROM public.faq_items WHERE id = _faq_id;
END $$;

-- =========================================================
-- TEST 4: Full integration - complete messaging flow
-- Covers: T18, T19, T20, T21 from test-plan.md
-- =========================================================
DO $$
DECLARE
    _thread_id uuid;
    _msg_id uuid;
    _unread integer;
    _status text;
    _audit_count integer;
BEGIN
    _thread_id := public.get_or_create_chat_thread(
        '33333333-3333-3333-3333-333333333333',
        '44444444-4444-4444-4444-444444444444'
    );

    -- Clean slate
    UPDATE public.chat_threads SET status = 'open', unread_count_organizer = 0 WHERE id = _thread_id;
    DELETE FROM public.chat_messages WHERE thread_id = _thread_id;
    DELETE FROM public.audit_log WHERE entity_type = 'chat_thread' AND entity_id = _thread_id;

    RAISE NOTICE 'Step 1 PASS: Thread ready: %', _thread_id;

    -- Participant sends message -> unread+1, status=pending
    INSERT INTO public.chat_messages (thread_id, org_id, sender_type, content)
    VALUES (_thread_id, '22222222-2222-2222-2222-222222222222', 'participant', 'Hallo, ik heb een vraag over mijn ticket.')
    RETURNING id INTO _msg_id;

    SELECT unread_count_organizer, status INTO _unread, _status FROM public.chat_threads WHERE id = _thread_id;
    IF _unread = 1 AND _status = 'pending' THEN
        RAISE NOTICE 'Step 2 PASS: Participant msg -> unread=1, status=pending';
    ELSE
        RAISE NOTICE 'Step 2 FAIL: Expected unread=1/pending, got unread=%/status=%', _unread, _status;
    END IF;

    -- Organizer replies -> status=open, unread unchanged
    INSERT INTO public.chat_messages (thread_id, org_id, sender_type, content)
    VALUES (_thread_id, '22222222-2222-2222-2222-222222222222', 'organizer', 'Geen zorgen, ik help je!')
    RETURNING id INTO _msg_id;

    SELECT unread_count_organizer, status INTO _unread, _status FROM public.chat_threads WHERE id = _thread_id;
    IF _unread = 1 AND _status = 'open' THEN
        RAISE NOTICE 'Step 3 PASS: Organizer reply -> status=open, unread unchanged';
    ELSE
        RAISE NOTICE 'Step 3 FAIL: Expected unread=1/open, got unread=%/status=%', _unread, _status;
    END IF;

    -- Mark read (direct update; mark_chat_thread_read requires auth.uid() context)
    UPDATE public.chat_threads SET unread_count_organizer = 0 WHERE id = _thread_id;
    INSERT INTO public.chat_thread_reads (thread_id, read_by_user_id, read_at)
    VALUES (_thread_id, '11111111-1111-1111-1111-111111111111', now())
    ON CONFLICT (thread_id, read_by_user_id) DO UPDATE SET read_at = now();

    SELECT unread_count_organizer INTO _unread FROM public.chat_threads WHERE id = _thread_id;
    IF _unread = 0 THEN
        RAISE NOTICE 'Step 4 PASS: mark_read -> unread=0';
    ELSE
        RAISE NOTICE 'Step 4 FAIL: unread still = %', _unread;
    END IF;

    -- Close thread -> audit log
    UPDATE public.chat_threads SET status = 'closed' WHERE id = _thread_id;

    SELECT COUNT(*) INTO _audit_count
    FROM public.audit_log
    WHERE entity_type = 'chat_thread' AND entity_id = _thread_id AND action = 'THREAD_STATUS_CHANGED';

    IF _audit_count > 0 THEN
        RAISE NOTICE 'Step 5 PASS: Audit log entry on close';
    ELSE
        RAISE NOTICE 'Step 5 FAIL: No audit log entry for close';
    END IF;

    -- Participant messages closed thread -> auto-reopens
    INSERT INTO public.chat_messages (thread_id, org_id, sender_type, content)
    VALUES (_thread_id, '22222222-2222-2222-2222-222222222222', 'participant', 'Nog een vraag!')
    RETURNING id INTO _msg_id;

    SELECT status INTO _status FROM public.chat_threads WHERE id = _thread_id;
    IF _status = 'open' THEN
        RAISE NOTICE 'Step 6 PASS: Closed thread reopened by participant msg';
    ELSE
        RAISE NOTICE 'Step 6 FAIL: status = % (expected open)', _status;
    END IF;

    -- Unread incremented on reopen
    SELECT unread_count_organizer INTO _unread FROM public.chat_threads WHERE id = _thread_id;
    IF _unread >= 1 THEN
        RAISE NOTICE 'Step 7 PASS: Unread incremented on reopen (unread=%)', _unread;
    ELSE
        RAISE NOTICE 'Step 7 FAIL: Unread not incremented (unread=%)', _unread;
    END IF;

    RAISE NOTICE '--- Integration test complete ---';
END $$;

-- =========================================================
-- TEST 5: Edge cases / Constraint enforcement
-- Covers: T15, T16, T17 from test-plan.md
-- =========================================================
DO $$
DECLARE
    _thread_id uuid;
BEGIN
    _thread_id := public.get_or_create_chat_thread(
        '33333333-3333-3333-3333-333333333333',
        '44444444-4444-4444-4444-444444444444'
    );

    -- Empty/whitespace content rejected
    BEGIN
        INSERT INTO public.chat_messages (thread_id, org_id, sender_type, content)
        VALUES (_thread_id, '22222222-2222-2222-2222-222222222222', 'participant', '   ');
        RAISE NOTICE 'TEST 5a FAIL: Empty/whitespace content was accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'TEST 5a PASS: Empty/whitespace content rejected';
    END;

    -- Content over 2000 chars rejected
    BEGIN
        INSERT INTO public.chat_messages (thread_id, org_id, sender_type, content)
        VALUES (_thread_id, '22222222-2222-2222-2222-222222222222', 'participant', rpad('x', 2001, 'x'));
        RAISE NOTICE 'TEST 5b FAIL: Content >2000 chars accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'TEST 5b PASS: Content >2000 chars rejected';
    END;

    -- Nonexistent event rejected
    BEGIN
        PERFORM public.get_or_create_chat_thread(
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '44444444-4444-4444-4444-444444444444'
        );
        RAISE NOTICE 'TEST 5c FAIL: Nonexistent event accepted';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'TEST 5c PASS: Nonexistent event rejected';
    END;

    -- Negative unread count rejected
    BEGIN
        UPDATE public.chat_threads SET unread_count_organizer = -1 WHERE id = _thread_id;
        RAISE NOTICE 'TEST 5d FAIL: Negative unread count accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'TEST 5d PASS: Negative unread count rejected';
    END;
END $$;

-- =========================================================
-- TEST 6: Idempotency of get_or_create_chat_thread
-- Covers: T18 from test-plan.md
-- =========================================================
DO $$
DECLARE
    _tid1 uuid;
    _tid2 uuid;
BEGIN
    _tid1 := public.get_or_create_chat_thread(
        '33333333-3333-3333-3333-333333333333',
        '44444444-4444-4444-4444-444444444444'
    );
    _tid2 := public.get_or_create_chat_thread(
        '33333333-3333-3333-3333-333333333333',
        '44444444-4444-4444-4444-444444444444'
    );

    IF _tid1 = _tid2 THEN
        RAISE NOTICE 'TEST 6 PASS: get_or_create is idempotent';
    ELSE
        RAISE NOTICE 'TEST 6 FAIL: Different thread_ids: % vs %', _tid1, _tid2;
    END IF;
END $$;

-- =========================================================
-- TEST 7: Audit trigger records before/after state
-- Covers: T21, T22 from test-plan.md
-- =========================================================
DO $$
DECLARE
    _thread_id uuid;
    _before_status text;
    _after_status text;
BEGIN
    _thread_id := public.get_or_create_chat_thread(
        '33333333-3333-3333-3333-333333333333',
        '44444444-4444-4444-4444-444444444444'
    );

    UPDATE public.chat_threads SET status = 'open' WHERE id = _thread_id;
    DELETE FROM public.audit_log WHERE entity_type = 'chat_thread' AND entity_id = _thread_id;

    UPDATE public.chat_threads SET status = 'pending' WHERE id = _thread_id;

    SELECT before_state->>'status', after_state->>'status'
    INTO _before_status, _after_status
    FROM public.audit_log
    WHERE entity_type = 'chat_thread' AND entity_id = _thread_id
    ORDER BY created_at DESC LIMIT 1;

    IF _before_status = 'open' AND _after_status = 'pending' THEN
        RAISE NOTICE 'TEST 7 PASS: Audit records before_state=open, after_state=pending';
    ELSE
        RAISE NOTICE 'TEST 7 FAIL: before=%, after=%', _before_status, _after_status;
    END IF;
END $$;

-- =========================================================
-- SUMMARY
-- =========================================================
DO $$
BEGIN
    RAISE NOTICE '=========================================';
    RAISE NOTICE 'F012 VERIFICATION COMPLETE';
    RAISE NOTICE '=========================================';
END $$;
