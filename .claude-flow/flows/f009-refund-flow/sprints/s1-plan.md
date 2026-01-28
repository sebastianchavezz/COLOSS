# F009 Sprint 1: Refund Flow - Database + Mollie Integration

## Sprint Goal
Implementeer een waterdichte refund backend die:
1. Refunds opslaat in database met volledige audit trail
2. Integreert met Mollie Refunds API
3. Webhook updates correct verwerkt
4. Tickets void maakt bij full refund
5. Email notificaties stuurt

## Scope

### In Scope
- `refunds` table met status tracking
- `refund_items` table voor partial refunds
- Edge Function: `create-refund`
- Mollie webhook extension voor refund events
- RLS policies voor org-level access
- Audit logging
- Email notification via outbox
- Ticket voiding logic

### Out of Scope
- UI components (Sprint 2)
- Dashboard views (Sprint 2)
- Batch refunds

## Technical Requirements

### Database Schema

```sql
-- Refund status enum
CREATE TYPE refund_status AS ENUM (
  'pending',    -- Created, waiting for Mollie processing
  'queued',     -- Mollie: waiting for balance
  'processing', -- Mollie: being processed
  'refunded',   -- Complete
  'failed',     -- Failed
  'canceled'    -- Canceled before processing
);

-- Main refunds table
CREATE TABLE refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  order_id UUID NOT NULL REFERENCES orders(id),
  payment_id UUID NOT NULL REFERENCES payments(id),

  -- Mollie reference
  mollie_refund_id TEXT,

  -- Amounts (in cents)
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'EUR',

  -- Status
  status refund_status NOT NULL DEFAULT 'pending',

  -- Metadata
  reason TEXT,
  internal_note TEXT,

  -- Idempotency
  idempotency_key UUID NOT NULL UNIQUE,

  -- Actor
  created_by UUID NOT NULL REFERENCES auth.users(id),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  refunded_at TIMESTAMPTZ,

  -- Constraints
  CONSTRAINT refund_amount_positive CHECK (amount > 0)
);

-- Refund items for partial refunds
CREATE TABLE refund_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id UUID NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
  order_item_id UUID NOT NULL REFERENCES order_items(id),
  ticket_instance_id UUID REFERENCES ticket_instances(id),

  quantity INTEGER NOT NULL CHECK (quantity > 0),
  amount INTEGER NOT NULL CHECK (amount >= 0),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Edge Function: create-refund

```
POST /functions/v1/create-refund
Authorization: Bearer <user_token>

{
  "order_id": "uuid",
  "amount": 1500,           // Optional: cents, omit for full refund
  "items": [                // Optional: for partial refunds
    { "order_item_id": "uuid", "quantity": 1 }
  ],
  "reason": "Customer request",
  "idempotency_key": "uuid" // Required for deduplication
}
```

### Mollie API Integration

```
POST https://api.mollie.com/v2/payments/{paymentId}/refunds
Authorization: Bearer <MOLLIE_API_KEY>

{
  "amount": { "currency": "EUR", "value": "15.00" },
  "description": "Refund for order #abc123"
}
```

### Webhook Extension

Extend `mollie-webhook` to handle:
- `refund.queued`
- `refund.pending`
- `refund.refunded`
- `refund.failed`
- `refund.canceled`

## Acceptance Criteria

- [ ] Create full refund via Edge Function
- [ ] Create partial refund with item selection
- [ ] Idempotency: same key returns same result
- [ ] Mollie API call succeeds
- [ ] Webhook updates refund status
- [ ] Tickets voided on full refund
- [ ] Email sent on refund completion
- [ ] Audit log entry created
- [ ] RLS: only org admin/owner can create
- [ ] Cannot refund more than original amount
- [ ] Cannot refund already refunded order

## Test Cases

1. Full refund happy path
2. Partial refund happy path
3. Idempotency test (duplicate key)
4. Over-refund prevention
5. Unauthorized user blocked
6. Webhook status updates
7. Ticket voiding verification

---

*Sprint Start: 2026-01-28*
