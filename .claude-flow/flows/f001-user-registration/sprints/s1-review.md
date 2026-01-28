# F001 Sprint S1: Code Review

## Metadata

| Field | Value |
|-------|-------|
| **Flow** | F001 - User Registration |
| **Sprint** | S1 |
| **Author** | @reviewer |
| **Date** | 2026-01-28 |
| **Status** | ✅ APPROVED |

---

## Review Summary

| Category | Status | Notes |
|----------|--------|-------|
| Schema Changes | ✅ | Clean ALTER with IF NOT EXISTS |
| RLS/Security | ✅ | SECURITY DEFINER with proper grants |
| Idempotency | ✅ | ON CONFLICT + unique constraints |
| Error Handling | ✅ | Proper NOT FOUND checks |
| Performance | ✅ | Indexes added |
| Audit Trail | ✅ | Audit log entries created |

---

## Detailed Findings

### 1. Schema Changes

**ticket_instances.participant_id**
- ✅ Uses `IF NOT EXISTS` for idempotency
- ✅ Proper FK reference to participants
- ✅ `ON DELETE SET NULL` is correct (don't delete ticket if participant is deleted)
- ✅ Index created with WHERE clause for partial index

### 2. Trigger: sync_registration_on_order_paid

**Strengths:**
- ✅ Only fires on `status = 'paid' AND OLD.status != 'paid'` (prevents double fire)
- ✅ Uses ON CONFLICT for participant upsert
- ✅ Uses ON CONFLICT for registration upsert
- ✅ Uses ON CONFLICT for outbox (idempotency_key)
- ✅ Ticket linking with `WHERE participant_id IS NULL` prevents overwrite

**Minor Observations:**
- The trigger updates `ticket_instances` based on `ticket_type_id`, which may link ALL tickets of that type, not just specific order_item tickets. However, since `order_id` is also in the WHERE, this is correctly scoped.

### 3. RPC: sync_registration_on_payment

**Strengths:**
- ✅ SECURITY DEFINER with explicit search_path
- ✅ Checks order exists and status = 'paid'
- ✅ Returns 'ALREADY_SYNCED' on idempotent call
- ✅ Proper grants to authenticated and service_role

**Security Check:**
- No direct user input is used in SQL (all via parameterized queries)
- No SQL injection risk

### 4. Outbox Integration

- ✅ Uses `idempotency_key = 'order_confirmation_' || order_id`
- ✅ ON CONFLICT DO NOTHING prevents duplicates
- ✅ Priority set to 'high' for transactional emails

### 5. Audit Trail

- ✅ REGISTRATION_CREATED_FROM_ORDER action logged
- ✅ REGISTRATION_SYNCED action logged for manual calls
- ✅ Metadata includes order_id, participant_id, tickets_linked

---

## Potential Improvements (Non-blocking)

1. **Consider adding `ON CONFLICT DO UPDATE` for ticket linking**
   - Current: Only links tickets where `participant_id IS NULL`
   - This is fine for normal flow but won't "fix" tickets if re-sync is needed

2. **Add monitoring metric**
   - Could emit a metric/event when sync happens for observability

---

## Verdict

**APPROVED** - Ready for deployment.

All acceptance criteria met:
- [x] Post-purchase participant upsert ✅
- [x] Registration creation with idempotency ✅
- [x] Ticket linking ✅
- [x] Outbox event for confirmation email ✅
- [x] Audit trail ✅

---

*Code Review - F001 User Registration*
