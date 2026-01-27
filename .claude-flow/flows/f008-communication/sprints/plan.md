# Sprint Plan: Communication - Resend Email Provider + Outbox + Bulk Messaging

## Metadata
| Field | Value |
|-------|-------|
| **Sprint** | Communication |
| **Flow** | F008 |
| **Status** | Planning |
| **Created** | 2025-01-27 |

---

## Overview

Implementeer een compleet communicatiesysteem met:
- Resend als email provider
- Outbox pattern voor exactly-once delivery
- Bulk messaging met batching en progress tracking
- Compliance (unsubscribe, bounce handling)

---

## Flows

### F008: Communication
Relevante secties:
- Automated Messages (registration, reminders, event changes)
- Manual Messages (organizer compose, bulk send)
- Error Handling (bounce, rate limit)

---

## Scope

### Database Tables

| Table | Action | Purpose | RLS |
|-------|--------|---------|-----|
| `email_outbox` | CREATE | Queue voor alle uitgaande emails | org_id isolatie |
| `email_outbox_events` | CREATE | Status events (sent, delivered, bounced) | org_id isolatie |
| `message_batches` | CREATE | Bulk message batch tracking | org_id isolatie |
| `message_batch_items` | CREATE | Items per batch | org_id isolatie |
| `email_unsubscribes` | CREATE | Unsubscribe registry | public read voor check |
| `email_bounces` | CREATE | Bounce/complaint registry | org_id isolatie |
| `message_templates` | CREATE | Reusable email templates | org_id isolatie |

### Settings Domain: `communication.*`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `communication.sender.default_from_name` | string | org name | Afzender naam |
| `communication.sender.default_from_email` | string | noreply@coloss.nl | Afzender email |
| `communication.sender.default_reply_to` | string | null | Reply-to adres |
| `communication.provider.resend.enabled` | boolean | true | Provider actief |
| `communication.provider.resend.api_key_ref` | string | env | Referentie naar secret |
| `communication.bulk.batch_size` | number | 100 | Emails per batch |
| `communication.bulk.delay_between_batches_ms` | number | 1000 | Delay tussen batches |
| `communication.compliance.unsubscribe_enabled` | boolean | true | Unsubscribe link tonen |
| `communication.compliance.bounce_threshold` | number | 3 | Max bounces voor blacklist |

### Edge Functions

| Function | Purpose | Auth | Trigger |
|----------|---------|------|---------|
| `send-email` | Single email via outbox | System | Outbox processor |
| `process-outbox` | Process pending emails | System | Cron (1 min) |
| `bulk-email` | Start bulk message | Yes (org admin) | API call |
| `resend-webhook` | Handle Resend events | Webhook signature | Resend callback |
| `send-auth-email` | Auth emails (magic link, reset) | Supabase Auth | Auth hook |

### Triggers

| Trigger | Table | Action | Purpose |
|---------|-------|--------|---------|
| `queue_order_confirmation` | `orders` | AFTER UPDATE (status=paid) | Queue confirmation email |
| `queue_ticket_email` | `tickets` | AFTER INSERT | Queue ticket delivery email |
| `queue_transfer_emails` | `ticket_transfers` | AFTER INSERT/UPDATE | Queue transfer notifications |

---

## Implementation Order

### FASE 1: Database Schema
1. Create `email_outbox` table met idempotency_key
2. Create `email_outbox_events` voor status tracking
3. Create `message_batches` en `message_batch_items`
4. Create `email_unsubscribes` en `email_bounces`
5. Create `message_templates`
6. Add RLS policies op alle tabellen

### FASE 2: Settings Extension
1. Extend domain constraint voor `communication.*`
2. Add validation function voor nieuwe keys
3. Add default settings
4. Update RBAC (owner/admin can edit)

### FASE 3: Outbox Infrastructure
1. Create `send-email` Edge Function
2. Create `process-outbox` cron function
3. Create queue helper functions (queue_email, mark_sent, mark_failed)
4. Add retry logic (max 3 attempts, exponential backoff)

### FASE 4: Resend Integration
1. Create `resend-webhook` Edge Function
2. Handle delivery events (sent, delivered, bounced, complained)
3. Update outbox status based on webhooks
4. Implement bounce/complaint tracking

### FASE 5: Transactional Emails
1. Create triggers voor order confirmation
2. Create triggers voor ticket delivery
3. Create triggers voor transfer events
4. Template variables support ({{name}}, {{event}}, {{ticket_code}})

### FASE 6: Bulk Messaging
1. Create `bulk-email` Edge Function
2. Implement batching logic
3. Progress tracking via message_batches
4. Recipient filtering (all, ticket_type, custom query)

### FASE 7: Compliance
1. Unsubscribe link in alle marketing emails
2. Unsubscribe endpoint
3. Bounce threshold enforcement
4. Audit logging voor alle email events

---

## Out of Scope

- Push notifications / in-app notifications (future sprint)
- SMS messaging
- WhatsApp integration
- Email template designer UI
- A/B testing

---

## Test Scenarios

| ID | Scenario | Expected |
|----|----------|----------|
| T1 | Order paid triggers email | Email queued in outbox |
| T2 | Outbox processor sends email | Resend API called, status updated |
| T3 | Resend webhook bounced | Bounce recorded, counter incremented |
| T4 | Bulk send to 500 recipients | 5 batches, progress tracked |
| T5 | Unsubscribed user excluded | No email sent |
| T6 | Retry failed email | 3 attempts with backoff |
| T7 | Idempotency check | Same idempotency_key = no duplicate |
| T8 | RLS check | User A cannot see User B's outbox |

---

## Security Checklist

- [ ] RLS enabled op alle tabellen
- [ ] API key NOOIT in client code
- [ ] Webhook signature verificatie
- [ ] Rate limiting op bulk endpoint
- [ ] Audit log voor alle sends
- [ ] org_id isolatie correct

---

## Dependencies

### Requires
- Bestaande `communication` domain settings
- `orders`, `tickets`, `ticket_transfers` tabellen
- Supabase Edge Functions runtime

### External
- Resend account + API key
- Webhook endpoint URL configuratie

---

## Estimated Effort

| Component | Size | Notes |
|-----------|------|-------|
| Database | M | 7 nieuwe tabellen + RLS |
| Settings | S | Extend bestaand systeem |
| Edge Functions | L | 5 functies + webhook handling |
| Triggers | M | 4 triggers |
| Tests | M | RLS + integration tests |

---

## Files to Create

### Migrations
- `supabase/migrations/YYYYMMDD_communication_outbox.sql`
- `supabase/migrations/YYYYMMDD_communication_settings.sql`

### Edge Functions
- `supabase/functions/send-email/index.ts`
- `supabase/functions/process-outbox/index.ts`
- `supabase/functions/bulk-email/index.ts`
- `supabase/functions/resend-webhook/index.ts`

### Types
- `src/types/communication.ts`

---

## Approval

> Plan klaar. Review en geef feedback, of start implementatie.

---

*Generated: 2025-01-27*
