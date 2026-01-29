-- F009 Refund Test: Create a paid test order
-- Run this in Supabase SQL Editor to set up test data for refund testing

-- Variables (update these if needed)
DO $$
DECLARE
    v_org_id UUID := '0945e0c4-9b40-4ecf-acc4-3324751bea44';  -- Your org ID
    v_event_id UUID := '75cd6d6d-6d99-460a-b2f6-4f4aff20ab84';  -- Marathon 26
    v_ticket_type_id UUID := 'ad15cda9-f50d-4575-90bb-58c2c6e2d698';  -- Early Bird €40
    v_order_id UUID;
    v_payment_id UUID;
    v_participant_id UUID;
    v_ticket_id UUID;
BEGIN
    -- 1. Create participant
    INSERT INTO participants (org_id, email, first_name, last_name)
    VALUES (v_org_id, 'refund-test@coloss.nl', 'Refund', 'Test')
    RETURNING id INTO v_participant_id;

    RAISE NOTICE 'Created participant: %', v_participant_id;

    -- 2. Create order
    INSERT INTO orders (
        org_id, event_id, email, status, total_amount,
        currency, token_hash, purchaser_name
    )
    VALUES (
        v_org_id, v_event_id, 'refund-test@coloss.nl', 'paid', 40.00,
        'EUR', encode(sha256('test-token-refund-123'::bytea), 'hex'), 'Refund Test'
    )
    RETURNING id INTO v_order_id;

    RAISE NOTICE 'Created order: %', v_order_id;

    -- 3. Create order item
    INSERT INTO order_items (order_id, ticket_type_id, quantity, unit_price, subtotal)
    VALUES (v_order_id, v_ticket_type_id, 1, 40.00, 40.00);

    -- 4. Create payment record with Mollie test payment ID
    INSERT INTO payments (
        order_id, provider, provider_payment_id, amount, currency, status
    )
    VALUES (
        v_order_id, 'mollie', 'tr_test_refund_' || substr(v_order_id::text, 1, 8),
        40.00, 'EUR', 'paid'
    )
    RETURNING id INTO v_payment_id;

    RAISE NOTICE 'Created payment: %', v_payment_id;

    -- 5. Create ticket instance
    INSERT INTO ticket_instances (
        org_id, event_id, order_id, ticket_type_id, participant_id,
        status, token_hash
    )
    VALUES (
        v_org_id, v_event_id, v_order_id, v_ticket_type_id, v_participant_id,
        'valid', encode(sha256(('ticket-' || v_order_id::text)::bytea), 'hex')
    )
    RETURNING id INTO v_ticket_id;

    RAISE NOTICE 'Created ticket: %', v_ticket_id;

    -- Summary
    RAISE NOTICE '';
    RAISE NOTICE '=== Test Order Created Successfully ===';
    RAISE NOTICE 'Order ID: %', v_order_id;
    RAISE NOTICE 'Payment ID: %', v_payment_id;
    RAISE NOTICE 'Ticket ID: %', v_ticket_id;
    RAISE NOTICE '';
    RAISE NOTICE 'Use this order_id to test refunds!';
END$$;

-- Verify the test order
SELECT
    o.id as order_id,
    o.email,
    o.total_amount,
    o.status as order_status,
    p.provider_payment_id,
    p.status as payment_status,
    t.id as ticket_id,
    t.status as ticket_status
FROM orders o
JOIN payments p ON p.order_id = o.id
LEFT JOIN ticket_instances t ON t.order_id = o.id
WHERE o.email = 'refund-test@coloss.nl'
ORDER BY o.created_at DESC
LIMIT 1;
