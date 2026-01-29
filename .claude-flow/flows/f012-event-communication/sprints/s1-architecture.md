# F012: Event Communication Architecture

## Overview

Participant-organizer messaging system with threaded chat per event, plus FAQ
management with org-wide and event-specific scoping. Sits at **Layer 6
(Self-Service & Mutations)** since it enables participants to self-serve
communication without manual organizer intervention.

## Architecture Decision Records

See inline ADRs in the migration file header and the design document below.

### Key Decisions Summary

| ADR | Decision | Rationale |
|-----|----------|-----------|
| ADR-F012-001 | Thread-per-participant-per-event with org_id denormalization | O(1) RLS, matches system pattern |
| ADR-F012-002 | Single faq_items table with nullable event_id | Mirrors settings inheritance (org default, event override) |
| ADR-F012-003 | Materialized unread counter + trigger maintenance | Fast dashboard queries for organizers |
| ADR-F012-004 | Rate limits via 'messaging' settings domain | Configurable per event, consistent with existing settings infra |

## Component Structure

```
supabase/
├── migrations/
│   └── 20250128200000_f012_event_communication.sql   # Single migration: tables + RLS + triggers + helpers
└── functions/
    ├── send-message/
    │   └── index.ts          # POST: Send a message (participant or organizer)
    ├── get-threads/
    │   └── index.ts          # GET: List threads (organizer only)
    ├── get-thread-messages/
    │   └── index.ts          # GET: Get messages in a thread
    ├── update-thread-status/
    │   └── index.ts          # PATCH: Close/reopen thread (organizer only)
    ├── faq-crud/
    │   └── index.ts          # POST/PUT/DELETE: Manage FAQ items (organizer only)
    └── get-faqs/
        └── index.ts          # GET: Public FAQ retrieval
```

## Database Schema

### Tables

```
chat_threads (id, org_id, event_id, participant_id, status, unread_count_organizer, last_message_at, created_at, updated_at)
  - UNIQUE (org_id, event_id, participant_id)
  - status: open | pending | closed
  - unread_count_organizer: materialized counter, managed by triggers

chat_messages (id, thread_id, org_id, sender_type, sender_user_id, content, is_flagged, created_at)
  - Append-only: no UPDATE or DELETE
  - content: max 2000 chars (CHECK constraint)
  - sender_type: participant | organizer

chat_thread_reads (id, thread_id, read_by_user_id, read_at)
  - UNIQUE (thread_id, read_by_user_id)
  - UPSERT pattern for idempotent reads

faq_items (id, org_id, event_id, title, content, category, status, sort_order, created_by, created_at, updated_at)
  - event_id nullable: NULL = org-wide, set = event-specific
  - status: draft | published
  - Full-text search index (GIN on tsvector)
```

### Entity Relationships (additions to existing ERD)

```
┌─────────────┐      ┌──────────────┐      ┌──────────────┐
│  events     │──1:N─│ chat_threads │──1:N─│ chat_messages│
└─────────────┘      └──────────────┘      └──────────────┘
       │                     │
       │                     └──1:N── chat_thread_reads
       │
       └──1:N── faq_items (event-specific)

┌─────────────┐
│  orgs       │──1:N── faq_items (org-wide, event_id IS NULL)
└─────────────┘
```

### Trigger Behavior

| Trigger | Table | When | Effect |
|---------|-------|------|--------|
| `on_chat_message_inserted` | chat_messages | AFTER INSERT | Updates thread.last_message_at, increments unread_count if participant sent, auto-transitions status |
| `audit_chat_thread_status` | chat_threads | AFTER UPDATE | Logs status changes to audit_log |
| `chat_threads_updated_at` | chat_threads | BEFORE UPDATE | Auto-sets updated_at |
| `faq_items_updated_at` | faq_items | BEFORE UPDATE | Auto-sets updated_at |

### RLS Policy Summary

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| chat_threads | participant (own) + organizer (org) | participant (if registered/has ticket) | organizer (status only) | - |
| chat_messages | participant (own thread) + organizer (org) | participant (own thread, not closed) + organizer (org threads) | - | - |
| chat_thread_reads | organizer (org) | organizer (own receipt) | organizer (own receipt) | - |
| faq_items | public (published, published event) + organizer (all) | organizer (owner/admin) | organizer (owner/admin) | organizer (owner/admin) |

## Helper Functions (RPCs)

| Function | Auth | Purpose |
|----------|------|---------|
| `get_or_create_chat_thread(event_id, participant_id)` | SECURITY DEFINER | Idempotent thread creation |
| `mark_chat_thread_read(thread_id, reader_user_id)` | SECURITY DEFINER | Reset unread + record receipt |
| `check_participant_event_access(event_id, participant_id)` | SECURITY DEFINER | Validate registration/ticket |
| `get_messaging_settings(event_id)` | SECURITY DEFINER | Merged messaging config |
| `count_recent_participant_messages(thread_id, user_id, window)` | SECURITY DEFINER | Rate limit check |
| `validate_messaging_settings(value)` | - | Settings validation |

## Settings Domain: 'messaging'

```json
{
  "rate_limit": {
    "msgs_per_minute": 5          // 1-60, default 5
  },
  "max_message_length": 2000,     // 1-10000, default 2000
  "retention_days": 180,          // 7-3650, default 180
  "notifications": {
    "email_enabled": false         // feature flag, default false
  }
}
```

Inheritance: system defaults -> org_settings.messaging -> event_settings.messaging

