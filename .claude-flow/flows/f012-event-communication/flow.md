# F012: Event Communication

## Status: 🟢 Done

## Summary

Participant-organizer messaging (threaded chat) + FAQ management for events.
Participants can open support threads and communicate with organizers.
Organizers can manage FAQ items at org or event scope.

## Dependency

- Requires: F003 (Events), F011 (Participants/Registrations), F006 (Checkout/Payment - for ticket_instances)
- All satisfied: F003/F011/F006 infrastructure exists in schema

## Deliverables

| Artifact | Status | Location |
|----------|--------|----------|
| Architecture doc | 🟢 Done | `sprints/s1-architecture.md` |
| Edge Function interfaces | 🟢 Done | `sprints/s1-edge-function-interfaces.md` |
| SQL Migration | 🟢 Done | `supabase/migrations/20250128200000_f012_event_communication.sql` |
| Bug fix migration | 🟢 Done | `supabase/migrations/20250128210000_f012_fix_audit_and_settings.sql` |
| Test requirements | 🟢 Done | `tests/test-requirements.md` |
| Edge Functions | 🟢 Done | `supabase/functions/send-message/`, `get-threads/`, etc. |
| Frontend Components | 🟢 Done | `web/src/pages/EventMessaging.tsx`, `ParticipantChat.tsx`, etc. |
| Tests | 🟢 Done | `tests/full-test-suite.sql` (32/32 passing) |

## Tables

- `chat_threads` - Support threads (1 per participant per event)
- `chat_messages` - Messages within threads (append-only)
- `chat_thread_reads` - Read receipts for organizers
- `faq_items` - FAQ entries (org-wide or event-specific)

## Edge Functions

1. `send-message` (POST) - Participant or organizer sends a message
2. `get-threads` (GET) - Organizer lists threads for an event
3. `get-thread-messages` (GET) - View messages in a thread
4. `update-thread-status` (PATCH) - Organizer closes/reopens thread
5. `faq-crud` (POST/PUT/DELETE) - Manage FAQ items
6. `get-faqs` (GET) - Public FAQ retrieval

## Settings Domain

New `messaging` domain added with: rate limits, max message length,
retention period, and notification toggles.
