# {Flow ID} - {Flow Name} Tests

Tests voor {Sprint/Feature description}

## Test Files

### 1. Integration Tests (`integration-tests.mjs`)

Automated tests die de {feature} infrastructure verificeren.

**Run:**
```bash
node .claude-flow/flows/{flow-id}/tests/integration-tests.mjs
```

**With authentication:**
```bash
TEST_USER_EMAIL=your@email.com TEST_USER_PASSWORD=yourpass \
  node .claude-flow/flows/{flow-id}/tests/integration-tests.mjs
```

**What it tests:**
- ✅ {List key test scenarios}
- ✅ {More scenarios}

**Last run:** {Date} ✅ {X} passed

---

### 2. Manual Test Guide (`manual-test.sql`)

Step-by-step SQL guide voor end-to-end testing met echte data.

**Run:**
1. Open Supabase SQL Editor
2. Copy-paste de queries uit `manual-test.sql`
3. Vervang placeholders (YOUR_EVENT_ID_HERE, etc.)

**Test flow:**
1. {Step 1}
2. {Step 2}
3. {Step 3}

**Expected results:**
```json
// {Expected output}
```

---

## Test Coverage

| Scenario | Integration | Manual | Status |
|----------|-------------|--------|--------|
| {Scenario 1} | ✅ | - | Pass |
| {Scenario 2} | - | ✅ | Manual |

---

## Running All Tests

```bash
# 1. Integration tests (automated)
node .claude-flow/flows/{flow-id}/tests/integration-tests.mjs

# 2. Manual tests (SQL + UI)
# - Follow manual-test.sql in Supabase SQL Editor
# - Test in UI at {URL}
```

---

## Test Data Cleanup

After manual testing:
```sql
-- Clean up test data
DELETE FROM {table} WHERE {condition};
```

---

*Last updated: {Date}*
