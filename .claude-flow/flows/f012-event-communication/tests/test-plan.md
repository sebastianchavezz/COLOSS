# F012 Test Plan - Event Communication (Messaging + FAQ)

## Metadata

| Field | Value |
|-------|-------|
| **Flow** | F012 - Event Communication |
| **Document** | Test Plan |
| **Author** | @pm |
| **Created** | 2026-01-28 |

---

## Test Scope

### Database / RLS Tests (@supabase-tester)

| ID | Scenario | Expected Result | Priority |
|----|----------|-----------------|----------|
| T01 | Participant with valid registration can send message | Message inserted, thread created | P0 |
| T02 | Participant with valid ticket_instance (no registration) can send message | Message inserted, thread created | P0 |
| T03 | Participant with NO registration AND NO ticket_instance cannot send message | RPC returns NOT_ELIGIBLE error | P0 |
| T04 | Participant with cancelled registration AND no valid ticket cannot send | RPC returns NOT_ELIGIBLE error | P0 |
| T05 | Organizer (owner) can reply to thread | Message inserted with sender_type=organizer | P0 |
| T06 | Organizer (admin) can reply to thread | Message inserted | P0 |
| T07 | Organizer (support) can reply to thread | Message inserted | P0 |
| T08 | Organizer (finance) CANNOT reply to thread | RPC returns error | P0 |
| T09 | Participant can only see their own thread | RLS blocks access to other participant's thread | P0 |
| T10 | Organizer can see all threads for their event | All threads returned | P0 |
| T11 | Organizer CANNOT see threads for another org's event | RLS blocks access | P0 |
| T12 | Participant cannot see another participant's messages | RLS blocks access to messages in other thread | P0 |
| T13 | Rate limit enforced: 6th message within 60 seconds rejected | RPC returns RATE_LIMIT_EXCEEDED | P0 |
| T14 | Rate limit resets after 60 seconds | 6th message after reset succeeds | P1 |
| T15 | Message content at exactly 2000 chars accepted | INSERT succeeds | P0 |
| T16 | Message content at 2001 chars rejected | CHECK constraint violation | P0 |
| T17 | Message content empty string rejected | CHECK constraint violation | P0 |
| T18 | Duplicate thread NOT created: participant sends second message | Same thread_id returned, new message added | P0 |
| T19 | Unread counter increments on new message | unread_count_organizer increases by 1 | P0 |
| T20 | Unread counter resets on organizer reply | unread_count_organizer = 0 after reply | P0 |
| T21 | Thread close writes audit log | audit_log has action='close_thread' | P0 |
| T22 | Thread reopen writes audit log | audit_log has action='reopen_thread' | P0 |
| T23 | FAQ item created with status draft | faq_items row has status='draft' | P0 |
| T24 | FAQ item published: status updated to 'published' | faq_items row has status='published' | P0 |
| T25 | Public can read published FAQ items | SELECT returns published items | P0 |
| T26 | Public CANNOT read draft FAQ items | SELECT returns empty (RLS blocks) | P0 |
| T27 | Organizer (owner) can CRUD FAQ items | All operations succeed | P0 |
| T28 | Organizer (admin) can CRUD FAQ items | All operations succeed | P0 |
| T29 | Organizer (support) CANNOT create FAQ items | RLS blocks INSERT | P0 |
| T30 | Duplicate FAQ title per event rejected | UNIQUE constraint violation | P0 |
| T31 | FAQ title > 200 chars rejected | CHECK constraint violation | P1 |
| T32 | FAQ content > 10000 chars rejected | CHECK constraint violation | P1 |
| T33 | GDPR cleanup function deletes messages older than retention_days | Messages deleted, empty threads cleaned | P2 |
| T34 | Cross-tenant isolation: org A member cannot access org B's threads | RLS blocks access | P0 |
| T35 | Cross-tenant isolation: org A member cannot access org B's FAQ items | RLS blocks access | P0 |

### Edge Function Tests (@tester)

| ID | Scenario | Expected Result | Priority |
|----|----------|-----------------|----------|
| T36 | POST send-message without auth header | 401 Unauthorized | P0 |
| T37 | POST send-message with valid participant JWT | 201 Created, thread + message returned | P0 |
| T38 | POST send-message with organizer JWT + thread_id | 201 Created, reply added | P0 |
| T39 | POST send-message with invalid event_id | 404 Not Found | P0 |
| T40 | POST send-message exceeding rate limit | 429 Too Many Requests | P0 |
| T41 | POST send-message with content > 2000 chars | 400 Bad Request | P0 |
| T42 | GET get-thread with valid participant JWT | 200 OK, messages returned | P0 |
| T43 | GET get-thread with organizer JWT | 200 OK, messages returned | P0 |
| T44 | GET get-thread with unauthorized JWT | 403 Forbidden | P0 |
| T45 | GET get-thread resets unread for caller | Unread counter = 0 after call | P0 |
| T46 | GET list-threads with organizer JWT | 200 OK, thread list returned | P0 |
| T47 | GET list-threads with participant JWT | 403 Forbidden | P0 |
| T48 | GET list-threads with status=open filter | Only open threads returned | P0 |
| T49 | PUT update-thread-status close | 200 OK, status=closed | P0 |
| T50 | PUT update-thread-status reopen | 200 OK, status=open | P0 |
| T51 | PUT update-thread-status idempotent (same status) | 200 OK, no change | P1 |
| T52 | POST faq-items create (organizer owner) | 201 Created, status=draft | P0 |
| T53 | POST faq-items create (organizer support) | 403 Forbidden | P0 |
| T54 | PUT faq-items/:id update content | 200 OK, content updated | P0 |
| T55 | PUT faq-items/:id publish (status=published) | 200 OK, audit log entry | P0 |
| T56 | DELETE faq-items/:id | 200 OK, item gone | P0 |
| T57 | GET get-event-faqs (public, no auth) | 200 OK, published items only | P0 |
| T58 | GET get-event-faqs with search param | 200 OK, filtered by title/content | P0 |
| T59 | GET get-event-faqs with category param | 200 OK, filtered by category | P0 |
| T60 | GET get-event-faqs returns categories array | categories field populated | P1 |

### UI Tests (@tester, S2)

| ID | Scenario | Expected Result | Priority |
|----|----------|-----------------|----------|
| T61 | Participant opens /e/:eventSlug/chat, sees empty state | "Stuur je eerste bericht" message shown | P0 |
| T62 | Participant sends message, sees it in chat | Message appears in UI immediately | P0 |
| T63 | Organizer opens thread list, sees unread badge | Badge visible with count | P0 |
| T64 | Organizer opens thread, badge disappears | Unread count resets | P0 |
| T65 | Organizer replies, participant sees reply | Reply appears in participant's chat | P0 |
| T66 | Organizer closes thread, status updates | Thread shows "Closed" status | P0 |
| T67 | Public opens /e/:eventSlug/faq, sees published FAQs | FAQ accordion items rendered | P0 |
| T68 | Public searches FAQ, results filtered | Only matching FAQs shown | P0 |
| T69 | Organizer creates FAQ item, sees in admin table | New row with status=Draft | P0 |
| T70 | Organizer publishes FAQ, public sees it | Status changes, public page updated | P0 |

---

## Test Verification SQL Script

For @supabase-tester, a reference SQL verification script should be created at:
`/f012-event-communication/tests/sql-verification.sql`

This script should:
1. Set up test data: org, org_members (multiple roles), event, participants, registrations, ticket_instances
2. Run each RLS test by switching roles (SET LOCAL role)
3. Verify audit_log entries after operations
4. Clean up test data

---

## Acceptance Gates

### S1 Complete When:
- All P0 database tests (T01-T35) pass
- All P0 Edge Function tests (T36-T60) pass
- RLS cross-tenant isolation verified
- Audit log entries verified for all critical actions
- Settings domain extension does not break existing migrations

### S2 Complete When:
- All P0 UI tests (T61-T70) pass
- Error states handled (network failure shows error message)
- Empty states shown appropriately
- Navigation integration works (links visible from event pages)

---

*Test Plan - F012 Event Communication*
*Created: 2026-01-28 | Author: @pm*
