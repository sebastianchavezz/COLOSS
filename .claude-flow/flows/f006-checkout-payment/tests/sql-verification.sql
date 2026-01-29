-- ===========================================================================
-- F006 Checkout & Payment: SQL Verification Tests
-- ===========================================================================
-- Run with: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f sql-verification.sql
--
-- Tests the ACTUAL BUSINESS LOGIC, not just "does function exist"
-- ===========================================================================

\set ON_ERROR_STOP on
\timing on

-- ===========================================================================
-- SETUP: Create test fixtures
-- ===========================================================================
DO $$
DECLARE
    v_test_org_id UUID;
    v_test_event_id UUID;
    v_test_ticket_type_id UUID;
    v_test_ticket_type_2_id UUID;
    v_test_order_id UUID;
    v_test_order_item_id UUID;
    v_test_payment_id TEXT;
    v_result JSONB;
    v_count INT;
    v_status TEXT;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=============================================================';
    RAISE NOTICE 'F006 SQL VERIFICATION TESTS';
    RAISE NOTICE '=============================================================';
    RAISE NOTICE '';

    -- =========================================================================
    -- CLEANUP: Remove any leftover test data
    -- =========================================================================
    DELETE FROM public.ticket_instances WHERE event_id IN (SELECT id FROM public.events WHERE slug LIKE 'f006-test-%');
    DELETE FROM public.registrations WHERE event_id IN (SELECT id FROM public.events WHERE slug LIKE 'f006-test-%');
    DELETE FROM public.order_items WHERE order_id IN (SELECT o.id FROM public.orders o JOIN public.events e ON o.event_id = e.id WHERE e.slug LIKE 'f006-test-%');
    DELETE FROM public.payments WHERE order_id IN (SELECT o.id FROM public.orders o JOIN public.events e ON o.event_id = e.id WHERE e.slug LIKE 'f006-test-%');
    DELETE FROM public.payment_events WHERE provider_payment_id LIKE 'f006_test_%';
    DELETE FROM public.orders WHERE event_id IN (SELECT id FROM public.events WHERE slug LIKE 'f006-test-%');
    DELETE FROM public.ticket_types WHERE event_id IN (SELECT id FROM public.events WHERE slug LIKE 'f006-test-%');
    DELETE FROM public.events WHERE slug LIKE 'f006-test-%';
    DELETE FROM public.org_members WHERE org_id IN (SELECT id FROM public.orgs WHERE slug LIKE 'f006-test-%');
    DELETE FROM public.participants WHERE email LIKE '%@example.com';
    DELETE FROM public.audit_log WHERE org_id IN (SELECT id FROM public.orgs WHERE slug LIKE 'f006-test-%');
    DELETE FROM public.orgs WHERE slug LIKE 'f006-test-%';

    -- =========================================================================
    -- FIXTURE: Create test org
    -- =========================================================================
    INSERT INTO public.orgs (id, name, slug)
    VALUES (gen_random_uuid(), 'F006 Test Org', 'f006-test-org')
    RETURNING id INTO v_test_org_id;

    -- =========================================================================
    -- FIXTURE: Create test event (published)
    -- =========================================================================
    INSERT INTO public.events (id, org_id, slug, name, status, start_time)
    VALUES (gen_random_uuid(), v_test_org_id, 'f006-test-event', 'F006 Test Event', 'published', NOW() + INTERVAL '7 days')
    RETURNING id INTO v_test_event_id;

    -- =========================================================================
    -- FIXTURE: Create ticket types
    -- =========================================================================
    -- Type 1: Regular ticket, capacity 10, currently on sale
    INSERT INTO public.ticket_types (id, event_id, name, price, capacity_total, sales_start, sales_end)
    VALUES (gen_random_uuid(), v_test_event_id, 'Regular Ticket', 25.00, 10, NOW() - INTERVAL '1 hour', NOW() + INTERVAL '7 days')
    RETURNING id INTO v_test_ticket_type_id;

    -- Type 2: VIP ticket, capacity 1 (for overbooked test)
    INSERT INTO public.ticket_types (id, event_id, name, price, capacity_total, sales_start, sales_end)
    VALUES (gen_random_uuid(), v_test_event_id, 'VIP Ticket', 100.00, 1, NOW() - INTERVAL '1 hour', NOW() + INTERVAL '7 days')
    RETURNING id INTO v_test_ticket_type_2_id;

    RAISE NOTICE '✓ Test fixtures created (org: %, event: %)', v_test_org_id, v_test_event_id;

    -- =========================================================================
    -- TEST 1: validate_checkout_capacity - VALID REQUEST
    -- =========================================================================
    RAISE NOTICE '';
    RAISE NOTICE '─── TEST 1: validate_checkout_capacity - Valid request ───';

    v_result := public.validate_checkout_capacity(
        v_test_event_id,
        jsonb_build_array(
            jsonb_build_object('ticket_type_id', v_test_ticket_type_id, 'quantity', 2)
        )
    );

    IF (v_result->>'valid')::boolean = true THEN
        IF (v_result->>'total_price')::numeric = 50.00 THEN
            RAISE NOTICE '✅ PASS: valid=true, total_price=50.00 (2 x €25)';
        ELSE
            RAISE EXCEPTION '❌ FAIL: Expected total_price=50.00, got %', v_result->>'total_price';
        END IF;
    ELSE
        RAISE EXCEPTION '❌ FAIL: Expected valid=true, got %', v_result;
    END IF;

    -- =========================================================================
    -- TEST 2: validate_checkout_capacity - INVALID QUANTITY (0)
    -- =========================================================================
    RAISE NOTICE '';
    RAISE NOTICE '─── TEST 2: validate_checkout_capacity - Invalid quantity (0) ───';

    v_result := public.validate_checkout_capacity(
        v_test_event_id,
        jsonb_build_array(
            jsonb_build_object('ticket_type_id', v_test_ticket_type_id, 'quantity', 0)
        )
    );

    IF (v_result->>'valid')::boolean = false AND v_result->>'error' = 'INVALID_QUANTITY' THEN
        RAISE NOTICE '✅ PASS: valid=false, error=INVALID_QUANTITY';
    ELSE
        RAISE EXCEPTION '❌ FAIL: Expected valid=false with INVALID_QUANTITY, got %', v_result;
    END IF;

    -- =========================================================================
    -- TEST 3: validate_checkout_capacity - SALES WINDOW FUTURE
    -- =========================================================================
    RAISE NOTICE '';
    RAISE NOTICE '─── TEST 3: validate_checkout_capacity - Sales not started ───';

    DECLARE
        v_future_ticket_id UUID;
    BEGIN
        INSERT INTO public.ticket_types (id, event_id, name, price, capacity_total, sales_start, sales_end)
        VALUES (gen_random_uuid(), v_test_event_id, 'Future Ticket', 10.00, 100, NOW() + INTERVAL '1 day', NOW() + INTERVAL '30 days')
        RETURNING id INTO v_future_ticket_id;

        v_result := public.validate_checkout_capacity(
            v_test_event_id,
            jsonb_build_array(
                jsonb_build_object('ticket_type_id', v_future_ticket_id, 'quantity', 1)
            )
        );

        IF (v_result->>'valid')::boolean = false THEN
            IF v_result::text LIKE '%not started%' THEN
                RAISE NOTICE '✅ PASS: valid=false, sales not started';
            ELSE
                RAISE EXCEPTION '❌ FAIL: Expected "not started" in details, got %', v_result;
            END IF;
        ELSE
            RAISE EXCEPTION '❌ FAIL: Expected valid=false for future sales_start, got %', v_result;
        END IF;

        DELETE FROM public.ticket_types WHERE id = v_future_ticket_id;
    END;

    -- =========================================================================
    -- TEST 4: validate_checkout_capacity - SALES WINDOW PAST
    -- =========================================================================
    RAISE NOTICE '';
    RAISE NOTICE '─── TEST 4: validate_checkout_capacity - Sales ended ───';

    DECLARE
        v_past_ticket_id UUID;
    BEGIN
        INSERT INTO public.ticket_types (id, event_id, name, price, capacity_total, sales_start, sales_end)
        VALUES (gen_random_uuid(), v_test_event_id, 'Past Ticket', 10.00, 100, NOW() - INTERVAL '30 days', NOW() - INTERVAL '1 day')
        RETURNING id INTO v_past_ticket_id;

        v_result := public.validate_checkout_capacity(
            v_test_event_id,
            jsonb_build_array(
                jsonb_build_object('ticket_type_id', v_past_ticket_id, 'quantity', 1)
            )
        );

        IF (v_result->>'valid')::boolean = false THEN
            IF v_result::text LIKE '%ended%' THEN
                RAISE NOTICE '✅ PASS: valid=false, sales ended';
            ELSE
                RAISE EXCEPTION '❌ FAIL: Expected "ended" in details, got %', v_result;
            END IF;
        ELSE
            RAISE EXCEPTION '❌ FAIL: Expected valid=false for past sales_end, got %', v_result;
        END IF;

        DELETE FROM public.ticket_types WHERE id = v_past_ticket_id;
    END;

    -- =========================================================================
    -- TEST 5: validate_checkout_capacity - NON-EXISTENT TICKET TYPE
    -- =========================================================================
    RAISE NOTICE '';
    RAISE NOTICE '─── TEST 5: validate_checkout_capacity - Non-existent ticket type ───';

    v_result := public.validate_checkout_capacity(
        v_test_event_id,
        jsonb_build_array(
            jsonb_build_object('ticket_type_id', gen_random_uuid(), 'quantity', 1)
        )
    );

    IF (v_result->>'valid')::boolean = false THEN
        RAISE NOTICE '✅ PASS: valid=false for non-existent ticket type';
    ELSE
        RAISE EXCEPTION '❌ FAIL: Expected valid=false for non-existent ticket, got %', v_result;
    END IF;

    -- =========================================================================
    -- TEST 6: handle_payment_webhook - PAID PATH (creates ticket_instances)
    -- =========================================================================
    RAISE NOTICE '';
    RAISE NOTICE '─── TEST 6: handle_payment_webhook - PAID creates tickets ───';

    INSERT INTO public.orders (id, event_id, org_id, email, status, total_amount, currency)
    VALUES (gen_random_uuid(), v_test_event_id, v_test_org_id, 'test@example.com', 'pending', 50.00, 'EUR')
    RETURNING id INTO v_test_order_id;

    INSERT INTO public.order_items (id, order_id, ticket_type_id, quantity, unit_price, total_price)
    VALUES (gen_random_uuid(), v_test_order_id, v_test_ticket_type_id, 2, 25.00, 50.00)
    RETURNING id INTO v_test_order_item_id;

    v_test_payment_id := 'f006_test_pay_' || gen_random_uuid()::text;
    INSERT INTO public.payments (org_id, order_id, provider, provider_payment_id, amount, currency, status)
    VALUES (v_test_org_id, v_test_order_id, 'mollie', v_test_payment_id, 5000, 'EUR', 'pending');

    v_result := public.handle_payment_webhook(
        v_test_order_id,
        v_test_payment_id,
        'paid',
        50.00,
        'EUR'
    );

    SELECT status INTO v_status FROM public.orders WHERE id = v_test_order_id;
    IF v_status != 'paid' THEN
        RAISE EXCEPTION '❌ FAIL: Order status should be paid, got %', v_status;
    END IF;

    SELECT COUNT(*) INTO v_count FROM public.ticket_instances WHERE order_id = v_test_order_id;
    IF v_count != 2 THEN
        RAISE EXCEPTION '❌ FAIL: Expected 2 ticket_instances, got %', v_count;
    END IF;

    SELECT COUNT(*) INTO v_count
    FROM public.ticket_instances
    WHERE order_id = v_test_order_id
      AND status = 'issued'
      AND token_hash IS NOT NULL
      AND qr_code IS NOT NULL;
    IF v_count != 2 THEN
        RAISE EXCEPTION '❌ FAIL: ticket_instances missing status/token_hash/qr_code';
    END IF;

    IF (v_result->>'paid')::boolean = true THEN
        RAISE NOTICE '✅ PASS: paid=true, order.status=paid, 2 ticket_instances created';
    ELSE
        RAISE EXCEPTION '❌ FAIL: Expected paid=true, got %', v_result;
    END IF;

    -- =========================================================================
    -- TEST 7: handle_payment_webhook - IDEMPOTENT (no duplicate tickets)
    -- =========================================================================
    RAISE NOTICE '';
    RAISE NOTICE '─── TEST 7: handle_payment_webhook - Idempotent (no dup tickets) ───';

    v_result := public.handle_payment_webhook(
        v_test_order_id,
        v_test_payment_id,
        'paid',
        50.00,
        'EUR'
    );

    SELECT COUNT(*) INTO v_count FROM public.ticket_instances WHERE order_id = v_test_order_id;
    IF v_count != 2 THEN
        RAISE EXCEPTION '❌ FAIL: Expected still 2 tickets (no duplicates), got %', v_count;
    END IF;

    IF (v_result->>'paid')::boolean = false AND v_result->>'message' LIKE '%already%' THEN
        RAISE NOTICE '✅ PASS: paid=false (already paid), still 2 ticket_instances';
    ELSE
        RAISE EXCEPTION '❌ FAIL: Expected idempotent behavior, got %', v_result;
    END IF;

    -- =========================================================================
    -- TEST 8: handle_payment_webhook - FAILED PATH
    -- =========================================================================
    RAISE NOTICE '';
    RAISE NOTICE '─── TEST 8: handle_payment_webhook - FAILED path ───';

    DECLARE
        v_fail_order_id UUID;
        v_fail_payment_id TEXT;
    BEGIN
        INSERT INTO public.orders (id, event_id, org_id, email, status, total_amount, currency)
        VALUES (gen_random_uuid(), v_test_event_id, v_test_org_id, 'fail@example.com', 'pending', 25.00, 'EUR')
        RETURNING id INTO v_fail_order_id;

        v_fail_payment_id := 'f006_test_fail_' || gen_random_uuid()::text;
        INSERT INTO public.payments (org_id, order_id, provider, provider_payment_id, amount, currency, status)
        VALUES (v_test_org_id, v_fail_order_id, 'mollie', v_fail_payment_id, 2500, 'EUR', 'pending');

        v_result := public.handle_payment_webhook(
            v_fail_order_id,
            v_fail_payment_id,
            'failed',
            25.00,
            'EUR'
        );

        SELECT status INTO v_status FROM public.orders WHERE id = v_fail_order_id;
        IF v_status = 'failed' THEN
            RAISE NOTICE '✅ PASS: order.status=failed after failed webhook';
        ELSE
            RAISE EXCEPTION '❌ FAIL: Expected order status=failed, got %', v_status;
        END IF;

        SELECT COUNT(*) INTO v_count FROM public.ticket_instances WHERE order_id = v_fail_order_id;
        IF v_count != 0 THEN
            RAISE EXCEPTION '❌ FAIL: Expected 0 ticket_instances for failed order, got %', v_count;
        END IF;
    END;

    -- =========================================================================
    -- TEST 9: handle_payment_webhook - OVERBOOKED FAILSAFE
    -- =========================================================================
    RAISE NOTICE '';
    RAISE NOTICE '─── TEST 9: handle_payment_webhook - Overbooked failsafe ───';

    DECLARE
        v_order1_id UUID;
        v_order2_id UUID;
        v_pay1_id TEXT;
        v_pay2_id TEXT;
    BEGIN
        INSERT INTO public.orders (id, event_id, org_id, email, status, total_amount, currency)
        VALUES (gen_random_uuid(), v_test_event_id, v_test_org_id, 'vip1@example.com', 'pending', 100.00, 'EUR')
        RETURNING id INTO v_order1_id;

        INSERT INTO public.order_items (order_id, ticket_type_id, quantity, unit_price, total_price)
        VALUES (v_order1_id, v_test_ticket_type_2_id, 1, 100.00, 100.00);

        v_pay1_id := 'f006_test_vip1_' || gen_random_uuid()::text;
        INSERT INTO public.payments (org_id, order_id, provider, provider_payment_id, amount, currency, status)
        VALUES (v_test_org_id, v_order1_id, 'mollie', v_pay1_id, 10000, 'EUR', 'pending');

        INSERT INTO public.orders (id, event_id, org_id, email, status, total_amount, currency)
        VALUES (gen_random_uuid(), v_test_event_id, v_test_org_id, 'vip2@example.com', 'pending', 100.00, 'EUR')
        RETURNING id INTO v_order2_id;

        INSERT INTO public.order_items (order_id, ticket_type_id, quantity, unit_price, total_price)
        VALUES (v_order2_id, v_test_ticket_type_2_id, 1, 100.00, 100.00);

        v_pay2_id := 'f006_test_vip2_' || gen_random_uuid()::text;
        INSERT INTO public.payments (org_id, order_id, provider, provider_payment_id, amount, currency, status)
        VALUES (v_test_org_id, v_order2_id, 'mollie', v_pay2_id, 10000, 'EUR', 'pending');

        v_result := public.handle_payment_webhook(v_order1_id, v_pay1_id, 'paid', 100.00, 'EUR');

        SELECT COUNT(*) INTO v_count FROM public.ticket_instances WHERE order_id = v_order1_id;
        IF v_count != 1 THEN
            RAISE EXCEPTION '❌ FAIL: Order 1 should have 1 ticket, got %', v_count;
        END IF;
        RAISE NOTICE '  Order 1 paid, 1 VIP ticket issued';

        v_result := public.handle_payment_webhook(v_order2_id, v_pay2_id, 'paid', 100.00, 'EUR');

        IF (v_result->>'overbooked')::boolean = true THEN
            SELECT status INTO v_status FROM public.orders WHERE id = v_order2_id;
            IF v_status = 'cancelled' THEN
                SELECT COUNT(*) INTO v_count FROM public.ticket_instances WHERE order_id = v_order2_id;
                IF v_count = 0 THEN
                    RAISE NOTICE '✅ PASS: Overbooked detected, order2 cancelled, 0 tickets';
                ELSE
                    RAISE EXCEPTION '❌ FAIL: Expected 0 tickets for overbooked, got %', v_count;
                END IF;
            ELSE
                RAISE EXCEPTION '❌ FAIL: Expected cancelled for overbooked, got %', v_status;
            END IF;
        ELSE
            SELECT COUNT(*) INTO v_count FROM public.ticket_instances WHERE order_id = v_order2_id;
            IF v_count > 0 THEN
                RAISE EXCEPTION '❌ FAIL: Overbooked not triggered but tickets issued!';
            ELSE
                RAISE NOTICE '⚠️  WARNING: overbooked=false, but no tickets issued either';
            END IF;
        END IF;
    END;

    -- =========================================================================
    -- TEST 10: payment_events IDEMPOTENCY
    -- =========================================================================
    RAISE NOTICE '';
    RAISE NOTICE '─── TEST 10: payment_events idempotency (unique constraint) ───';

    DECLARE
        v_event_key TEXT := 'f006_test_idempotent_' || gen_random_uuid()::text;
    BEGIN
        INSERT INTO public.payment_events (provider, provider_event_id, provider_payment_id, event_type, payload)
        VALUES ('mollie', v_event_key, 'test_pay', 'payment.paid', '{"test": true}'::jsonb);

        BEGIN
            INSERT INTO public.payment_events (provider, provider_event_id, provider_payment_id, event_type, payload)
            VALUES ('mollie', v_event_key, 'test_pay', 'payment.paid', '{"test": true}'::jsonb);

            RAISE EXCEPTION '❌ FAIL: Duplicate payment_event should be blocked';
        EXCEPTION WHEN unique_violation THEN
            RAISE NOTICE '✅ PASS: Duplicate blocked by unique constraint';
        END;

        DELETE FROM public.payment_events WHERE provider_event_id = v_event_key;
    END;

    -- =========================================================================
    -- CLEANUP
    -- =========================================================================
    RAISE NOTICE '';
    RAISE NOTICE '─── CLEANUP ───';

    -- Delete in correct order respecting foreign key constraints
    DELETE FROM public.ticket_instances WHERE event_id = v_test_event_id;
    DELETE FROM public.registrations WHERE event_id = v_test_event_id;
    DELETE FROM public.order_items WHERE order_id IN (SELECT id FROM public.orders WHERE event_id = v_test_event_id);
    DELETE FROM public.payments WHERE order_id IN (SELECT id FROM public.orders WHERE event_id = v_test_event_id);
    DELETE FROM public.payment_events WHERE provider_payment_id LIKE 'f006_test_%';
    DELETE FROM public.orders WHERE event_id = v_test_event_id;
    DELETE FROM public.ticket_types WHERE event_id = v_test_event_id;
    DELETE FROM public.events WHERE id = v_test_event_id;
    DELETE FROM public.participants WHERE email LIKE '%@example.com';
    DELETE FROM public.audit_log WHERE org_id = v_test_org_id;
    DELETE FROM public.orgs WHERE id = v_test_org_id;

    RAISE NOTICE '✓ Test data cleaned up';

    RAISE NOTICE '';
    RAISE NOTICE '=============================================================';
    RAISE NOTICE 'ALL F006 SQL TESTS COMPLETE';
    RAISE NOTICE '=============================================================';
END $$;
