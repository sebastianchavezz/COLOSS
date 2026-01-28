-- F005 S2: Ticket Availability & Validation Tests
-- Verifies get_ticket_availability, validate_ticket_order, get_ticket_type_with_availability RPCs

-- ============================================================================
-- TEST SETUP
-- ============================================================================

DO $$
DECLARE
    v_test_org_id uuid;
    v_test_event_id uuid;
    v_test_ticket_type_id uuid;
    v_sold_out_ticket_id uuid;
    v_future_ticket_id uuid;
    v_test_order_id uuid;
    v_result jsonb;
    v_test_count int := 0;
    v_pass_count int := 0;
BEGIN
    RAISE NOTICE '=== F005 S2 Integration Tests ===';
    RAISE NOTICE '';

    -- Create test org
    INSERT INTO orgs (name, slug)
    VALUES ('F005 Test Org', 'f005-test-' || gen_random_uuid()::text)
    RETURNING id INTO v_test_org_id;

    -- Create test event
    INSERT INTO events (org_id, name, slug, status, start_time, location_name)
    VALUES (
        v_test_org_id,
        'F005 Test Event',
        'f005-test-event-' || gen_random_uuid()::text,
        'published',
        now() + interval '30 days',
        'Test Location'
    )
    RETURNING id INTO v_test_event_id;

    -- Create available ticket type
    INSERT INTO ticket_types (
        event_id, name, description, price, currency,
        capacity_total, status, visibility, max_per_participant,
        distance_value, distance_unit, ticket_category
    )
    VALUES (
        v_test_event_id, '10K Run', 'A 10K running event',
        25.00, 'EUR', 100, 'published', 'visible', 5,
        10.0, 'km', 'individual'
    )
    RETURNING id INTO v_test_ticket_type_id;

    -- Create sold out ticket type (capacity 2, 2 sold)
    INSERT INTO ticket_types (
        event_id, name, description, price, currency,
        capacity_total, status, visibility
    )
    VALUES (
        v_test_event_id, 'Sold Out Ticket', 'Limited edition',
        50.00, 'EUR', 2, 'published', 'visible'
    )
    RETURNING id INTO v_sold_out_ticket_id;

    -- Create test order for sold tickets
    INSERT INTO orders (event_id, status, total_amount, currency, email)
    VALUES (v_test_event_id, 'paid', 100.00, 'EUR', 'test@example.com')
    RETURNING id INTO v_test_order_id;

    -- Sell all tickets for sold out type
    INSERT INTO ticket_instances (event_id, ticket_type_id, order_id, status, qr_code)
    VALUES
        (v_test_event_id, v_sold_out_ticket_id, v_test_order_id, 'issued', 'qr-' || gen_random_uuid()::text),
        (v_test_event_id, v_sold_out_ticket_id, v_test_order_id, 'issued', 'qr-' || gen_random_uuid()::text);

    -- Create future sales ticket type
    INSERT INTO ticket_types (
        event_id, name, description, price, currency,
        capacity_total, status, visibility,
        sales_start, sales_end
    )
    VALUES (
        v_test_event_id, 'Future Ticket', 'Not yet on sale',
        30.00, 'EUR', 50, 'published', 'visible',
        now() + interval '7 days',
        now() + interval '30 days'
    )
    RETURNING id INTO v_future_ticket_id;

    -- ============================================================================
    -- TEST 1: get_ticket_availability returns ticket types
    -- ============================================================================
    v_test_count := v_test_count + 1;
    RAISE NOTICE 'TEST 1: get_ticket_availability returns ticket types';

    SELECT public.get_ticket_availability(v_test_event_id) INTO v_result;

    IF v_result->>'status' = 'OK'
       AND jsonb_array_length(v_result->'ticket_types') = 3
    THEN
        v_pass_count := v_pass_count + 1;
        RAISE NOTICE '  PASS: Returns 3 ticket types';
    ELSE
        RAISE NOTICE '  FAIL: Expected 3 ticket types, got %', jsonb_array_length(v_result->'ticket_types');
        RAISE NOTICE '  Result: %', v_result;
    END IF;

    -- ============================================================================
    -- TEST 2: Availability shows correct sold/available counts
    -- ============================================================================
    v_test_count := v_test_count + 1;
    RAISE NOTICE 'TEST 2: Availability shows correct sold/available counts';

    SELECT public.get_ticket_availability(v_test_event_id) INTO v_result;

    -- Find the 10K ticket
    DECLARE
        v_ticket jsonb;
        v_found boolean := false;
    BEGIN
        FOR v_ticket IN SELECT * FROM jsonb_array_elements(v_result->'ticket_types')
        LOOP
            IF v_ticket->>'name' = '10K Run' THEN
                v_found := true;
                IF (v_ticket->>'sold_count')::int = 0
                   AND (v_ticket->>'available_count')::int = 100
                   AND (v_ticket->>'is_sold_out')::boolean = false
                THEN
                    v_pass_count := v_pass_count + 1;
                    RAISE NOTICE '  PASS: 10K Run shows 0 sold, 100 available';
                ELSE
                    RAISE NOTICE '  FAIL: 10K Run counts incorrect: %', v_ticket;
                END IF;
            END IF;
        END LOOP;

        IF NOT v_found THEN
            RAISE NOTICE '  FAIL: 10K Run ticket not found';
        END IF;
    END;

    -- ============================================================================
    -- TEST 3: Sold out ticket shows correct state
    -- ============================================================================
    v_test_count := v_test_count + 1;
    RAISE NOTICE 'TEST 3: Sold out ticket shows correct state';

    SELECT public.get_ticket_availability(v_test_event_id) INTO v_result;

    DECLARE
        v_ticket jsonb;
        v_found boolean := false;
    BEGIN
        FOR v_ticket IN SELECT * FROM jsonb_array_elements(v_result->'ticket_types')
        LOOP
            IF v_ticket->>'name' = 'Sold Out Ticket' THEN
                v_found := true;
                IF (v_ticket->>'sold_count')::int = 2
                   AND (v_ticket->>'available_count')::int = 0
                   AND (v_ticket->>'is_sold_out')::boolean = true
                THEN
                    v_pass_count := v_pass_count + 1;
                    RAISE NOTICE '  PASS: Sold Out Ticket shows is_sold_out=true';
                ELSE
                    RAISE NOTICE '  FAIL: Sold Out Ticket state incorrect: %', v_ticket;
                END IF;
            END IF;
        END LOOP;

        IF NOT v_found THEN
            RAISE NOTICE '  FAIL: Sold Out Ticket not found';
        END IF;
    END;

    -- ============================================================================
    -- TEST 4: Future ticket shows on_sale=false
    -- ============================================================================
    v_test_count := v_test_count + 1;
    RAISE NOTICE 'TEST 4: Future ticket shows on_sale=false';

    SELECT public.get_ticket_availability(v_test_event_id) INTO v_result;

    DECLARE
        v_ticket jsonb;
        v_found boolean := false;
    BEGIN
        FOR v_ticket IN SELECT * FROM jsonb_array_elements(v_result->'ticket_types')
        LOOP
            IF v_ticket->>'name' = 'Future Ticket' THEN
                v_found := true;
                IF (v_ticket->>'on_sale')::boolean = false THEN
                    v_pass_count := v_pass_count + 1;
                    RAISE NOTICE '  PASS: Future Ticket shows on_sale=false';
                ELSE
                    RAISE NOTICE '  FAIL: Future Ticket on_sale should be false: %', v_ticket;
                END IF;
            END IF;
        END LOOP;

        IF NOT v_found THEN
            RAISE NOTICE '  FAIL: Future Ticket not found';
        END IF;
    END;

    -- ============================================================================
    -- TEST 5: Ticket shows extended info (distance, category)
    -- ============================================================================
    v_test_count := v_test_count + 1;
    RAISE NOTICE 'TEST 5: Ticket shows extended info (distance, category)';

    SELECT public.get_ticket_availability(v_test_event_id) INTO v_result;

    DECLARE
        v_ticket jsonb;
        v_found boolean := false;
    BEGIN
        FOR v_ticket IN SELECT * FROM jsonb_array_elements(v_result->'ticket_types')
        LOOP
            IF v_ticket->>'name' = '10K Run' THEN
                v_found := true;
                IF (v_ticket->>'distance_value')::numeric = 10.0
                   AND v_ticket->>'distance_unit' = 'km'
                   AND v_ticket->>'ticket_category' = 'individual'
                THEN
                    v_pass_count := v_pass_count + 1;
                    RAISE NOTICE '  PASS: 10K Run shows distance and category';
                ELSE
                    RAISE NOTICE '  FAIL: Extended info incorrect: %', v_ticket;
                END IF;
            END IF;
        END LOOP;

        IF NOT v_found THEN
            RAISE NOTICE '  FAIL: 10K Run ticket not found';
        END IF;
    END;

    -- ============================================================================
    -- TEST 6: validate_ticket_order - valid order passes
    -- ============================================================================
    v_test_count := v_test_count + 1;
    RAISE NOTICE 'TEST 6: validate_ticket_order - valid order passes';

    SELECT public.validate_ticket_order(
        v_test_event_id,
        jsonb_build_array(
            jsonb_build_object('ticket_type_id', v_test_ticket_type_id, 'quantity', 2)
        )
    ) INTO v_result;

    IF (v_result->>'valid')::boolean = true THEN
        v_pass_count := v_pass_count + 1;
        RAISE NOTICE '  PASS: Valid order accepted';
    ELSE
        RAISE NOTICE '  FAIL: Valid order rejected: %', v_result;
    END IF;

    -- ============================================================================
    -- TEST 7: validate_ticket_order - exceeds capacity fails
    -- ============================================================================
    v_test_count := v_test_count + 1;
    RAISE NOTICE 'TEST 7: validate_ticket_order - exceeds capacity fails';

    SELECT public.validate_ticket_order(
        v_test_event_id,
        jsonb_build_array(
            jsonb_build_object('ticket_type_id', v_sold_out_ticket_id, 'quantity', 1)
        )
    ) INTO v_result;

    IF (v_result->>'valid')::boolean = false
       AND v_result->'errors'->0->>'error' = 'INSUFFICIENT_CAPACITY'
    THEN
        v_pass_count := v_pass_count + 1;
        RAISE NOTICE '  PASS: Sold out ticket rejected with INSUFFICIENT_CAPACITY';
    ELSE
        RAISE NOTICE '  FAIL: Should reject sold out ticket: %', v_result;
    END IF;

    -- ============================================================================
    -- TEST 8: validate_ticket_order - exceeds max_per_participant fails
    -- ============================================================================
    v_test_count := v_test_count + 1;
    RAISE NOTICE 'TEST 8: validate_ticket_order - exceeds max_per_participant fails';

    SELECT public.validate_ticket_order(
        v_test_event_id,
        jsonb_build_array(
            jsonb_build_object('ticket_type_id', v_test_ticket_type_id, 'quantity', 10)
        )
    ) INTO v_result;

    IF (v_result->>'valid')::boolean = false
       AND v_result->'errors'->0->>'error' = 'EXCEEDS_MAX_PER_PARTICIPANT'
    THEN
        v_pass_count := v_pass_count + 1;
        RAISE NOTICE '  PASS: Exceeds max_per_participant rejected';
    ELSE
        RAISE NOTICE '  FAIL: Should reject exceeding max_per_participant: %', v_result;
    END IF;

    -- ============================================================================
    -- TEST 9: validate_ticket_order - future sales fails
    -- ============================================================================
    v_test_count := v_test_count + 1;
    RAISE NOTICE 'TEST 9: validate_ticket_order - future sales fails';

    SELECT public.validate_ticket_order(
        v_test_event_id,
        jsonb_build_array(
            jsonb_build_object('ticket_type_id', v_future_ticket_id, 'quantity', 1)
        )
    ) INTO v_result;

    IF (v_result->>'valid')::boolean = false
       AND v_result->'errors'->0->>'error' = 'SALES_NOT_STARTED'
    THEN
        v_pass_count := v_pass_count + 1;
        RAISE NOTICE '  PASS: Future ticket rejected with SALES_NOT_STARTED';
    ELSE
        RAISE NOTICE '  FAIL: Should reject future ticket: %', v_result;
    END IF;

    -- ============================================================================
    -- TEST 10: validate_ticket_order - empty items fails
    -- ============================================================================
    v_test_count := v_test_count + 1;
    RAISE NOTICE 'TEST 10: validate_ticket_order - empty items fails';

    SELECT public.validate_ticket_order(
        v_test_event_id,
        '[]'::jsonb
    ) INTO v_result;

    IF (v_result->>'valid')::boolean = false
       AND v_result->'errors'->0->>'error' = 'NO_ITEMS'
    THEN
        v_pass_count := v_pass_count + 1;
        RAISE NOTICE '  PASS: Empty items rejected with NO_ITEMS';
    ELSE
        RAISE NOTICE '  FAIL: Should reject empty items: %', v_result;
    END IF;

    -- ============================================================================
    -- TEST 11: get_ticket_type_with_availability - returns single ticket
    -- ============================================================================
    v_test_count := v_test_count + 1;
    RAISE NOTICE 'TEST 11: get_ticket_type_with_availability - returns single ticket';

    SELECT public.get_ticket_type_with_availability(v_test_ticket_type_id) INTO v_result;

    IF v_result->>'status' = 'OK'
       AND v_result->'ticket_type'->>'name' = '10K Run'
       AND (v_result->'ticket_type'->>'available_count')::int = 100
    THEN
        v_pass_count := v_pass_count + 1;
        RAISE NOTICE '  PASS: Single ticket returned with availability';
    ELSE
        RAISE NOTICE '  FAIL: Single ticket not returned correctly: %', v_result;
    END IF;

    -- ============================================================================
    -- TEST 12: get_ticket_availability - non-existent event returns error
    -- ============================================================================
    v_test_count := v_test_count + 1;
    RAISE NOTICE 'TEST 12: get_ticket_availability - non-existent event returns error';

    SELECT public.get_ticket_availability(gen_random_uuid()) INTO v_result;

    IF v_result->>'error' = 'EVENT_NOT_FOUND' THEN
        v_pass_count := v_pass_count + 1;
        RAISE NOTICE '  PASS: Non-existent event returns EVENT_NOT_FOUND';
    ELSE
        RAISE NOTICE '  FAIL: Should return EVENT_NOT_FOUND: %', v_result;
    END IF;

    -- ============================================================================
    -- CLEANUP
    -- ============================================================================
    DELETE FROM ticket_instances WHERE ticket_type_id IN (v_test_ticket_type_id, v_sold_out_ticket_id, v_future_ticket_id);
    DELETE FROM orders WHERE id = v_test_order_id;
    DELETE FROM ticket_types WHERE event_id = v_test_event_id;
    DELETE FROM events WHERE id = v_test_event_id;
    DELETE FROM orgs WHERE id = v_test_org_id;

    -- ============================================================================
    -- SUMMARY
    -- ============================================================================
    RAISE NOTICE '';
    RAISE NOTICE '=== TEST SUMMARY ===';
    RAISE NOTICE 'Tests Run: %', v_test_count;
    RAISE NOTICE 'Tests Passed: %', v_pass_count;
    RAISE NOTICE 'Tests Failed: %', v_test_count - v_pass_count;

    IF v_pass_count = v_test_count THEN
        RAISE NOTICE '';
        RAISE NOTICE 'ALL TESTS PASSED';
    ELSE
        RAISE NOTICE '';
        RAISE NOTICE 'SOME TESTS FAILED';
    END IF;
END $$;
