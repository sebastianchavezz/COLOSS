# Database Architecture

> Reference document for ALL agents. Updated by @architect after each migration.
> @supabase-tester MUST read this before any testing.

## Supabase Connection Code

### TypeScript/JavaScript

```typescript
import { createClient } from '@supabase/supabase-js';

// Anon client (respects RLS)
const supabase = createClient(
  'http://127.0.0.1:54321',
  'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'
);

// Service role client (bypasses RLS) - ONLY for tests/admin
const adminClient = createClient(
  'http://127.0.0.1:54321',
  'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz'
);
```

### Direct SQL (psql)

```bash
# Database URL
postgresql://postgres:postgres@127.0.0.1:54322/postgres

# Direct psql access
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres

# Run SQL file
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f file.sql
```

### API Endpoints

| Service | URL |
|---------|-----|
| API | http://127.0.0.1:54321 |
| Studio | http://127.0.0.1:54323 |
| REST | http://127.0.0.1:54321/rest/v1 |

---

## Table Overview

### Layer 1: Identity & Multi-Tenant

| Table | Purpose | RLS |
|-------|---------|-----|
| `orgs` | Organizations/tenants | org_members only |
| `org_members` | User-org memberships | own org only |

### Layer 2: Events

| Table | Purpose | RLS |
|-------|---------|-----|
| `events` | Event definitions | public read, org write |
| `event_settings` | Per-event config | org members only |

### Layer 3: Participants & Registrations

| Table | Purpose | RLS |
|-------|---------|-----|
| `participants` | People (auth or guest) | user=own, org=their events |
| `registrations` | Event participation | user=own, org=their events |
| `registration_answers` | Dynamic form answers | via registration |
| `registration_questions` | Form field definitions | org members |

### Layer 4: Tickets

| Table | Purpose | RLS |
|-------|---------|-----|
| `ticket_types` | Ticket categories | public read, org write |
| `ticket_instances` | Individual tickets w/ QR | owner or org |

### Layer 5: Orders & Payments

| Table | Purpose | RLS |
|-------|---------|-----|
| `orders` | Checkout state | user=own, org=their events |
| `order_items` | Line items | via order |
| `payments` | Payment transactions | org members |
| `payment_events` | Webhook idempotency | service role only |

### Layer 6: Self-Service

| Table | Purpose | RLS |
|-------|---------|-----|
| `ticket_transfers` | Transfer requests | from/to participant |
| `audit_log` | Append-only audit | org members read |

### Layer 7: Communication

| Table | Purpose | RLS |
|-------|---------|-----|
| `email_outbox` | Email queue | service role |
| `message_templates` | Email templates | org members |
| `email_bounces` | Bounce tracking | service role |
| `email_unsubscribes` | GDPR unsubscribes | service role |

### Layer 7b: Event Communication (F012)

| Table | Purpose | RLS |
|-------|---------|-----|
| `chat_threads` | Support threads (1 per participant per event) | participant (own) + organizer (org) SELECT; organizer UPDATE status |
| `chat_messages` | Messages within threads (append-only) | participant (own thread) + organizer (org threads) SELECT; service role INSERT |
| `chat_thread_reads` | Read receipts for organizers (UPSERT idempotent) | organizer (org) SELECT; organizer (own) INSERT/UPDATE |
| `faq_items` | FAQ entries (org-wide or event-specific) | public (published) + organizer (all); organizer owner/admin INSERT/UPDATE/DELETE |

---

## Key RPC Functions

### F006 Checkout/Payment

| Function | Purpose | Auth |
|----------|---------|------|
| `validate_checkout_capacity(event_id, items)` | Pre-checkout validation | anon/auth |
| `handle_payment_webhook(order_id, payment_id, status, amount, currency)` | Mollie webhook handler | service_role |
| `cleanup_stale_pending_orders()` | Remove stuck orders | service_role |

### F007 Ticket Scan

| Function | Purpose | Auth |
|----------|---------|------|
| `verify_ticket_scan(token)` | Verify QR token | anon |
| `perform_check_in(ticket_id)` | Check-in ticket | authenticated org member |

### F011 Registrations

| Function | Purpose | Auth |
|----------|---------|------|
| `get_registrations_list(event_id, filters, page, page_size)` | Paginated list | org member |
| `get_registration_detail(registration_id)` | Single registration | org member |
| `export_registrations_csv(event_id, filters)` | CSV export | admin |

### F012 Event Communication

| Function | Purpose | Auth |
|----------|---------|------|
| `get_or_create_chat_thread(event_id, participant_id)` | Idempotent thread creation | SECURITY DEFINER |
| `mark_chat_thread_read(thread_id, reader_user_id)` | Reset unread counter + record receipt | SECURITY DEFINER |
| `check_participant_event_access(event_id, participant_id)` | Validate registration/ticket for event | SECURITY DEFINER |
| `get_messaging_settings(event_id)` | Merged messaging config (org default + event override) | SECURITY DEFINER |
| `count_recent_participant_messages(thread_id, user_id, window)` | Rate limit check | SECURITY DEFINER |
| `validate_messaging_settings(value)` | Settings schema validation | -- |

---

## Entity Relationship Diagram

```
┌─────────────┐      ┌─────────────┐
│    orgs     │──1:N─│   events    │
└─────────────┘      └─────────────┘
       │                    │
       │                    ├── ticket_types (1:N)
       │                    │         │
       │                    │         └── ticket_instances (1:N)
       │                    │                    │
       │                    ├── orders (1:N)─────┤
       │                    │      │             │
       │                    │      └── order_items (1:N)
       │                    │             │
       │                    │             └── ticket_instances (link)
       │                    │
       │                    ├── registrations (1:N)
       │                    │         │
       │                    │         └── participants (N:1)
       │                    │
       │                    ├── chat_threads (1:N) ─── chat_messages (1:N)
       │                    │         │                      │
       │                    │         └── chat_thread_reads (1:N)
       │                    │         │
       │                    │         └── participants (N:1)
       │                    │
       │                    └── faq_items (1:N)
       │
       ├── faq_items (1:N, org-wide where event_id IS NULL)
       │
       └── org_members (1:N)
                │
                └── auth.users (N:1)
```

---

## Key Constraints

### Unique Constraints

| Table | Constraint | Purpose |
|-------|------------|---------|
| `participants` | `idx_participants_email_unique (email) WHERE deleted_at IS NULL` | One profile per email |
| `ticket_instances` | `idx_ticket_instances_idempotency (order_item_id, sequence_no) WHERE deleted_at IS NULL` | No duplicate tickets |
| `payment_events` | `(provider, provider_event_id)` | Webhook idempotency |
| `orders` | `token_hash` | Public order lookup |
| `chat_threads` | `(org_id, event_id, participant_id)` | One thread per participant per event |
| `chat_thread_reads` | `(thread_id, read_by_user_id)` | One read receipt per user per thread |
| `faq_items` | `(event_id, title)` | No duplicate FAQ titles per event |

### Foreign Keys

| Child | Parent | On Delete |
|-------|--------|-----------|
| `participants.user_id` | `auth.users` | SET NULL |
| `registrations.participant_id` | `participants` | RESTRICT |
| `ticket_instances.order_id` | `orders` | RESTRICT |
| `order_items.ticket_type_id` | `ticket_types` | RESTRICT |
| `chat_threads.org_id` | `orgs` | RESTRICT |
| `chat_threads.event_id` | `events` | RESTRICT |
| `chat_threads.participant_id` | `participants` | RESTRICT |
| `chat_messages.thread_id` | `chat_threads` | CASCADE |
| `chat_messages.sender_user_id` | `auth.users` | SET NULL |
| `faq_items.org_id` | `orgs` | CASCADE |
| `faq_items.event_id` | `events` | CASCADE |
| `faq_items.created_by` | `auth.users` | SET NULL |

---

## Enum Types

| Type | Values |
|------|--------|
| `payment_status` | pending, paid, failed, cancelled, refunded, open, expired, created |
| `ticket_instance_status` | draft, issued, used, voided, transferred, checked_in, cancelled |
| `registration_status` | pending, confirmed, waitlist, cancelled |
| `order_status` | pending, paid, failed, cancelled, refunded |
| `email_status` | queued, sending, sent, delivered, failed, bounced |

---

*Last updated: 2025-01-28*
