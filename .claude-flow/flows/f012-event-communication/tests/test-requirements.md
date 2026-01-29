# F012: Test Requirements for @supabase-tester

## Test Philosophy

Every RLS policy must be tested from both sides: the user who SHOULD have access
and the user who MUST NOT. Every trigger must be verified for correctness.
Every constraint must be tested with both valid and invalid input.

---

## 1. Schema Verification Tests (SQL)

Run against the database after migration to confirm structure:

```sql
-- 1.1 Verify all tables exist with correct columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('chat_threads', 'chat_messages', 'chat_thread_reads', 'faq_items')
ORDER BY table_name, ordinal_position;

-- 1.2 Verify RLS is enabled
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN ('chat_threads', 'chat_messages', 'chat_thread_reads', 'faq_items');

-- 1.3 Verify unique constraints
SELECT conname, contype
FROM pg_constraint
WHERE conname IN (
    'chat_threads_unique_scope',
    'chat_threads_unread_non_negative',
    'chat_messages_content_length',
    'chat_messages_content_not_empty',
    'chat_thread_reads_unique',
    'faq_items_title_not_empty'
);

-- 1.4 Verify indexes exist
SELECT indexname
FROM pg_indexes
WHERE tablename IN ('chat_threads', 'chat_messages', 'chat_thread_reads', 'faq_items');

-- 1.5 Verify helper functions exist
SELECT proname, provolatile
FROM pg_proc
WHERE proname IN (
    'get_or_create_chat_thread',
    'mark_chat_thread_read',
    'check_participant_event_access',
    'get_messaging_settings',
    'count_recent_participant_messages',
    'validate_messaging_settings'
);
```

---

## 2. RLS Policy Tests

### 2.1 chat_threads

**Test Setup**: Create org, event, two participants (one registered, one not), one org member with support role.

| Test | User Role | Action | Expected |
|------|-----------|--------|----------|
| T-CT-01 | Registered participant | SELECT own thread | ALLOWED |
| T-CT-02 | Unregistered participant | SELECT other's thread | DENIED |
| T-CT-03 | Organizer (support) | SELECT all threads for org's event | ALLOWED |
| T-CT-04 | Organizer (finance) | SELECT threads | DENIED |
| T-CT-05 | Registered participant | INSERT thread (has registration) | ALLOWED |
| T-CT-06 | Unregistered participant | INSERT thread (no registration) | DENIED |
| T-CT-07 | Participant with ticket_instance | INSERT thread | ALLOWED |
| T-CT-08 | Organizer (admin) | UPDATE thread status | ALLOWED |
| T-CT-09 | Participant | UPDATE thread status | DENIED |
| T-CT-10 | Anyone | DELETE thread | DENIED |
| T-CT-11 | Different org member | SELECT thread from other org | DENIED |

### 2.2 chat_messages

| Test | User Role | Action | Expected |
|------|-----------|--------|----------|
| T-CM-01 | Participant (thread owner) | SELECT messages in own thread | ALLOWED |
| T-CM-02 | Participant (not owner) | SELECT messages in other's thread | DENIED |
| T-CM-03 | Organizer (support) | SELECT all messages in org threads | ALLOWED |
| T-CM-04 | Participant (thread owner) | INSERT message (thread open) | ALLOWED |
| T-CM-05 | Participant (thread owner) | INSERT message (thread closed) | DENIED |
| T-CM-06 | Organizer (admin) | INSERT message in org thread | ALLOWED |
| T-CM-07 | Random user | INSERT message | DENIED |
| T-CM-08 | Anyone | UPDATE any message | DENIED |
| T-CM-09 | Anyone | DELETE any message | DENIED |

### 2.3 chat_thread_reads

| Test | User Role | Action | Expected |
|------|-----------|--------|----------|
| T-CTR-01 | Organizer | SELECT read receipts for org thread | ALLOWED |
| T-CTR-02 | Participant | SELECT read receipts | DENIED |
| T-CTR-03 | Organizer | INSERT own read receipt | ALLOWED |
| T-CTR-04 | User | INSERT receipt for someone else | DENIED |

### 2.4 faq_items

| Test | User Role | Action | Expected |
|------|-----------|--------|----------|
| T-FAQ-01 | Anonymous | SELECT published FAQ for published event | ALLOWED |
| T-FAQ-02 | Anonymous | SELECT draft FAQ | DENIED |
| T-FAQ-03 | Anonymous | SELECT published FAQ for draft event | DENIED |
| T-FAQ-04 | Organizer (admin) | SELECT draft FAQ | ALLOWED |
| T-FAQ-05 | Organizer (owner) | INSERT FAQ item | ALLOWED |
| T-FAQ-06 | Organizer (support) | INSERT FAQ item | DENIED |
| T-FAQ-07 | Organizer (admin) | UPDATE FAQ item | ALLOWED |
| T-FAQ-08 | Organizer (admin) | DELETE FAQ item | ALLOWED |
| T-FAQ-09 | Anonymous | INSERT FAQ item | DENIED |
| T-FAQ-10 | Organizer from different org | SELECT org's FAQs | DENIED |
| T-FAQ-11 | Anonymous | SELECT org-wide published FAQ | ALLOWED (if org has published event) |

---

## 3. Constraint Tests

| Test | Table | Constraint | Input | Expected |
|------|-------|------------|-------|----------|
| T-CON-01 | chat_messages | content_length | 2001 chars | REJECTED |
| T-CON-02 | chat_messages | content_length | 2000 chars | ACCEPTED |
| T-CON-03 | chat_messages | content_not_empty | '' (empty) | REJECTED |
| T-CON-04 | chat_messages | content_not_empty | '   ' (whitespace) | REJECTED |
| T-CON-05 | chat_messages | content_not_empty | 'Hello' | ACCEPTED |
| T-CON-06 | chat_threads | unread_non_negative | unread_count = -1 | REJECTED |
| T-CON-07 | chat_threads | unique_scope | duplicate (org,event,participant) | REJECTED |
| T-CON-08 | faq_items | title_not_empty | '' | REJECTED |
| T-CON-09 | faq_items | title_not_empty | '  ' (whitespace) | REJECTED |

---

## 4. Trigger Tests

### 4.1 on_chat_message_inserted

| Test | Scenario | Expected Effect |
|------|----------|-----------------|
| T-TRG-01 | Participant sends message to open thread | unread_count +1, status -> 'pending', last_message_at updated |
| T-TRG-02 | Organizer replies to pending thread | unread_count unchanged, status -> 'open', last_message_at updated |
| T-TRG-03 | Participant messages closed thread | unread_count +1, status -> 'open' (reopened), last_message_at updated |
| T-TRG-04 | Organizer messages open thread | unread_count unchanged, status unchanged, last_message_at updated |

### 4.2 audit_chat_thread_status

| Test | Scenario | Expected Effect |
|------|----------|-----------------|
| T-AUD-01 | Status changes from open to closed | audit_log entry with THREAD_STATUS_CHANGED action |
| T-AUD-02 | Status updated to same value | NO audit_log entry (OLD.status = NEW.status check) |

---

## 5. Helper Function Tests

### 5.1 get_or_create_chat_thread

| Test | Scenario | Expected |
|------|----------|----------|
| T-HF-01 | Call for new participant/event combo | Creates thread, returns new UUID |
| T-HF-02 | Call again for same participant/event | Returns same UUID (idempotent) |
| T-HF-03 | Call with non-existent event_id | RAISES EXCEPTION |

### 5.2 check_participant_event_access

| Test | Scenario | Expected |
|------|----------|----------|
| T-HF-04 | Participant with confirmed registration | Returns TRUE |
| T-HF-05 | Participant with cancelled registration only | Returns FALSE |
| T-HF-06 | Participant with issued ticket_instance | Returns TRUE |
| T-HF-07 | Participant with voided ticket only | Returns FALSE |
| T-HF-08 | Participant with no registration or ticket | Returns FALSE |

### 5.3 get_messaging_settings

| Test | Scenario | Expected |
|------|----------|----------|
| T-HF-09 | No org or event settings set | Returns system defaults |
| T-HF-10 | Org setting overrides default | Org value wins |
| T-HF-11 | Event setting overrides org | Event value wins |
| T-HF-12 | Non-existent event_id | RAISES EXCEPTION |

### 5.4 validate_messaging_settings

| Test | Input | Expected |
|------|-------|----------|
| T-HF-13 | Valid full settings object | Returns TRUE |
| T-HF-14 | msgs_per_minute = 0 (below range) | RAISES EXCEPTION |
| T-HF-15 | msgs_per_minute = 61 (above range) | RAISES EXCEPTION |
| T-HF-16 | max_message_length = 10001 | RAISES EXCEPTION |
| T-HF-17 | retention_days = 5 (below 7) | RAISES EXCEPTION |
| T-HF-18 | notifications not an object | RAISES EXCEPTION |

### 5.5 count_recent_participant_messages

| Test | Scenario | Expected |
|------|----------|----------|
| T-HF-19 | 3 messages in last 60 seconds | Returns 3 |
| T-HF-20 | 2 messages in last 60s, 1 older | Returns 2 |
| T-HF-21 | No messages | Returns 0 |
| T-HF-22 | Organizer messages excluded | Only counts participant messages |

---

## 6. Cross-Cut / Integration Tests

| Test | Scenario | Expected |
|------|----------|----------|
| T-INT-01 | Full flow: create thread -> send message -> read thread -> verify unread = 0 | All steps succeed, counters correct |
| T-INT-02 | Rate limit flow: send 5 messages (default limit) -> 6th message rejected | Edge Function returns RATE_LIMITED |
| T-INT-03 | FAQ lifecycle: create (draft) -> update (published) -> verify public visibility | Draft invisible to anon, published visible |
| T-INT-04 | Cross-org isolation: org A thread not visible to org B organizer | SELECT returns empty / DENIED |
| T-INT-05 | Thread auto-reopen: close thread -> participant sends message -> thread is open again | Trigger correctly transitions status |

---

## 7. Performance Considerations

- Verify that `idx_chat_threads_event_status` is used by `EXPLAIN` for thread listing queries
- Verify that `idx_faq_items_search` is used by full-text search queries
- Test with 1000+ messages in a thread to confirm pagination works correctly

