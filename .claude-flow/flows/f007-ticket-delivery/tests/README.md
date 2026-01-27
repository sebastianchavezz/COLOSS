# F007 Ticket Scanning - Tests

Tests voor Sprint S1: Professional Ticket Scanning

## Test Files

### 1. Integration Tests (`integration-tests.mjs`)

Automated tests die de scanning infrastructure verificeren.

**Run:**
```bash
node .claude-flow/flows/f007-ticket-delivery/tests/integration-tests.mjs
```

**With authentication:**
```bash
TEST_USER_EMAIL=your@email.com TEST_USER_PASSWORD=yourpass \
  node .claude-flow/flows/f007-ticket-delivery/tests/integration-tests.mjs
```

**What it tests:**
- ✅ Table structure (ticket_scans exists)
- ✅ RPC functions exist (scan_ticket, undo_check_in, get_scan_stats, get_recent_scans)
- ✅ Settings domain (scanning.* settings)
- ✅ Helper functions (mask_participant_name, mask_email)
- ✅ Anonymous access (expect UNAUTHORIZED)
- ✅ Authenticated scanning (with test credentials)

**Last run:** 2025-01-27 ✅ 11 passed

---

### 2. Manual Test Guide (`manual-test.sql`)

Step-by-step SQL guide voor end-to-end testing met echte tickets.

**Run:**
1. Open Supabase SQL Editor
2. Copy-paste de queries uit `manual-test.sql`
3. Vervang placeholders (YOUR_EVENT_ID_HERE, etc.)

**Test flow:**
1. Find event + ticket type
2. Create order
3. Insert ticket_instance with token
4. Scan ticket (first time → VALID)
5. Scan again (second time → ALREADY_USED)
6. Check audit log (ticket_scans)
7. Check statistics (get_scan_stats)
8. Test undo (admin only)

**Expected results:**
```json
// First scan
{"result": "VALID", "ticket": {...}}

// Second scan (idempotent)
{"result": "ALREADY_USED", "ticket": {...}}
```

---

## Test Coverage

| Scenario | Integration | Manual | Status |
|----------|-------------|--------|--------|
| Table exists | ✅ | - | Pass |
| RPC functions exist | ✅ | - | Pass |
| Settings domain | ✅ | - | Pass |
| PII masking | ✅ | - | Pass |
| Anonymous access | ✅ | - | Pass |
| Valid scan | - | ✅ | Manual |
| Invalid token | - | ✅ | Manual |
| Duplicate scan (idempotent) | - | ✅ | Manual |
| Rate limiting | - | ✅ | Manual |
| Cross-event scan | - | ✅ | Manual |
| Undo check-in | - | ✅ | Manual |
| Audit trail | - | ✅ | Manual |

---

## Running All Tests

```bash
# 1. Integration tests (automated)
node .claude-flow/flows/f007-ticket-delivery/tests/integration-tests.mjs

# 2. Manual tests (SQL + UI)
# - Follow manual-test.sql in Supabase SQL Editor
# - Test scanning in ScanPage UI (/org/demo/events/{slug}/scan)
```

---

## Test Data Cleanup

After manual testing:
```sql
-- Clean up test scans
DELETE FROM ticket_scans WHERE device_id = 'test-device-123';

-- Clean up test tickets
DELETE FROM ticket_instances WHERE qr_code LIKE 'TEST-TOKEN-%';
```

---

*Last updated: 2025-01-27 (Sprint S1)*
