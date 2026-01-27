-- ===========================================================================
-- F007 Manual Test: Create test ticket and scan it
-- ===========================================================================

-- Step 1: Find an event (or use existing event_id)
SELECT id, name, org_id FROM events LIMIT 5;

-- Step 2: Find a ticket type for that event
SELECT id, name, event_id FROM ticket_types WHERE event_id = 'YOUR_EVENT_ID_HERE' LIMIT 5;

-- Step 3: Find or create an order
SELECT id, email, status FROM orders WHERE event_id = 'YOUR_EVENT_ID_HERE' LIMIT 5;

-- Step 4: Create a test ticket instance with token
-- Replace YOUR_EVENT_ID, YOUR_TICKET_TYPE_ID, YOUR_ORDER_ID

DO $$
DECLARE
  v_event_id UUID := 'YOUR_EVENT_ID_HERE';
  v_ticket_type_id UUID := 'YOUR_TICKET_TYPE_ID_HERE';
  v_order_id UUID := 'YOUR_ORDER_ID_HERE';
  v_token TEXT := 'TEST-TOKEN-' || gen_random_uuid()::text;
  v_token_hash TEXT;
  v_ticket_id UUID;
BEGIN
  -- Hash the token
  v_token_hash := encode(digest(v_token, 'sha256'), 'hex');

  -- Insert ticket instance
  INSERT INTO ticket_instances (
    event_id,
    ticket_type_id,
    order_id,
    qr_code,
    token_hash,
    status
  ) VALUES (
    v_event_id,
    v_ticket_type_id,
    v_order_id,
    v_token,  -- QR code (for display)
    v_token_hash,
    'issued'
  ) RETURNING id INTO v_ticket_id;

  RAISE NOTICE 'Created ticket: %', v_ticket_id;
  RAISE NOTICE 'Token (use this to scan): %', v_token;
  RAISE NOTICE 'Token hash: %', v_token_hash;
END $$;

-- Step 5: Now you can test scanning via RPC
-- Replace YOUR_EVENT_ID and YOUR_TOKEN from output above

SELECT scan_ticket(
  'YOUR_EVENT_ID_HERE'::uuid,
  'YOUR_TOKEN_HERE',  -- Use the token from RAISE NOTICE above
  'test-device-123',
  '127.0.0.1'::inet,
  'Mozilla/5.0 Test'
);

-- Expected result: {"result": "VALID", "ticket": {...}}

-- Step 6: Scan again (should be ALREADY_USED)
SELECT scan_ticket(
  'YOUR_EVENT_ID_HERE'::uuid,
  'YOUR_TOKEN_HERE',
  'test-device-123',
  '127.0.0.1'::inet,
  'Mozilla/5.0 Test'
);

-- Expected result: {"result": "ALREADY_USED", ...}

-- Step 7: Check audit log
SELECT
  id,
  scan_result,
  scanned_at,
  device_id,
  scanner_user_id
FROM ticket_scans
WHERE event_id = 'YOUR_EVENT_ID_HERE'
ORDER BY scanned_at DESC
LIMIT 10;

-- Step 8: Check scan stats
SELECT get_scan_stats('YOUR_EVENT_ID_HERE'::uuid);

-- Step 9: Test undo (if you're admin and allow_undo_checkin is enabled)
-- SELECT undo_check_in('YOUR_TICKET_ID_HERE'::uuid, 'Testing undo');
