# Flow: Communication

**ID**: F008
**Status**: 🟢 Done
**Total Sprints**: 1
**Current Sprint**: Done

## Sprints
| Sprint | Focus | Status |
|--------|-------|--------|
| S1 | Resend + Outbox + Bulk | 🟢 |

## Dependencies
- **Requires**: F001, F002
- **Blocks**: None

## Overview

Email communicatie systeem met Resend provider, outbox pattern voor exactly-once delivery, bulk messaging, en compliance features.

```
Als organisator
Wil ik kunnen communiceren met mijn deelnemers
Zodat ik hen kan informeren over updates en wijzigingen

Als systeem
Wil ik transactionele emails verzenden
Zodat deelnemers confirmaties en tickets ontvangen
```

## Flow Diagram

```
           ┌─────────────────────────────────┐
           │        COMMUNICATION HUB        │
           └─────────────┬───────────────────┘
                         │
     ┌───────────────────┼───────────────────┐
     ▼                   ▼                   ▼
[Transactional]    [Bulk Messaging]    [System Alerts]
     │                   │                   │
     └───────────────────┴───────────────────┘
                         │
                         ▼
                  [Email Outbox]
                         │
                         ▼
                [Process Outbox] → [Resend API]
                         │
                         ▼
                [Resend Webhook] → [Status Update]
```

## Supabase

### Tables
| Table | Purpose |
|-------|---------|
| `email_outbox` | Queue for outgoing emails |
| `email_outbox_events` | Status events (sent, bounced) |
| `message_batches` | Bulk batch tracking |
| `message_batch_items` | Items per batch |
| `email_unsubscribes` | Unsubscribe registry |
| `email_bounces` | Bounce/complaint registry |
| `message_templates` | Reusable templates |

### RLS Policies
| Policy | Table | Rule |
|--------|-------|------|
| `org_isolation` | `email_outbox` | `org_id = auth.org_id()` |
| `org_isolation` | `message_batches` | `org_id = auth.org_id()` |
| `deliverable_check` | `email_unsubscribes` | Public read for checks |

### Edge Functions
| Function | Purpose | Trigger |
|----------|---------|---------|
| `process-outbox` | Send queued emails | Cron (1 min) |
| `resend-webhook` | Handle delivery events | Webhook |
| `bulk-email` | Start bulk campaign | API |
| `unsubscribe` | Handle unsubscribe | Link click |

## API Endpoints

| Method | Endpoint | Auth |
|--------|----------|------|
| POST | `/functions/v1/bulk-email` | Yes (org admin) |
| GET | `/functions/v1/unsubscribe` | Token |
| POST | `/functions/v1/resend-webhook` | Signature |

## Settings Domain

```
communication.sender.default_from_name
communication.sender.default_from_email
communication.sender.default_reply_to
communication.bulk.batch_size
communication.bulk.delay_between_batches_ms
communication.bulk.max_recipients_per_campaign
communication.compliance.unsubscribe_enabled
communication.compliance.bounce_threshold
communication.compliance.complaint_threshold
communication.rate_limits.emails_per_minute
communication.rate_limits.emails_per_hour
communication.retry.max_attempts
communication.retry.initial_delay_ms
communication.retry.backoff_multiplier
```

## Test Scenarios

| ID | Scenario | Expected | Status |
|----|----------|----------|--------|
| T1 | Queue email | Email in outbox | ✅ |
| T2 | Process outbox | Resend API called | ✅ |
| T3 | Webhook bounced | Bounce recorded | ✅ |
| T4 | Bulk send 500 | 5 batches, progress | ⬜ |
| T5 | Unsubscribed excluded | No email sent | ⬜ |
| T6 | Retry failed | 3 attempts with backoff | ⬜ |
| T7 | Idempotency | No duplicate sends | ✅ |
| T8 | RLS check | Org isolation | ✅ |

## Acceptance Criteria

- [x] Outbox pattern implemented
- [x] Resend provider integrated
- [x] Webhook signature verification
- [x] Bounce/complaint tracking
- [x] Unsubscribe functionality
- [x] Bulk messaging with batching
- [x] Settings configurable per event
- [x] RLS enforces org isolation
- [ ] All edge case tests pass

---

*Last updated: 2025-01-27*
