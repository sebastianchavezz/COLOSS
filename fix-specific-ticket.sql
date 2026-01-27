-- ===========================================================================
-- Direct fix voor jouw specifieke ticket
-- ===========================================================================

-- Check current state
SELECT
  id,
  qr_code,
  token_hash,
  status,
  event_id
FROM ticket_instances
WHERE id = 'b7b51a1f-05e7-41de-9e96-7bfdae379eac';

-- Fix the token_hash
UPDATE ticket_instances
SET token_hash = encode(
  extensions.digest('e0429746a36a4d648656b8aba63c3264'::bytea, 'sha256'::text),
  'hex'
)
WHERE id = 'b7b51a1f-05e7-41de-9e96-7bfdae379eac'
RETURNING
  id,
  qr_code,
  token_hash,
  'FIXED' as status_message;

-- Verify the hash matches
DO $$
DECLARE
  v_expected_hash TEXT;
  v_actual_hash TEXT;
BEGIN
  -- Calculate expected hash
  v_expected_hash := encode(
    extensions.digest('e0429746a36a4d648656b8aba63c3264'::bytea, 'sha256'::text),
    'hex'
  );

  -- Get actual hash from ticket
  SELECT token_hash INTO v_actual_hash
  FROM ticket_instances
  WHERE id = 'b7b51a1f-05e7-41de-9e96-7bfdae379eac';

  IF v_expected_hash = v_actual_hash THEN
    RAISE NOTICE '✓ Ticket hash is correct!';
    RAISE NOTICE '  Token: e0429746a36a4d648656b8aba63c3264';
    RAISE NOTICE '  Hash:  %', v_actual_hash;
  ELSE
    RAISE WARNING 'Hash mismatch!';
    RAISE WARNING '  Expected: %', v_expected_hash;
    RAISE WARNING '  Actual:   %', v_actual_hash;
  END IF;
END $$;

-- Test if scan_ticket can find it now
SELECT scan_ticket(
  '75cd6d6d-6d99-460a-b2f6-4f4aff20ab84'::uuid,  -- event_id
  'e0429746a36a4d648656b8aba63c3264',             -- token
  'test-device',
  NULL::inet,
  'Manual Test'
) as scan_result;
