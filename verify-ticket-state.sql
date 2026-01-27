-- ===========================================================================
-- Verificatie: Wat is de huidige staat van het ticket?
-- ===========================================================================

-- 1. Check ticket details
SELECT
  'TICKET DETAILS' as section,
  id,
  qr_code,
  token_hash,
  status,
  event_id,
  ticket_type_id,
  order_id,
  created_at
FROM ticket_instances
WHERE id = 'b7b51a1f-05e7-41de-9e96-7bfdae379eac';

-- 2. Check event exists
SELECT
  'EVENT DETAILS' as section,
  id,
  name,
  org_id,
  status
FROM events
WHERE id = '75cd6d6d-6d99-460a-b2f6-4f4aff20ab84';

-- 3. Check order exists (for participant info)
SELECT
  'ORDER DETAILS' as section,
  o.id,
  o.customer_name,
  o.email,
  o.status
FROM orders o
WHERE o.id = (
  SELECT order_id FROM ticket_instances
  WHERE id = 'b7b51a1f-05e7-41de-9e96-7bfdae379eac'
);

-- 4. Calculate expected hash
SELECT
  'HASH CALCULATION' as section,
  'e0429746a36a4d648656b8aba63c3264' as plaintext_token,
  encode(
    extensions.digest('e0429746a36a4d648656b8aba63c3264'::bytea, 'sha256'::text),
    'hex'
  ) as expected_hash;

-- 5. Check if ticket has been scanned before
SELECT
  'SCAN HISTORY' as section,
  ts.id,
  ts.scan_result,
  ts.reason_code,
  ts.scanned_at,
  ts.scanner_user_id
FROM ticket_scans ts
WHERE ts.ticket_id = 'b7b51a1f-05e7-41de-9e96-7bfdae379eac'
ORDER BY ts.scanned_at DESC
LIMIT 10;

-- 6. Check org membership of current user
SELECT
  'ORG MEMBERSHIP' as section,
  om.org_id,
  om.user_id,
  om.role
FROM org_members om
WHERE om.user_id = auth.uid()
  AND om.org_id = (
    SELECT org_id FROM events WHERE id = '75cd6d6d-6d99-460a-b2f6-4f4aff20ab84'
  );

-- 7. Check scanning settings
SELECT
  'SCANNING SETTINGS' as section,
  es.domain,
  es.setting_value
FROM event_settings es
WHERE es.event_id = '75cd6d6d-6d99-460a-b2f6-4f4aff20ab84'
  AND es.domain = 'scanning';
