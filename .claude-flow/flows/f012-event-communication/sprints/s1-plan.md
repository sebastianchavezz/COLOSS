# Sprint S1: F012 - Database Schema + RLS + Edge Functions

## Metadata

| Field | Value |
|-------|-------|
| **Flow** | F012 - Event Communication |
| **Sprint** | S1 - Backend Infrastructure |
| **Phase** | Planning |
| **Created** | 2026-01-28 |
| **Author** | @pm |

---

## Sprint Goal

Deliver a production-ready backend for 1:1 participant-organizer messaging and FAQ management: database schema with full RLS enforcement, rate limiting, GDPR retention, audit logging, and all Edge Functions.

---

## Success Criteria

- [ ] `conversation_threads` table created with correct schema and constraints
- [ ] `conversation_messages` table created with correct schema and constraints
- [ ] `faq_items` table created with correct schema and constraints
- [ ] RLS policies enforce: participant sees only own thread, organizer sees all threads for their events, FAQ public read for published items
- [ ] Edge Functions: send-message, get-thread, list-threads, update-thread-status deployed and functional
- [ ] Edge Functions: create-faq-item, update-faq-item, delete-faq-item, get-event-faqs deployed and functional
- [ ] Rate limiting enforced (messages_per_minute configurable via settings)
- [ ] Max message length enforced via CHECK constraint
- [ ] Participant eligibility validated (valid registration OR valid ticket_instance)
- [ ] Audit log entries written for all critical actions
- [ ] Settings domain extended with messaging.* and faq.* keys
- [ ] GDPR retention policy placeholder (configurable retention_days, cleanup function stub)
- [ ] All RLS policies tested: cross-tenant isolation verified

---

## Tasks

### Task 1.1: Database Migration - conversation_threads
- **Agent**: @backend
- **Priority**: P0 (must)
- **Size**: M
- **Acceptance Criteria**:
  - Table exists with columns: id, org_id, event_id, participant_id, status (open/closed), unread_count_participant, unread_count_organizer, created_at, updated_at
  - UNIQUE constraint on (org_id, event_id, participant_id) -- one thread per participant per event
  - FK to orgs, events, participants (all RESTRICT on delete)
  - RLS enabled with policies defined in section 3
  - Index on (event_id, status) for organizer thread list queries
  - Index on (participant_id, event_id) for participant lookup

### Task 1.2: Database Migration - conversation_messages
- **Agent**: @backend
- **Priority**: P0 (must)
- **Size**: M
- **Acceptance Criteria**:
  - Table exists with columns: id, thread_id, sender_type (participant/organizer), sender_user_id, content (text, NOT NULL), content_length (computed, for quick filtering), is_flagged (boolean default false, profanity hook placeholder), created_at
  - FK to conversation_threads (CASCADE on delete for retention cleanup)
  - CHECK constraint: char_length(content) <= 2000
  - CHECK constraint: char_length(content) >= 1
  - RLS enabled with policies: participant reads only own thread messages, organizer reads messages from their event threads
  - Index on (thread_id, created_at DESC) for message history pagination

### Task 1.3: Database Migration - faq_items
- **Agent**: @backend
- **Priority**: P0 (must)
- **Size**: M
- **Acceptance Criteria**:
  - Table exists with columns: id, org_id, event_id, title, content (markdown text), category (nullable text), status (draft/published), sort_order (integer default 0), created_by (auth.users), created_at, updated_at
  - FK to orgs (CASCADE), events (CASCADE), auth.users (SET NULL)
  - UNIQUE constraint on (event_id, title) -- no duplicate titles per event
  - CHECK constraint: status IN ('draft', 'published')
  - RLS: org members (owner/admin) can CRUD, public can SELECT WHERE status = 'published'
  - Index on (event_id, status, sort_order) for public listing
  - Index on (event_id, category) for category filtering

### Task 1.4: RLS Policies - All Three Tables
- **Agent**: @backend
- **Priority**: P0 (must)
- **Size**: M
- **Acceptance Criteria**:
  - conversation_threads:
    - SELECT: participant (via participants.user_id = auth.uid() AND matching participant_id) OR org_member(org_id) with role IN (owner, admin, support)
    - INSERT: service_role only (via Edge Function RPC)
    - UPDATE (status): org_member with role IN (owner, admin, support) only
    - UPDATE (unread counters): service_role only (via Edge Function)
    - DELETE: service_role only (retention cleanup)
  - conversation_messages:
    - SELECT: participant sees own thread messages OR org_member sees messages in their event threads
    - INSERT: service_role only (via Edge Function RPC)
    - DELETE: service_role only (retention cleanup)
  - faq_items:
    - SELECT: org_member(org_id) for all items OR public for status = 'published'
    - INSERT: org_member with role IN (owner, admin)
    - UPDATE: org_member with role IN (owner, admin)
    - DELETE: org_member with role IN (owner, admin)

### Task 1.5: Helper RPC Function - validate_participant_eligibility
- **Agent**: @backend
- **Priority**: P0 (must)
- **Size**: S
- **Acceptance Criteria**:
  - Function signature: `validate_participant_eligibility(_event_id uuid, _user_id uuid) RETURNS boolean`
  - Returns TRUE if user has: a participant record linked to user_id, AND either a registration for the event with status IN ('pending', 'confirmed') OR a ticket_instance for the event with status IN ('issued', 'checked_in')
  - Security definer, runs with elevated privileges
  - Handles edge case: user_id is NULL returns FALSE
  - Handles edge case: event does not exist returns FALSE

### Task 1.6: Helper RPC Function - check_message_rate_limit
- **Agent**: @backend
- **Priority**: P0 (must)
- **Size**: S
- **Acceptance Criteria**:
  - Function signature: `check_message_rate_limit(_participant_id uuid, _event_id uuid, _messages_per_minute integer) RETURNS boolean`
  - Counts messages from this participant in this event within the last 60 seconds
  - Returns TRUE if under limit, FALSE if at or over limit
  - Uses conversation_messages JOIN conversation_threads for the count

### Task 1.7: Helper RPC Function - create_thread_and_message (atomic)
- **Agent**: @backend
- **Priority**: P0 (must)
- **Size**: M
- **Acceptance Criteria**:
  - Function signature: `create_thread_and_message(_org_id uuid, _event_id uuid, _participant_id uuid, _content text, _messages_per_minute integer) RETURNS jsonb`
  - Atomically: validates eligibility, checks rate limit, creates or finds existing thread, inserts message, updates unread_organizer counter, writes audit log
  - Returns JSON with thread_id, message_id, success/error status
  - On rate limit exceeded: returns error with code RATE_LIMIT_EXCEEDED
  - On eligibility failure: returns error with code NOT_ELIGIBLE
  - On content too long: returns error with code CONTENT_TOO_LONG (handled by constraint, but caught gracefully)

### Task 1.8: Helper RPC Function - organizer_reply (atomic)
- **Agent**: @backend
- **Priority**: P0 (must)
- **Size**: M
- **Acceptance Criteria**:
  - Function signature: `organizer_reply(_thread_id uuid, _sender_user_id uuid, _content text) RETURNS jsonb`
  - Validates: sender is org_member with role IN (owner, admin, support) for the thread's org
  - Inserts message with sender_type = 'organizer'
  - Resets unread_count_organizer to 0 (organizer has seen the thread by replying)
  - Increments unread_count_participant
  - Writes audit log entry
  - Returns JSON with message_id, success/error status

### Task 1.9: Settings Domain Extension
- **Agent**: @backend
- **Priority**: P1 (should)
- **Size**: S
- **Acceptance Criteria**:
  - Settings validation allows keys matching `messaging.*` and `faq.*`
  - Default values registered: messaging.rate_limit.messages_per_minute = 5, messaging.max_message_length = 2000, messaging.retention_days = 180, faq.enabled = true, faq.max_items_per_event = 50
  - Migration is idempotent (IF NOT EXISTS / DO $$ blocks)

### Task 1.10: Edge Function - send-message
- **Agent**: @backend
- **Priority**: P0 (must)
- **Size**: L
- **Acceptance Criteria**:
  - POST /functions/v1/send-message
  - Request body: `{ event_id: string, content: string }` (participant sending) or `{ thread_id: string, content: string }` (organizer replying)
  - Auth: JWT required
  - Logic: Detect if caller is participant or organizer. If participant: call create_thread_and_message RPC. If organizer: call organizer_reply RPC.
  - Responses: 201 Created with { thread_id, message_id } on success. 400 Bad Request with error code on validation failure. 401 Unauthorized if no JWT. 429 Too Many Requests if rate limited. 403 Forbidden if not eligible.
  - Uses service role client for RPC calls (bypasses RLS)

### Task 1.11: Edge Function - get-thread
- **Agent**: @backend
- **Priority**: P0 (must)
- **Size**: M
- **Acceptance Criteria**:
  - GET /functions/v1/get-thread?thread_id=:uuid
  - Auth: JWT required
  - Logic: Validate caller is either the participant of the thread OR an org member (owner/admin/support) for the thread's org. If participant: reset unread_count_participant to 0. Return thread metadata + messages ordered by created_at ASC.
  - Pagination: supports `limit` (default 50, max 200) and `offset` query params
  - Response: { thread: ThreadObject, messages: MessageArray, total_count: number }
  - 403 Forbidden if caller has no access to this thread

### Task 1.12: Edge Function - list-threads
- **Agent**: @backend
- **Priority**: P0 (must)
- **Size**: M
- **Acceptance Criteria**:
  - GET /functions/v1/list-threads?event_id=:uuid
  - Auth: JWT required, must be org member (owner/admin/support)
  - Query params: status (open/closed/all, default: all), sort (newest_first default), limit (default 25, max 100), offset (default 0)
  - Response: { threads: ThreadArray, total_count: number } -- each thread includes participant first_name, last_name, unread counts
  - Threads with unread_count_organizer > 0 are surfaced first within the sorted order (organizer can see which threads need attention)

### Task 1.13: Edge Function - update-thread-status
- **Agent**: @backend
- **Priority**: P0 (must)
- **Size**: S
- **Acceptance Criteria**:
  - PUT /functions/v1/update-thread-status
  - Request body: `{ thread_id: string, status: 'open' | 'closed' }`
  - Auth: JWT required, must be org member (owner/admin/support)
  - Writes audit log (close_thread or reopen_thread action)
  - Response: { thread_id, new_status, updated_at }

### Task 1.14: Edge Function - FAQ CRUD (create, update, delete)
- **Agent**: @backend
- **Priority**: P0 (must)
- **Size**: L
- **Acceptance Criteria**:
  - POST /functions/v1/faq-items -- create
    - Body: { event_id, title, content, category?, sort_order? }
    - Auth: JWT, org member with role owner/admin
    - Validates: title unique per event, max_items_per_event not exceeded
    - Creates with status = 'draft'
  - PUT /functions/v1/faq-items/:id -- update
    - Body: { title?, content?, category?, sort_order?, status? }
    - Auth: JWT, org member with role owner/admin
    - If status changes to 'published': write faq_publish audit log
    - Standard update otherwise: write faq_update audit log
  - DELETE /functions/v1/faq-items/:id
    - Auth: JWT, org member with role owner/admin
    - Write faq_delete audit log
    - Hard delete (item is gone)

### Task 1.15: Edge Function - get-event-faqs (public)
- **Agent**: @backend
- **Priority**: P0 (must)
- **Size**: M
- **Acceptance Criteria**:
  - GET /functions/v1/get-event-faqs?event_id=:uuid
  - Auth: None required (public endpoint)
  - Query params: category (filter), search (text match on title + content, case-insensitive), limit (default 25, max 100)
  - Returns only items with status = 'published', ordered by sort_order ASC, then created_at DESC
  - Response: { faqs: FaqArray, categories: string[] (distinct categories for filter UI) }

### Task 1.16: GDPR Retention Cleanup Function (stub)
- **Agent**: @backend
- **Priority**: P2 (nice)
- **Size**: S
- **Acceptance Criteria**:
  - RPC function: `cleanup_expired_conversations(_retention_days integer DEFAULT 180) RETURNS integer`
  - Deletes conversation_messages where thread's created_at is older than retention_days
  - Deletes conversation_threads that have zero messages after cleanup
  - Returns count of deleted rows
  - Designed to be called by a cron job (not wired up in S1, just the function)

---

## Out of Scope (S1)

- UI components (S2)
- Real-time WebSocket subscriptions (future)
- Email/push notifications for new messages (future, behind feature flag)
- Profanity filter implementation (placeholder column only)
- Full-text search index optimization for FAQ (basic ILIKE for MVP)

---

## Migration File Plan

| File | Content |
|------|---------|
| `20250128200001_f012_conversation_tables.sql` | conversation_threads + conversation_messages + indexes + RLS |
| `20250128200002_f012_faq_items.sql` | faq_items + indexes + RLS |
| `20250128200003_f012_helper_rpcs.sql` | validate_participant_eligibility, check_message_rate_limit, create_thread_and_message, organizer_reply, cleanup_expired_conversations |
| `20250128200004_f012_settings_domain.sql` | Settings domain extension for messaging.* and faq.* |

---

## Technical Notes for @architect

### Conversation Scope Key
The unique key `(org_id, event_id, participant_id)` on conversation_threads means:
- One thread per participant per event per org
- Participant always sees exactly 1 thread labeled "Contact Organisator"
- Organizer sees N threads (one per participant who has messaged)
- This is intentional: simple 1:1 support model, not a general inbox

### Participant Eligibility Check
The validate_participant_eligibility function must check BOTH registration AND ticket_instance paths because:
- Some participants register without buying tickets (free events, waitlist)
- Some have tickets but registrations may be in various states
- A valid ticket_instance with status 'issued' or 'checked_in' is sufficient regardless of registration status

### Unread Counter Strategy
Using denormalized integer counters on conversation_threads rather than computing unread count via query:
- Avoids expensive COUNT queries on message reads
- Updated atomically in the RPC functions (create_thread_and_message increments organizer counter, organizer_reply resets organizer counter and increments participant counter)
- get-thread resets the caller's counter to 0 when they view
- Trade-off: eventual consistency on counter if reads fail, but acceptable for badge display

### Rate Limiting
Per-participant, per-event, window-based (sliding 60-second window):
- Checked in create_thread_and_message RPC before message insertion
- Configurable via messaging.rate_limit.messages_per_minute setting
- Default: 5 messages per minute (conservative for support chat)

### Audit Log Integration
Uses the existing audit_log table (org_id, actor_user_id, action, entity_type, entity_id pattern):
- entity_type values: 'conversation_thread', 'conversation_message', 'faq_item'
- All writes happen inside the atomic RPC functions, same transaction as the data change

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Participant eligibility check is too restrictive (edge cases with cancelled registrations + active tickets) | Medium | Medium | validate_participant_eligibility checks both paths independently with OR logic |
| Unread counter drift if Edge Function crashes mid-update | Low | Low | Counters are display-only; worst case shows stale badge until next interaction |
| Rate limit too aggressive for legitimate burst scenarios (e.g., user types fast) | Medium | Low | Configurable per event; default 5/min is conservative but adjustable |
| RLS policy performance on conversation_messages with large thread histories | Low | Medium | Index on (thread_id, created_at DESC) ensures efficient pagination; threads are per-participant so naturally bounded |
| GDPR retention cleanup on large datasets | Low | High | Cleanup function uses indexed created_at; batching can be added if needed |
| Settings domain extension breaks existing validation trigger | Medium | High | Use IF NOT EXISTS pattern; test migration against current schema before deploy |

---

*Sprint S1 Plan - F012 Event Communication*
*Created: 2026-01-28 | Author: @pm*
