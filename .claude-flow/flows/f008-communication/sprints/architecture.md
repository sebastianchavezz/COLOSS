# Communication Module - Technical Architecture

## Metadata
| Field | Value |
|-------|-------|
| **Sprint** | Communication |
| **Author** | @architect |
| **Version** | 1.0 |
| **Status** | Design |
| **Created** | 2025-01-27 |

---

## 1. Overzicht

Dit document beschrijft de technische architectuur voor het Communication Module, bestaande uit:
- **Email Outbox Pattern**: Queue-based email verzending met exactly-once garanties
- **Bulk Messaging**: Batch processing voor grote aantallen emails
- **Compliance**: Unsubscribe en bounce handling conform GDPR

### Design Principes
1. **Outbox Pattern**: Emails worden altijd eerst in de database geschreven voordat ze verzonden worden (transactioneel veilig)
2. **Idempotency**: Dubbele verzending wordt voorkomen via `idempotency_key`
3. **Event Sourcing**: Alle status changes worden gelogd in `email_outbox_events`
4. **Retry-safe**: Gefaalde emails worden automatisch opnieuw geprobeerd met exponential backoff

---

## 2. Database Schema Design

### 2.1 email_outbox

**Doel**: Queue voor alle uitgaande emails met status tracking.

```sql
CREATE TYPE email_status AS ENUM (
    'queued',
    'processing',
    'sent',
    'delivered',
    'bounced',
    'soft_bounced',
    'complained',
    'failed',
    'cancelled'
);

CREATE TABLE public.email_outbox (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE RESTRICT,
    event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
    idempotency_key text NOT NULL,
    from_name text NOT NULL,
    from_email text NOT NULL,
    reply_to text,
    to_email text NOT NULL,
    subject text NOT NULL,
    html_body text NOT NULL,
    text_body text,
    template_id uuid REFERENCES public.message_templates(id),
    template_variables jsonb,
    scheduled_at timestamptz NOT NULL DEFAULT now(),
    status email_status NOT NULL DEFAULT 'queued',
    attempt_count integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 3,
    last_attempt_at timestamptz,
    next_attempt_at timestamptz,
    provider_message_id text,
    error_message text,
    error_code text,
    batch_id uuid REFERENCES public.message_batches(id),
    email_type text NOT NULL DEFAULT 'transactional',
    tags jsonb DEFAULT '[]'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    delivered_at timestamptz,
    CONSTRAINT email_outbox_pkey PRIMARY KEY (id),
    CONSTRAINT email_outbox_idempotency_key UNIQUE (idempotency_key),
    CONSTRAINT email_outbox_valid_email CHECK (to_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    CONSTRAINT email_outbox_valid_from_email CHECK (from_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    CONSTRAINT email_outbox_attempt_count_check CHECK (attempt_count >= 0 AND attempt_count <= max_attempts),
    CONSTRAINT email_outbox_valid_email_type CHECK (email_type IN ('transactional', 'marketing', 'system'))
);

-- Indexes
CREATE INDEX idx_email_outbox_processing ON public.email_outbox(next_attempt_at, status) WHERE status IN ('queued', 'soft_bounced');
CREATE INDEX idx_email_outbox_org ON public.email_outbox(org_id, created_at DESC);
CREATE INDEX idx_email_outbox_event ON public.email_outbox(event_id, status) WHERE event_id IS NOT NULL;
CREATE INDEX idx_email_outbox_batch ON public.email_outbox(batch_id, status) WHERE batch_id IS NOT NULL;
CREATE INDEX idx_email_outbox_provider_message ON public.email_outbox(provider_message_id) WHERE provider_message_id IS NOT NULL;
```

### 2.2 email_outbox_events

**Doel**: Event sourcing voor alle status changes.

```sql
CREATE TABLE public.email_outbox_events (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    email_id uuid NOT NULL REFERENCES public.email_outbox(id) ON DELETE CASCADE,
    event_type text NOT NULL,
    previous_status email_status,
    new_status email_status,
    provider_event_id text,
    provider_timestamp timestamptz,
    error_message text,
    error_code text,
    metadata jsonb DEFAULT '{}'::jsonb,
    raw_payload jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT email_outbox_events_pkey PRIMARY KEY (id),
    CONSTRAINT email_outbox_events_valid_type CHECK (
        event_type IN ('created', 'queued', 'processing', 'sent', 'delivered', 'bounced', 'soft_bounced', 'complained', 'failed', 'cancelled', 'retry_scheduled')
    )
);

CREATE INDEX idx_email_outbox_events_email ON public.email_outbox_events(email_id, created_at DESC);
CREATE UNIQUE INDEX idx_email_outbox_events_provider ON public.email_outbox_events(provider_event_id) WHERE provider_event_id IS NOT NULL;
```

### 2.3 message_batches

**Doel**: Bulk job tracking met progress monitoring.

```sql
CREATE TYPE batch_status AS ENUM (
    'draft',
    'queued',
    'processing',
    'sending',
    'completed',
    'paused',
    'cancelled',
    'failed'
);

CREATE TABLE public.message_batches (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE RESTRICT,
    event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
    name text NOT NULL,
    description text,
    email_type text NOT NULL DEFAULT 'marketing',
    template_id uuid REFERENCES public.message_templates(id),
    subject text NOT NULL,
    html_body text NOT NULL,
    text_body text,
    recipient_filter jsonb NOT NULL,
    status batch_status NOT NULL DEFAULT 'draft',
    total_recipients integer NOT NULL DEFAULT 0,
    queued_count integer NOT NULL DEFAULT 0,
    sent_count integer NOT NULL DEFAULT 0,
    delivered_count integer NOT NULL DEFAULT 0,
    failed_count integer NOT NULL DEFAULT 0,
    bounced_count integer NOT NULL DEFAULT 0,
    scheduled_at timestamptz,
    started_at timestamptz,
    completed_at timestamptz,
    created_by uuid NOT NULL REFERENCES auth.users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT message_batches_pkey PRIMARY KEY (id),
    CONSTRAINT message_batches_valid_type CHECK (email_type IN ('transactional', 'marketing'))
);

CREATE INDEX idx_message_batches_org ON public.message_batches(org_id, created_at DESC);
CREATE INDEX idx_message_batches_status ON public.message_batches(status) WHERE status IN ('queued', 'processing', 'sending');
```

### 2.4 message_batch_items

**Doel**: Individual recipients per batch.

```sql
CREATE TYPE batch_item_status AS ENUM (
    'pending',
    'queued',
    'skipped',
    'failed'
);

CREATE TABLE public.message_batch_items (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    batch_id uuid NOT NULL REFERENCES public.message_batches(id) ON DELETE CASCADE,
    participant_id uuid REFERENCES public.participants(id) ON DELETE SET NULL,
    email text NOT NULL,
    variables jsonb DEFAULT '{}'::jsonb,
    status batch_item_status NOT NULL DEFAULT 'pending',
    email_id uuid REFERENCES public.email_outbox(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    CONSTRAINT message_batch_items_pkey PRIMARY KEY (id),
    CONSTRAINT message_batch_items_valid_email CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

CREATE INDEX idx_message_batch_items_batch ON public.message_batch_items(batch_id, status);
CREATE UNIQUE INDEX idx_message_batch_items_unique_recipient ON public.message_batch_items(batch_id, email);
```

### 2.5 email_unsubscribes

**Doel**: Unsubscribe registry per email/org/type.

```sql
CREATE TABLE public.email_unsubscribes (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    email text NOT NULL,
    org_id uuid REFERENCES public.orgs(id) ON DELETE CASCADE,
    email_type text NOT NULL DEFAULT 'marketing',
    source text NOT NULL DEFAULT 'user_request',
    reason text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT email_unsubscribes_pkey PRIMARY KEY (id),
    CONSTRAINT email_unsubscribes_valid_email CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    CONSTRAINT email_unsubscribes_valid_type CHECK (email_type IN ('marketing', 'all')),
    CONSTRAINT email_unsubscribes_valid_source CHECK (source IN ('user_request', 'link_click', 'admin_action', 'bounce_threshold'))
);

CREATE UNIQUE INDEX idx_email_unsubscribes_lookup ON public.email_unsubscribes(email, COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), email_type);
```

### 2.6 email_bounces

**Doel**: Bounce history voor tracking.

```sql
CREATE TABLE public.email_bounces (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    email text NOT NULL,
    bounce_type text NOT NULL,
    provider text NOT NULL DEFAULT 'resend',
    provider_event_id text,
    provider_timestamp timestamptz,
    email_outbox_id uuid REFERENCES public.email_outbox(id) ON DELETE SET NULL,
    error_code text,
    error_message text,
    raw_payload jsonb,
    org_id uuid REFERENCES public.orgs(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT email_bounces_pkey PRIMARY KEY (id),
    CONSTRAINT email_bounces_valid_type CHECK (bounce_type IN ('hard', 'soft', 'complaint'))
);

CREATE INDEX idx_email_bounces_email ON public.email_bounces(email, created_at DESC);
CREATE UNIQUE INDEX idx_email_bounces_provider_event ON public.email_bounces(provider_event_id) WHERE provider_event_id IS NOT NULL;
```

### 2.7 message_templates

**Doel**: Reusable email templates.

```sql
CREATE TABLE public.message_templates (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
    name text NOT NULL,
    description text,
    subject jsonb NOT NULL,
    html_body jsonb NOT NULL,
    text_body jsonb,
    variables_schema jsonb DEFAULT '{}'::jsonb,
    template_type text NOT NULL DEFAULT 'custom',
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid REFERENCES auth.users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT message_templates_pkey PRIMARY KEY (id),
    CONSTRAINT message_templates_valid_type CHECK (template_type IN ('system', 'custom')),
    CONSTRAINT message_templates_unique_name UNIQUE (org_id, name)
);

CREATE INDEX idx_message_templates_org ON public.message_templates(org_id, is_active);
```

---

## 3. RLS Policies

### email_outbox
```sql
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view outbox emails"
    ON public.email_outbox FOR SELECT
    USING (public.is_org_member(org_id));
```

### email_outbox_events
```sql
ALTER TABLE public.email_outbox_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Access via parent email"
    ON public.email_outbox_events FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.email_outbox e
        WHERE e.id = email_outbox_events.email_id
        AND public.is_org_member(e.org_id)
    ));
```

### message_batches
```sql
ALTER TABLE public.message_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view batches"
    ON public.message_batches FOR SELECT
    USING (public.is_org_member(org_id));
```

### message_batch_items
```sql
ALTER TABLE public.message_batch_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Access via parent batch"
    ON public.message_batch_items FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.message_batches b
        WHERE b.id = message_batch_items.batch_id
        AND public.is_org_member(b.org_id)
    ));
```

### email_unsubscribes
```sql
ALTER TABLE public.email_unsubscribes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can check unsubscribe status"
    ON public.email_unsubscribes FOR SELECT
    USING (true);
```

### email_bounces
```sql
ALTER TABLE public.email_bounces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view bounces"
    ON public.email_bounces FOR SELECT
    USING (org_id IS NULL OR public.is_org_member(org_id));
```

### message_templates
```sql
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view templates"
    ON public.message_templates FOR SELECT
    USING (public.is_org_member(org_id));
```

---

## 4. Edge Function Interfaces

### 4.1 process-outbox (Cron)

```typescript
// No external input - triggered by cron
interface ProcessOutboxOutput {
    processed_count: number
    sent_count: number
    failed_count: number
    skipped_count: number
}
```

**Auth**: System only (cron)
**Schedule**: Every 1 minute
**Batch size**: 100

### 4.2 bulk-email

```typescript
interface BulkEmailInput {
    event_id: string
    name: string
    subject: string
    html_body: string
    recipient_filter: RecipientFilter
    scheduled_at?: string
}

type RecipientFilter =
    | { type: 'all' }
    | { type: 'ticket_type'; ticket_type_id: string }
    | { type: 'custom'; participant_ids: string[] }

interface BulkEmailOutput {
    success: boolean
    batch_id: string
    total_recipients: number
}
```

**Auth**: JWT required, owner/admin role

### 4.3 resend-webhook

```typescript
interface ResendWebhookPayload {
    type: 'email.sent' | 'email.delivered' | 'email.bounced' | 'email.complained'
    created_at: string
    data: {
        email_id: string
        from: string
        to: string[]
        subject: string
    }
}
```

**Auth**: Webhook signature verification

### 4.4 unsubscribe

```typescript
interface UnsubscribeInput {
    token: string // Signed JWT with email + org_id + type
}

interface UnsubscribeOutput {
    success: boolean
    message: string
}
```

**Auth**: Token-based (no JWT)

---

## 5. Sequence Diagrams

### 5.1 Single Email Flow

```
Trigger (order paid)
    │
    ├──► INSERT email_outbox (status=queued)
    │
    │        Cron (1 min)
    │            │
    │            ├──► SELECT pending emails
    │            │
    │            ├──► POST to Resend API
    │            │
    │            └──► UPDATE status=sent
    │
    │                    Resend Webhook
    │                        │
    │                        ├──► Verify signature
    │                        │
    │                        ├──► UPDATE status=delivered
    │                        │
    │                        └──► INSERT email_outbox_events
```

### 5.2 Bulk Email Flow

```
Admin POST /bulk-email
    │
    ├──► Verify JWT + role
    │
    ├──► SELECT recipients (filter)
    │
    ├──► Filter unsubscribed/bounced
    │
    ├──► INSERT message_batch
    │
    ├──► INSERT message_batch_items
    │
    └──► Return batch_id
            │
            ASYNC: Create outbox records
                │
                Cron picks up and sends
```

---

## 6. Settings Schema

```typescript
interface CommunicationSettings {
    sender: {
        default_from_name: string
        default_from_email: string       // "noreply@coloss.nl"
        default_reply_to: string | null
    }
    provider: {
        resend: {
            enabled: boolean
            api_key_ref: string          // "env:RESEND_API_KEY"
        }
    }
    bulk: {
        batch_size: number               // 100
        delay_between_batches_ms: number // 1000
        max_recipients_per_campaign: number // 10000
    }
    compliance: {
        unsubscribe_enabled: boolean
        bounce_threshold: number         // 3
        complaint_threshold: number      // 1
    }
    rate_limits: {
        emails_per_minute: number        // 100
        emails_per_hour: number          // 5000
    }
    retry: {
        max_attempts: number             // 3
        initial_delay_ms: number         // 60000
        backoff_multiplier: number       // 2
    }
}
```

---

## 7. Resend Integration

### API Endpoint
`POST https://api.resend.com/emails`

### Webhook Events
| Event | Action |
|-------|--------|
| `email.sent` | Update status to `sent` |
| `email.delivered` | Update status to `delivered` |
| `email.bounced` | Update to `bounced`, record bounce |
| `email.complained` | Update to `complained`, auto-unsubscribe |

### Signature Verification
```typescript
import { Webhook } from 'svix'

const wh = new Webhook(RESEND_WEBHOOK_SECRET)
wh.verify(payload, {
    'svix-id': headers['svix-id'],
    'svix-timestamp': headers['svix-timestamp'],
    'svix-signature': headers['svix-signature']
})
```

---

## 8. Helper Functions

### queue_email (PL/pgSQL)
```sql
CREATE OR REPLACE FUNCTION public.queue_email(
    _org_id uuid,
    _event_id uuid,
    _idempotency_key text,
    _to_email text,
    _subject text,
    _html_body text,
    _email_type text DEFAULT 'transactional'
) RETURNS uuid
```

### is_email_deliverable (PL/pgSQL)
```sql
CREATE OR REPLACE FUNCTION public.is_email_deliverable(
    _email text,
    _org_id uuid,
    _email_type text DEFAULT 'transactional'
) RETURNS boolean
```

---

## 9. Transactional Triggers

| Trigger | Table | Condition | Email |
|---------|-------|-----------|-------|
| `queue_order_confirmation` | `orders` | status → 'paid' | Order confirmation |
| `queue_ticket_email` | `tickets` | INSERT | Ticket delivery |
| `queue_transfer_notification` | `ticket_transfers` | INSERT/UPDATE | Transfer emails |

---

## 10. Testing Strategy

| Level | Focus |
|-------|-------|
| Unit | Template variables, validation, idempotency |
| Integration | Queue → Outbox → Resend → Webhook |
| RLS | org_id isolation, cross-tenant prevention |
| E2E | Order paid → Email delivered |

---

*Architecture Document v1.0 - Generated 2025-01-27*
