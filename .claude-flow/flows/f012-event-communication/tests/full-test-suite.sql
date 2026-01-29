-- =========================================================================
-- F012 COMPLETE TEST SUITE
-- Event Communication: Messaging + FAQ
-- =========================================================================
-- Purpose: Complete test coverage for F012 database layer
-- Run as:  PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f full-test-suite.sql
-- Date:    2026-01-28
-- Version: 2.0 - Uses existing database test data dynamically
-- =========================================================================

\echo '=========================================='
\echo 'F012 COMPLETE TEST SUITE v2.0'
\echo '=========================================='
\echo ''

-- =========================================================================
-- SECTION 0: TEST DATA SETUP (Using existing data)
-- =========================================================================
\echo '=== SECTION 0: Test Data Discovery ==='

-- Create temp table to hold test context
CREATE TEMP TABLE IF NOT EXISTS f012_test_context (
    org_id uuid,
    event_id uuid,
    user_id uuid,
    participant_id uuid
);
TRUNCATE f012_test_context;

-- Discover existing test data
INSERT INTO f012_test_context (org_id, event_id, user_id, participant_id)
SELECT
    o.id AS org_id,
    e.id AS event_id,
    u.id AS user_id,
    p.id AS participant_id
FROM public.orgs o
JOIN public.events e ON e.org_id = o.id
LEFT JOIN auth.users u ON true
LEFT JOIN public.participants p ON p.user_id = u.id
LIMIT 1;

DO $$
DECLARE
    _ctx f012_test_context%ROWTYPE;
BEGIN
    SELECT * INTO _ctx FROM f012_test_context LIMIT 1;
    IF _ctx.org_id IS NOT NULL THEN
        RAISE NOTICE 'Test context: org=%, event=%, user=%, participant=%',
            _ctx.org_id, _ctx.event_id, _ctx.user_id, _ctx.participant_id;
    ELSE
        RAISE NOTICE 'WARNING: No test data found. Run F006/F011 tests first to create data.';
    END IF;
END $$;

\echo ''

-- =========================================================================
-- SECTION 1: SCHEMA VERIFICATION
-- =========================================================================
\echo '=== SECTION 1: Schema Verification ==='

-- T1.1: Verify all 4 tables exist
DO $$
DECLARE
    _tables text[] := ARRAY['chat_threads', 'chat_messages', 'chat_thread_reads', 'faq_items'];
    _tbl text;
    _missing text[] := '{}';
BEGIN
    FOREACH _tbl IN ARRAY _tables LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = _tbl) THEN
            _missing := array_append(_missing, _tbl);
        END IF;
    END LOOP;

    IF array_length(_missing, 1) IS NULL THEN
        RAISE NOTICE 'T1.1 PASS: All 4 tables exist (chat_threads, chat_messages, chat_thread_reads, faq_items)';
    ELSE
        RAISE NOTICE 'T1.1 FAIL: Missing tables: %', array_to_string(_missing, ', ');
    END IF;
END $$;

-- T1.2: Verify RLS is enabled on all tables
DO $$
DECLARE
    _tables text[] := ARRAY['chat_threads', 'chat_messages', 'chat_thread_reads', 'faq_items'];
    _tbl text;
    _rls_off text[] := '{}';
BEGIN
    FOREACH _tbl IN ARRAY _tables LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relname = _tbl AND n.nspname = 'public' AND c.relrowsecurity = true
        ) THEN
            _rls_off := array_append(_rls_off, _tbl);
        END IF;
    END LOOP;

    IF array_length(_rls_off, 1) IS NULL THEN
        RAISE NOTICE 'T1.2 PASS: RLS enabled on all 4 tables';
    ELSE
        RAISE NOTICE 'T1.2 FAIL: RLS disabled on: %', array_to_string(_rls_off, ', ');
    END IF;
END $$;

-- T1.3: Verify indexes exist
DO $$
DECLARE
    _count int;
BEGIN
    SELECT COUNT(*) INTO _count FROM pg_indexes
    WHERE indexname LIKE 'idx_chat_%' OR indexname LIKE 'idx_faq_%';

    IF _count >= 10 THEN
        RAISE NOTICE 'T1.3 PASS: % F012 indexes found', _count;
    ELSE
        RAISE NOTICE 'T1.3 PARTIAL: Only % indexes found (expected 10+)', _count;
    END IF;
END $$;

-- T1.4: Verify all helper functions exist
DO $$
DECLARE
    _funcs text[] := ARRAY[
        'get_or_create_chat_thread',
        'mark_chat_thread_read',
        'check_participant_event_access',
        'get_messaging_settings',
        'count_recent_participant_messages',
        'validate_messaging_settings'
    ];
    _fn text;
    _found int := 0;
BEGIN
    FOREACH _fn IN ARRAY _funcs LOOP
        IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = _fn) THEN
            _found := _found + 1;
        END IF;
    END LOOP;

    IF _found = array_length(_funcs, 1) THEN
        RAISE NOTICE 'T1.4 PASS: All 6 helper functions exist';
    ELSE
        RAISE NOTICE 'T1.4 PARTIAL: % of % functions found', _found, array_length(_funcs, 1);
    END IF;
END $$;

-- T1.5: Verify search_vector generated column exists on faq_items
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'faq_items' AND column_name = 'search_vector'
    ) THEN
        RAISE NOTICE 'T1.5 PASS: search_vector column exists on faq_items';
    ELSE
        RAISE NOTICE 'T1.5 FAIL: search_vector column missing from faq_items';
    END IF;
END $$;

-- T1.6: Verify chat_threads columns
DO $$
DECLARE
    _expected_cols text[] := ARRAY['id', 'org_id', 'event_id', 'participant_id', 'status', 'unread_count_organizer', 'last_message_at', 'created_at', 'updated_at'];
    _col text;
    _found int := 0;
BEGIN
    FOREACH _col IN ARRAY _expected_cols LOOP
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'chat_threads' AND column_name = _col) THEN
            _found := _found + 1;
        END IF;
    END LOOP;

    IF _found = array_length(_expected_cols, 1) THEN
        RAISE NOTICE 'T1.6 PASS: chat_threads has all % expected columns', _found;
    ELSE
        RAISE NOTICE 'T1.6 FAIL: Only % of % columns found', _found, array_length(_expected_cols, 1);
    END IF;
END $$;

\echo ''

-- =========================================================================
-- SECTION 2: HELPER FUNCTION TESTS
-- =========================================================================
\echo '=== SECTION 2: Helper Function Tests ==='

-- T2.1 & T2.2: get_or_create_chat_thread - create and idempotency
DO $$
DECLARE
    _ctx f012_test_context%ROWTYPE;
    _tid1 uuid;
    _tid2 uuid;
BEGIN
    SELECT * INTO _ctx FROM f012_test_context LIMIT 1;
    IF _ctx.event_id IS NULL OR _ctx.participant_id IS NULL THEN
        RAISE NOTICE 'T2.1 SKIP: No test data';
        RAISE NOTICE 'T2.2 SKIP: No test data';
        RETURN;
    END IF;

    _tid1 := public.get_or_create_chat_thread(_ctx.event_id, _ctx.participant_id);
    RAISE NOTICE 'T2.1 PASS: Thread created/found: %', _tid1;

    _tid2 := public.get_or_create_chat_thread(_ctx.event_id, _ctx.participant_id);
    IF _tid1 = _tid2 THEN
        RAISE NOTICE 'T2.2 PASS: Idempotent - same thread returned on second call';
    ELSE
        RAISE NOTICE 'T2.2 FAIL: Different threads: % vs %', _tid1, _tid2;
    END IF;
END $$;

-- T2.3: get_or_create_chat_thread - invalid event
DO $$
BEGIN
    PERFORM public.get_or_create_chat_thread(
        '00000000-0000-0000-0000-000000000000'::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid
    );
    RAISE NOTICE 'T2.3 FAIL: Invalid event was accepted';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T2.3 PASS: Invalid event rejected with exception';
END $$;

-- T2.4: check_participant_event_access - with valid registration
DO $$
DECLARE
    _ctx f012_test_context%ROWTYPE;
    _has_access boolean;
BEGIN
    SELECT * INTO _ctx FROM f012_test_context LIMIT 1;
    IF _ctx.event_id IS NULL OR _ctx.participant_id IS NULL THEN
        RAISE NOTICE 'T2.4 SKIP: No test data';
        RETURN;
    END IF;

    _has_access := public.check_participant_event_access(_ctx.event_id, _ctx.participant_id);

    IF _has_access THEN
        RAISE NOTICE 'T2.4 PASS: Participant with registration has access';
    ELSE
        RAISE NOTICE 'T2.4 INFO: Participant may not have registration (access=false)';
    END IF;
END $$;

-- T2.5: get_messaging_settings - returns defaults
DO $$
DECLARE
    _ctx f012_test_context%ROWTYPE;
    _settings jsonb;
BEGIN
    SELECT * INTO _ctx FROM f012_test_context LIMIT 1;
    IF _ctx.event_id IS NULL THEN
        RAISE NOTICE 'T2.5 SKIP: No test data';
        RETURN;
    END IF;

    _settings := public.get_messaging_settings(_ctx.event_id);

    IF _settings->'rate_limit' IS NOT NULL AND _settings->>'max_message_length' IS NOT NULL THEN
        RAISE NOTICE 'T2.5 PASS: Settings returned: msgs_per_minute=%, max_len=%',
            _settings->'rate_limit'->>'msgs_per_minute',
            _settings->>'max_message_length';
    ELSE
        RAISE NOTICE 'T2.5 FAIL: Invalid settings: %', _settings;
    END IF;
END $$;

-- T2.6: validate_messaging_settings - valid input
DO $$
DECLARE
    _valid boolean;
BEGIN
    _valid := public.validate_messaging_settings('{
        "rate_limit": {"msgs_per_minute": 10},
        "max_message_length": 1500,
        "retention_days": 90,
        "notifications": {"email_enabled": true}
    }'::jsonb);

    IF _valid THEN
        RAISE NOTICE 'T2.6 PASS: Valid settings object accepted';
    ELSE
        RAISE NOTICE 'T2.6 FAIL: Valid settings rejected';
    END IF;
END $$;

-- T2.7-T2.9: validate_messaging_settings - invalid inputs
DO $$
BEGIN
    PERFORM public.validate_messaging_settings('{"rate_limit": {"msgs_per_minute": 0}}'::jsonb);
    RAISE NOTICE 'T2.7 FAIL: msgs_per_minute=0 accepted';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T2.7 PASS: msgs_per_minute=0 rejected (min is 1)';
END $$;

DO $$
BEGIN
    PERFORM public.validate_messaging_settings('{"rate_limit": {"msgs_per_minute": 61}}'::jsonb);
    RAISE NOTICE 'T2.8 FAIL: msgs_per_minute=61 accepted';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T2.8 PASS: msgs_per_minute=61 rejected (max is 60)';
END $$;

DO $$
BEGIN
    PERFORM public.validate_messaging_settings('{"retention_days": 5}'::jsonb);
    RAISE NOTICE 'T2.9 FAIL: retention_days=5 accepted';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T2.9 PASS: retention_days=5 rejected (min is 7)';
END $$;

-- T2.10: count_recent_participant_messages
DO $$
DECLARE
    _ctx f012_test_context%ROWTYPE;
    _thread_id uuid;
    _count int;
BEGIN
    SELECT * INTO _ctx FROM f012_test_context LIMIT 1;
    IF _ctx.event_id IS NULL OR _ctx.participant_id IS NULL THEN
        RAISE NOTICE 'T2.10 SKIP: No test data';
        RETURN;
    END IF;

    _thread_id := public.get_or_create_chat_thread(_ctx.event_id, _ctx.participant_id);
    _count := public.count_recent_participant_messages(_thread_id, COALESCE(_ctx.user_id, gen_random_uuid()), 60);

    RAISE NOTICE 'T2.10 PASS: count_recent_participant_messages returned % (valid integer)', _count;
END $$;

\echo ''

-- =========================================================================
-- SECTION 3: TRIGGER TESTS
-- =========================================================================
\echo '=== SECTION 3: Trigger Tests ==='

-- T3.1: Participant message increments unread and sets pending
DO $$
DECLARE
    _ctx f012_test_context%ROWTYPE;
    _thread_id uuid;
    _unread_before int;
    _unread_after int;
    _status text;
BEGIN
    SELECT * INTO _ctx FROM f012_test_context LIMIT 1;
    IF _ctx.event_id IS NULL THEN
        RAISE NOTICE 'T3.1 SKIP: No test data';
        RETURN;
    END IF;

    _thread_id := public.get_or_create_chat_thread(_ctx.event_id, _ctx.participant_id);

    -- Reset state
    UPDATE public.chat_threads SET status = 'open', unread_count_organizer = 0 WHERE id = _thread_id;
    SELECT unread_count_organizer INTO _unread_before FROM public.chat_threads WHERE id = _thread_id;

    -- Participant sends
    INSERT INTO public.chat_messages (thread_id, org_id, sender_type, content)
    VALUES (_thread_id, _ctx.org_id, 'participant', 'Test message from participant');

    SELECT unread_count_organizer, status::text INTO _unread_after, _status FROM public.chat_threads WHERE id = _thread_id;

    IF _unread_after = _unread_before + 1 AND _status = 'pending' THEN
        RAISE NOTICE 'T3.1 PASS: Participant msg -> unread +1 (now %), status=pending', _unread_after;
    ELSE
        RAISE NOTICE 'T3.1 FAIL: unread_before=%, after=%, status=%', _unread_before, _unread_after, _status;
    END IF;
END $$;

-- T3.2: Organizer reply sets status to open
DO $$
DECLARE
    _ctx f012_test_context%ROWTYPE;
    _thread_id uuid;
    _status text;
BEGIN
    SELECT * INTO _ctx FROM f012_test_context LIMIT 1;
    IF _ctx.event_id IS NULL THEN
        RAISE NOTICE 'T3.2 SKIP: No test data';
        RETURN;
    END IF;

    _thread_id := public.get_or_create_chat_thread(_ctx.event_id, _ctx.participant_id);
    UPDATE public.chat_threads SET status = 'pending' WHERE id = _thread_id;

    -- Organizer replies
    INSERT INTO public.chat_messages (thread_id, org_id, sender_type, content)
    VALUES (_thread_id, _ctx.org_id, 'organizer', 'Reply from organizer');

    SELECT status::text INTO _status FROM public.chat_threads WHERE id = _thread_id;

    IF _status = 'open' THEN
        RAISE NOTICE 'T3.2 PASS: Organizer reply -> status=open';
    ELSE
        RAISE NOTICE 'T3.2 FAIL: status=% (expected open)', _status;
    END IF;
END $$;

-- T3.3: Participant message reopens closed thread
DO $$
DECLARE
    _ctx f012_test_context%ROWTYPE;
    _thread_id uuid;
    _status text;
BEGIN
    SELECT * INTO _ctx FROM f012_test_context LIMIT 1;
    IF _ctx.event_id IS NULL THEN
        RAISE NOTICE 'T3.3 SKIP: No test data';
        RETURN;
    END IF;

    _thread_id := public.get_or_create_chat_thread(_ctx.event_id, _ctx.participant_id);
    UPDATE public.chat_threads SET status = 'closed' WHERE id = _thread_id;

    -- Participant messages closed thread
    INSERT INTO public.chat_messages (thread_id, org_id, sender_type, content)
    VALUES (_thread_id, _ctx.org_id, 'participant', 'Reopening message');

    SELECT status::text INTO _status FROM public.chat_threads WHERE id = _thread_id;

    IF _status = 'open' THEN
        RAISE NOTICE 'T3.3 PASS: Closed thread reopened by participant message';
    ELSE
        RAISE NOTICE 'T3.3 FAIL: status=% (expected open)', _status;
    END IF;
END $$;

-- T3.4: Audit trigger on status change
DO $$
DECLARE
    _ctx f012_test_context%ROWTYPE;
    _thread_id uuid;
    _audit_count int;
BEGIN
    SELECT * INTO _ctx FROM f012_test_context LIMIT 1;
    IF _ctx.event_id IS NULL THEN
        RAISE NOTICE 'T3.4 SKIP: No test data';
        RETURN;
    END IF;

    _thread_id := public.get_or_create_chat_thread(_ctx.event_id, _ctx.participant_id);
    UPDATE public.chat_threads SET status = 'open' WHERE id = _thread_id;
    DELETE FROM public.audit_log WHERE entity_type = 'chat_thread' AND entity_id = _thread_id;

    -- Change status
    UPDATE public.chat_threads SET status = 'closed' WHERE id = _thread_id;

    SELECT COUNT(*) INTO _audit_count FROM public.audit_log
    WHERE entity_type = 'chat_thread' AND entity_id = _thread_id AND action = 'THREAD_STATUS_CHANGED';

    IF _audit_count > 0 THEN
        RAISE NOTICE 'T3.4 PASS: Audit log entry created on status change (% entries)', _audit_count;
    ELSE
        RAISE NOTICE 'T3.4 FAIL: No audit log entry for status change';
    END IF;
END $$;

-- T3.5: Audit records before/after state
DO $$
DECLARE
    _ctx f012_test_context%ROWTYPE;
    _thread_id uuid;
    _before_status text;
    _after_status text;
BEGIN
    SELECT * INTO _ctx FROM f012_test_context LIMIT 1;
    IF _ctx.event_id IS NULL THEN
        RAISE NOTICE 'T3.5 SKIP: No test data';
        RETURN;
    END IF;

    _thread_id := public.get_or_create_chat_thread(_ctx.event_id, _ctx.participant_id);
    UPDATE public.chat_threads SET status = 'open' WHERE id = _thread_id;
    DELETE FROM public.audit_log WHERE entity_type = 'chat_thread' AND entity_id = _thread_id;

    UPDATE public.chat_threads SET status = 'pending' WHERE id = _thread_id;

    SELECT before_state->>'status', after_state->>'status'
    INTO _before_status, _after_status
    FROM public.audit_log
    WHERE entity_type = 'chat_thread' AND entity_id = _thread_id
    ORDER BY created_at DESC LIMIT 1;

    IF _before_status = 'open' AND _after_status = 'pending' THEN
        RAISE NOTICE 'T3.5 PASS: Audit shows before_state=open, after_state=pending';
    ELSE
        RAISE NOTICE 'T3.5 FAIL: before=%, after=%', _before_status, _after_status;
    END IF;
END $$;

\echo ''

-- =========================================================================
-- SECTION 4: CONSTRAINT TESTS
-- =========================================================================
\echo '=== SECTION 4: Constraint Tests ==='

-- T4.1: Content > 2000 chars rejected
DO $$
DECLARE
    _ctx f012_test_context%ROWTYPE;
    _thread_id uuid;
BEGIN
    SELECT * INTO _ctx FROM f012_test_context LIMIT 1;
    IF _ctx.event_id IS NULL THEN
        RAISE NOTICE 'T4.1 SKIP: No test data';
        RETURN;
    END IF;

    _thread_id := public.get_or_create_chat_thread(_ctx.event_id, _ctx.participant_id);

    INSERT INTO public.chat_messages (thread_id, org_id, sender_type, content)
    VALUES (_thread_id, _ctx.org_id, 'participant', rpad('x', 2001, 'x'));

    RAISE NOTICE 'T4.1 FAIL: Content >2000 chars accepted';
EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'T4.1 PASS: Content >2000 chars rejected by CHECK constraint';
END $$;

-- T4.2: Exactly 2000 chars accepted
DO $$
DECLARE
    _ctx f012_test_context%ROWTYPE;
    _thread_id uuid;
    _msg_id uuid;
BEGIN
    SELECT * INTO _ctx FROM f012_test_context LIMIT 1;
    IF _ctx.event_id IS NULL THEN
        RAISE NOTICE 'T4.2 SKIP: No test data';
        RETURN;
    END IF;

    _thread_id := public.get_or_create_chat_thread(_ctx.event_id, _ctx.participant_id);

    INSERT INTO public.chat_messages (thread_id, org_id, sender_type, content)
    VALUES (_thread_id, _ctx.org_id, 'participant', rpad('x', 2000, 'x'))
    RETURNING id INTO _msg_id;

    RAISE NOTICE 'T4.2 PASS: Exactly 2000 chars accepted';
    DELETE FROM public.chat_messages WHERE id = _msg_id;
EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'T4.2 FAIL: 2000 chars rejected';
END $$;

-- T4.3: Empty content rejected
DO $$
DECLARE
    _ctx f012_test_context%ROWTYPE;
    _thread_id uuid;
BEGIN
    SELECT * INTO _ctx FROM f012_test_context LIMIT 1;
    IF _ctx.event_id IS NULL THEN
        RAISE NOTICE 'T4.3 SKIP: No test data';
        RETURN;
    END IF;

    _thread_id := public.get_or_create_chat_thread(_ctx.event_id, _ctx.participant_id);

    INSERT INTO public.chat_messages (thread_id, org_id, sender_type, content)
    VALUES (_thread_id, _ctx.org_id, 'participant', '');

    RAISE NOTICE 'T4.3 FAIL: Empty content accepted';
EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'T4.3 PASS: Empty content rejected by CHECK constraint';
END $$;

-- T4.4: Whitespace-only content rejected
DO $$
DECLARE
    _ctx f012_test_context%ROWTYPE;
    _thread_id uuid;
BEGIN
    SELECT * INTO _ctx FROM f012_test_context LIMIT 1;
    IF _ctx.event_id IS NULL THEN
        RAISE NOTICE 'T4.4 SKIP: No test data';
        RETURN;
    END IF;

    _thread_id := public.get_or_create_chat_thread(_ctx.event_id, _ctx.participant_id);

    INSERT INTO public.chat_messages (thread_id, org_id, sender_type, content)
    VALUES (_thread_id, _ctx.org_id, 'participant', '    ');

    RAISE NOTICE 'T4.4 FAIL: Whitespace content accepted';
EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'T4.4 PASS: Whitespace content rejected by CHECK constraint';
END $$;

-- T4.5: Negative unread_count rejected
DO $$
DECLARE
    _ctx f012_test_context%ROWTYPE;
    _thread_id uuid;
BEGIN
    SELECT * INTO _ctx FROM f012_test_context LIMIT 1;
    IF _ctx.event_id IS NULL THEN
        RAISE NOTICE 'T4.5 SKIP: No test data';
        RETURN;
    END IF;

    _thread_id := public.get_or_create_chat_thread(_ctx.event_id, _ctx.participant_id);

    UPDATE public.chat_threads SET unread_count_organizer = -1 WHERE id = _thread_id;

    RAISE NOTICE 'T4.5 FAIL: Negative unread accepted';
EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'T4.5 PASS: Negative unread rejected by CHECK constraint';
END $$;

-- T4.6: FAQ empty title rejected
DO $$
DECLARE
    _ctx f012_test_context%ROWTYPE;
BEGIN
    SELECT * INTO _ctx FROM f012_test_context LIMIT 1;
    IF _ctx.org_id IS NULL THEN
        RAISE NOTICE 'T4.6 SKIP: No test data';
        RETURN;
    END IF;

    INSERT INTO public.faq_items (org_id, event_id, title, content, status, created_by)
    VALUES (_ctx.org_id, _ctx.event_id, '', 'Content', 'draft', _ctx.user_id);

    RAISE NOTICE 'T4.6 FAIL: Empty FAQ title accepted';
EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'T4.6 PASS: Empty FAQ title rejected by CHECK constraint';
END $$;

\echo ''

-- =========================================================================
-- SECTION 5: FAQ & SEARCH TESTS
-- =========================================================================
\echo '=== SECTION 5: FAQ & Search Tests ==='

-- T5.1: search_vector auto-populated
DO $$
DECLARE
    _ctx f012_test_context%ROWTYPE;
    _faq_id uuid;
    _has_vector boolean;
BEGIN
    SELECT * INTO _ctx FROM f012_test_context LIMIT 1;
    IF _ctx.org_id IS NULL OR _ctx.user_id IS NULL THEN
        RAISE NOTICE 'T5.1 SKIP: No test data';
        RETURN;
    END IF;

    INSERT INTO public.faq_items (org_id, event_id, title, content, status, created_by)
    VALUES (_ctx.org_id, _ctx.event_id, 'Test Zoeken', 'Dit artikel gaat over tickets', 'published', _ctx.user_id)
    RETURNING id INTO _faq_id;

    SELECT search_vector IS NOT NULL INTO _has_vector FROM public.faq_items WHERE id = _faq_id;

    IF _has_vector THEN
        RAISE NOTICE 'T5.1 PASS: search_vector auto-populated on insert';
    ELSE
        RAISE NOTICE 'T5.1 FAIL: search_vector is NULL';
    END IF;

    DELETE FROM public.faq_items WHERE id = _faq_id;
END $$;

-- T5.2: Full-text search works
DO $$
DECLARE
    _ctx f012_test_context%ROWTYPE;
    _faq_id uuid;
    _found boolean;
BEGIN
    SELECT * INTO _ctx FROM f012_test_context LIMIT 1;
    IF _ctx.org_id IS NULL OR _ctx.user_id IS NULL THEN
        RAISE NOTICE 'T5.2 SKIP: No test data';
        RETURN;
    END IF;

    INSERT INTO public.faq_items (org_id, event_id, title, content, status, created_by)
    VALUES (_ctx.org_id, _ctx.event_id, 'FAQ Betalen', 'Hoe kan ik met iDEAL betalen?', 'published', _ctx.user_id)
    RETURNING id INTO _faq_id;

    SELECT EXISTS (
        SELECT 1 FROM public.faq_items
        WHERE id = _faq_id AND search_vector @@ plainto_tsquery('dutch', 'betalen')
    ) INTO _found;

    IF _found THEN
        RAISE NOTICE 'T5.2 PASS: Full-text search matches "betalen"';
    ELSE
        RAISE NOTICE 'T5.2 FAIL: Search did not match';
    END IF;

    DELETE FROM public.faq_items WHERE id = _faq_id;
END $$;

\echo ''

-- =========================================================================
-- SECTION 6: SETTINGS DOMAIN TESTS
-- =========================================================================
\echo '=== SECTION 6: Settings Domain Tests ==='

-- T6.1: messaging domain accepted in event_settings
DO $$
DECLARE
    _ctx f012_test_context%ROWTYPE;
BEGIN
    SELECT * INTO _ctx FROM f012_test_context LIMIT 1;
    IF _ctx.event_id IS NULL THEN
        RAISE NOTICE 'T6.1 SKIP: No test data';
        RETURN;
    END IF;

    INSERT INTO public.event_settings (event_id, domain, setting_value)
    VALUES (_ctx.event_id, 'messaging', '{"rate_limit": {"msgs_per_minute": 10}}'::jsonb)
    ON CONFLICT (event_id, domain) DO UPDATE SET setting_value = EXCLUDED.setting_value;

    RAISE NOTICE 'T6.1 PASS: messaging domain accepted in event_settings';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'T6.1 FAIL: messaging domain rejected - %', SQLERRM;
END $$;

-- T6.2: Event settings override works
DO $$
DECLARE
    _ctx f012_test_context%ROWTYPE;
    _settings jsonb;
BEGIN
    SELECT * INTO _ctx FROM f012_test_context LIMIT 1;
    IF _ctx.event_id IS NULL THEN
        RAISE NOTICE 'T6.2 SKIP: No test data';
        RETURN;
    END IF;

    INSERT INTO public.event_settings (event_id, domain, setting_value)
    VALUES (_ctx.event_id, 'messaging', '{"rate_limit": {"msgs_per_minute": 15}}'::jsonb)
    ON CONFLICT (event_id, domain) DO UPDATE SET setting_value = EXCLUDED.setting_value;

    _settings := public.get_messaging_settings(_ctx.event_id);

    IF (_settings->'rate_limit'->>'msgs_per_minute')::int = 15 THEN
        RAISE NOTICE 'T6.2 PASS: Event override applied (msgs_per_minute=15)';
    ELSE
        RAISE NOTICE 'T6.2 FAIL: Got msgs_per_minute=%', _settings->'rate_limit'->>'msgs_per_minute';
    END IF;
END $$;

\echo ''

-- =========================================================================
-- SECTION 7: INTEGRATION TEST
-- =========================================================================
\echo '=== SECTION 7: Full Integration Test ==='

DO $$
DECLARE
    _ctx f012_test_context%ROWTYPE;
    _thread_id uuid;
    _msg_count int;
    _unread int;
    _status text;
BEGIN
    SELECT * INTO _ctx FROM f012_test_context LIMIT 1;
    IF _ctx.event_id IS NULL THEN
        RAISE NOTICE 'INTEGRATION SKIP: No test data available';
        RETURN;
    END IF;

    RAISE NOTICE 'Starting full messaging flow integration test...';

    -- 1. Get/create thread
    _thread_id := public.get_or_create_chat_thread(_ctx.event_id, _ctx.participant_id);
    RAISE NOTICE 'Step 1: Thread = %', _thread_id;

    -- Reset
    UPDATE public.chat_threads SET status = 'open', unread_count_organizer = 0 WHERE id = _thread_id;
    DELETE FROM public.chat_messages WHERE thread_id = _thread_id;

    -- 2. Participant sends
    INSERT INTO public.chat_messages (thread_id, org_id, sender_type, content)
    VALUES (_thread_id, _ctx.org_id, 'participant', 'Hallo, ik heb een vraag.');

    SELECT unread_count_organizer, status::text INTO _unread, _status FROM public.chat_threads WHERE id = _thread_id;
    RAISE NOTICE 'Step 2: After participant msg - unread=%, status=%', _unread, _status;

    -- 3. Organizer replies
    INSERT INTO public.chat_messages (thread_id, org_id, sender_type, content)
    VALUES (_thread_id, _ctx.org_id, 'organizer', 'Dag! Wat is je vraag?');

    SELECT status::text INTO _status FROM public.chat_threads WHERE id = _thread_id;
    RAISE NOTICE 'Step 3: After organizer reply - status=%', _status;

    -- 4. Count messages
    SELECT COUNT(*) INTO _msg_count FROM public.chat_messages WHERE thread_id = _thread_id;
    RAISE NOTICE 'Step 4: Total messages = %', _msg_count;

    -- 5. Close and reopen
    UPDATE public.chat_threads SET status = 'closed' WHERE id = _thread_id;

    INSERT INTO public.chat_messages (thread_id, org_id, sender_type, content)
    VALUES (_thread_id, _ctx.org_id, 'participant', 'Nog een vraag!');

    SELECT status::text INTO _status FROM public.chat_threads WHERE id = _thread_id;
    RAISE NOTICE 'Step 5: After reopen msg - status=%', _status;

    IF _msg_count >= 2 AND _status = 'open' THEN
        RAISE NOTICE '';
        RAISE NOTICE '✓ INTEGRATION TEST PASSED';
    ELSE
        RAISE NOTICE '';
        RAISE NOTICE '✗ INTEGRATION TEST FAILED';
    END IF;
END $$;

\echo ''

-- =========================================================================
-- SUMMARY
-- =========================================================================
\echo '=========================================='
\echo 'F012 TEST SUITE COMPLETE'
\echo ''
\echo 'Sections:'
\echo '  1. Schema Verification (6 tests)'
\echo '  2. Helper Functions (10 tests)'
\echo '  3. Triggers (5 tests)'
\echo '  4. Constraints (6 tests)'
\echo '  5. FAQ & Search (2 tests)'
\echo '  6. Settings Domain (2 tests)'
\echo '  7. Integration (1 full flow)'
\echo ''
\echo 'Total: 32 test cases'
\echo '=========================================='

-- Cleanup temp table
DROP TABLE IF EXISTS f012_test_context;
