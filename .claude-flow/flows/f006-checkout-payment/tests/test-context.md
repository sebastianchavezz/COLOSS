# F006 Test Context

> @supabase-tester MUST read this before testing F006.
> Also read: `.claude-flow/memory/db-architecture.md` for connection details.

---

## Dependencies

| Flow | Must Work First | Why |
|------|-----------------|-----|
| F003 | Event Creation | Orders need events |
| F005 | Ticket Selection | Orders need ticket_types |

**Note**: F001/F002 (User Auth) are NOT required - F006 supports guest checkout.

---

## Relevant Tables

| Table | Role in F006 | Key Columns |
|-------|--------------|-------------|
| `orders` | Main checkout entity | event_id, email, status, total_amount, public_token |
| `order_items` | Ticket selections | order_id, ticket_type_id, quantity, unit_price |
| `payments` | Payment records | order_id, provider, provider_payment_id, status |
| `payment_events` | Webhook deduplication | provider_event_id (unique) |
| `ticket_types` | Capacity & pricing | capacity_total, sales_start, sales_end, price |
| `ticket_instances` | Issued tickets | order_id, token_hash, qr_code, status |
| `registrations` | Created by trigger | event_id, participant_id, order_item_id |
| `participants` | Created by trigger | email, user_id (nullable) |

---

## RLS Policies to Test

### orders

| Policy | Who | Can |
|--------|-----|-----|
| Users can view own orders | auth.uid() = user_id | SELECT |
| Org members can view event orders | is_org_member(org_id) | SELECT |
| Public can create orders | anyone | INSERT |
| Public can view by token | token matches | SELECT |

### ticket_instances

| Policy | Who | Can |
|--------|-----|-----|
| Owner can view | auth.uid() = owner_user_id | SELECT |
| Org members can view | is_org_member via event | SELECT |

### Test Scenarios

```sql
-- 1. User A can see own orders
SET LOCAL role TO 'authenticated';
SET LOCAL request.jwt.claims TO '{"sub": "user-a-uuid"}';
SELECT * FROM orders WHERE user_id = 'user-a-uuid'; -- Should return rows

-- 2. User A CANNOT see User B's orders
SELECT * FROM orders WHERE user_id = 'user-b-uuid'; -- Should return 0 rows

-- 3. Anon can view order by public_token
SET LOCAL role TO 'anon';
SELECT * FROM orders WHERE public_token = 'token123'; -- Should work
```

---

## Edge Cases

| Case | Expected Behavior | Test |
|------|-------------------|------|
| Sold out | validate_checkout_capacity returns `valid: false, available: 0` | TEST 6 |
| Sales not started | validate_checkout_capacity returns `valid: false, ...not started...` | TEST 3 |
| Sales ended | validate_checkout_capacity returns `valid: false, ...ended...` | TEST 4 |
| Quantity = 0 | validate_checkout_capacity returns `error: INVALID_QUANTITY` | TEST 2 |
| Payment failed | Order status → 'failed', no tickets created | TEST 8 |
| Payment expired | Order status → 'failed' | via TEST 8 |
| Duplicate webhook | Idempotent, no duplicate tickets | TEST 7 |
| Overbooked (race) | Order cancelled, refund flagged | TEST 9 |
| Guest checkout | Works without user_id | TEST 6 |

---

## Test Users Needed

| User | Purpose | Auth |
|------|---------|------|
| None | Guest checkout | anon |
| Org Admin | Manage orders | authenticated + org_member |
| Event Staff | Check-in only | authenticated + org_member (support) |

### Create Test User (if needed)

```sql
-- Create auth user for testing
INSERT INTO auth.users (id, email)
VALUES ('aaa00000-0000-0000-0000-000000000005', 'testuser@example.com');

-- Make them org member
INSERT INTO org_members (org_id, user_id, role)
VALUES ('org-uuid', 'aaa00000-0000-0000-0000-000000000005', 'admin');
```

---

## Test Fixtures

```sql
-- 1. Create test org
INSERT INTO orgs (id, name, slug)
VALUES (gen_random_uuid(), 'F006 Test Org', 'f006-test-org')
RETURNING id INTO v_test_org_id;

-- 2. Create test event
INSERT INTO events (id, org_id, slug, name, status, start_time)
VALUES (gen_random_uuid(), v_test_org_id, 'f006-test-event', 'F006 Test Event', 'published', NOW() + INTERVAL '7 days')
RETURNING id INTO v_test_event_id;

-- 3. Create ticket types
INSERT INTO ticket_types (id, event_id, name, price, capacity_total, sales_start, sales_end)
VALUES
  (gen_random_uuid(), v_test_event_id, 'Regular', 25.00, 10, NOW() - INTERVAL '1 hour', NOW() + INTERVAL '7 days'),
  (gen_random_uuid(), v_test_event_id, 'VIP', 100.00, 1, NOW() - INTERVAL '1 hour', NOW() + INTERVAL '7 days');
```

---

## Cleanup (IMPORTANT)

```sql
-- Delete in correct order (FK constraints)
DELETE FROM ticket_instances WHERE event_id = v_test_event_id;
DELETE FROM registrations WHERE event_id = v_test_event_id;
DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE event_id = v_test_event_id);
DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE event_id = v_test_event_id);
DELETE FROM payment_events WHERE provider_payment_id LIKE 'f006_test_%';
DELETE FROM orders WHERE event_id = v_test_event_id;
DELETE FROM ticket_types WHERE event_id = v_test_event_id;
DELETE FROM events WHERE id = v_test_event_id;
DELETE FROM participants WHERE email LIKE '%@example.com';
DELETE FROM audit_log WHERE org_id = v_test_org_id;
DELETE FROM orgs WHERE id = v_test_org_id;
```

---

## Run Tests

```bash
# SQL verification tests
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -f .claude-flow/flows/f006-checkout-payment/tests/sql-verification.sql
```

---

*Last updated: 2025-01-28*
