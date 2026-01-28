# F009 Sprint 1: Architecture Design

## Overview

Waterdichte refund implementatie met:
- Database tracking van alle refunds
- Mollie Refunds API integratie
- Webhook handling voor status updates
- Idempotency voor deduplicatie
- Ticket voiding bij full refund
- Email notificatie

## Mollie Refunds API

### Create Refund
```
POST https://api.mollie.com/v2/payments/{paymentId}/refunds
Authorization: Bearer <MOLLIE_API_KEY>

{
  "amount": {
    "currency": "EUR",
    "value": "15.00"
  },
  "description": "Refund for order #abc123"
}
```

### Refund Statuses (from Mollie)
| Status | Beschrijving | Action |
|--------|-------------|--------|
| `queued` | Wacht op balance | Track in DB |
| `pending` | Wordt verwerkt | Track in DB |
| `processing` | Onderweg naar bank | Track in DB |
| `refunded` | Voltooid | Void tickets, send email |
| `failed` | Mislukt | Alert organizer |

### Best Practices (from Mollie docs)
1. **Idempotency**: Use unique key per refund attempt
2. **Partial refunds**: Supported, multiple allowed
3. **Balance**: Refunds deducted from available balance
4. **Cancellation**: Possible within 2 hours (queued/pending)
5. **Retry on 503**: Safe to retry, refund not executed

## Database Schema

### Migration: 20250128150000_f009_refunds.sql

```sql
-- Refund status enum
CREATE TYPE refund_status AS ENUM (
  'pending',     -- Created locally, not yet sent to Mollie
  'queued',      -- Mollie: waiting for balance
  'processing',  -- Mollie: being processed
  'refunded',    -- Complete
  'failed',      -- Failed at Mollie
  'canceled'     -- Canceled before processing
);

-- Main refunds table
CREATE TABLE public.refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.orgs(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,

  -- Mollie reference
  mollie_refund_id TEXT UNIQUE,
  mollie_payment_id TEXT NOT NULL,

  -- Amount (in cents for precision)
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'EUR',

  -- Status tracking
  status refund_status NOT NULL DEFAULT 'pending',

  -- Metadata
  reason TEXT,
  internal_note TEXT,
  description TEXT,

  -- Idempotency (client provides this)
  idempotency_key UUID NOT NULL UNIQUE,

  -- Tracking
  is_full_refund BOOLEAN NOT NULL DEFAULT false,
  tickets_voided BOOLEAN NOT NULL DEFAULT false,
  email_sent BOOLEAN NOT NULL DEFAULT false,

  -- Actor
  created_by UUID NOT NULL REFERENCES auth.users(id),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  refunded_at TIMESTAMPTZ,

  -- Ensure refund amount doesn't exceed payment
  CONSTRAINT refund_amount_positive CHECK (amount_cents > 0)
);

-- Refund items (for partial refunds tracking)
CREATE TABLE public.refund_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id UUID NOT NULL REFERENCES public.refunds(id) ON DELETE CASCADE,
  order_item_id UUID NOT NULL REFERENCES public.order_items(id) ON DELETE RESTRICT,
  ticket_instance_id UUID REFERENCES public.ticket_instances(id),

  -- What's being refunded
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Prevent double-refunding same item
  UNIQUE(refund_id, order_item_id)
);

-- Indexes
CREATE INDEX idx_refunds_org_id ON public.refunds(org_id);
CREATE INDEX idx_refunds_order_id ON public.refunds(order_id);
CREATE INDEX idx_refunds_status ON public.refunds(status);
CREATE INDEX idx_refunds_mollie_refund_id ON public.refunds(mollie_refund_id);
CREATE INDEX idx_refund_items_refund_id ON public.refund_items(refund_id);
```

### RLS Policies

```sql
-- Enable RLS
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_items ENABLE ROW LEVEL SECURITY;

-- Org admins/owners can view refunds
CREATE POLICY "Org admins can view refunds"
ON public.refunds FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.org_members om
    WHERE om.org_id = refunds.org_id
    AND om.user_id = auth.uid()
    AND om.role IN ('owner', 'admin')
  )
);

-- Org admins/owners can create refunds
CREATE POLICY "Org admins can create refunds"
ON public.refunds FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.org_members om
    WHERE om.org_id = refunds.org_id
    AND om.user_id = auth.uid()
    AND om.role IN ('owner', 'admin')
  )
);

-- Service role can update (for webhook)
CREATE POLICY "Service can update refunds"
ON public.refunds FOR UPDATE
TO service_role
USING (true);

-- Refund items follow parent
CREATE POLICY "View refund items via parent"
ON public.refund_items FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.refunds r
    JOIN public.org_members om ON om.org_id = r.org_id
    WHERE r.id = refund_items.refund_id
    AND om.user_id = auth.uid()
    AND om.role IN ('owner', 'admin')
  )
);

CREATE POLICY "Insert refund items via parent"
ON public.refund_items FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.refunds r
    JOIN public.org_members om ON om.org_id = r.org_id
    WHERE r.id = refund_items.refund_id
    AND om.user_id = auth.uid()
    AND om.role IN ('owner', 'admin')
  )
);
```

## Edge Function: create-refund

### Endpoint
```
POST /functions/v1/create-refund
Authorization: Bearer <user_token>
```

### Request Body
```typescript
interface CreateRefundRequest {
  order_id: string;           // Required: order to refund
  amount_cents?: number;      // Optional: partial amount in cents
  items?: RefundItemRequest[];// Optional: specific items
  reason?: string;            // Optional: customer-facing reason
  internal_note?: string;     // Optional: internal note
  idempotency_key: string;    // Required: UUID for deduplication
}

interface RefundItemRequest {
  order_item_id: string;
  quantity: number;
}
```

### Flow
1. Verify auth (org admin/owner)
2. Validate order exists and is paid
3. Check idempotency key (return existing if duplicate)
4. Calculate refund amount (full or partial)
5. Validate not exceeding remaining refundable amount
6. Create refund record in DB
7. Call Mollie Refunds API
8. Update refund with mollie_refund_id
9. Create audit log entry
10. Return refund details

### Response
```typescript
interface CreateRefundResponse {
  success: boolean;
  refund: {
    id: string;
    status: string;
    amount_cents: number;
    mollie_refund_id: string;
    is_full_refund: boolean;
  };
  message?: string;
}
```

## Webhook Extension

Extend `mollie-webhook` to handle refund events:

```typescript
// In mollie-webhook/index.ts
// Check if this is a refund webhook
if (molliePaymentId.startsWith('re_')) {
  // This is a refund - fetch from refunds API
  const refundResponse = await fetch(
    `https://api.mollie.com/v2/refunds/${molliePaymentId}`,
    { headers: { 'Authorization': `Bearer ${mollieApiKey}` } }
  );
  // ... handle refund status update
}
```

### Refund Status Updates
| Mollie Status | DB Action | Side Effects |
|--------------|-----------|--------------|
| `queued` | Update status | - |
| `pending` | Update status | - |
| `processing` | Update status | - |
| `refunded` | Update status + refunded_at | Void tickets, queue email |
| `failed` | Update status | Queue alert to org |

## RPC: void_tickets_for_refund

```sql
CREATE OR REPLACE FUNCTION public.void_tickets_for_refund(_refund_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_refund RECORD;
  v_voided_count INT := 0;
BEGIN
  -- Get refund details
  SELECT * INTO v_refund FROM public.refunds WHERE id = _refund_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'REFUND_NOT_FOUND');
  END IF;

  -- Only void for full refunds that are completed
  IF NOT v_refund.is_full_refund OR v_refund.status != 'refunded' THEN
    RETURN jsonb_build_object('error', 'NOT_FULL_REFUND_OR_NOT_COMPLETE');
  END IF;

  -- Void all tickets for this order
  UPDATE public.ticket_instances
  SET status = 'void', updated_at = now()
  WHERE order_id = v_refund.order_id
  AND status != 'void'
  RETURNING 1 INTO v_voided_count;

  -- Mark refund as having voided tickets
  UPDATE public.refunds
  SET tickets_voided = true, updated_at = now()
  WHERE id = _refund_id;

  -- Audit log
  INSERT INTO public.audit_log (
    org_id, user_id, action,
    resource_type, resource_id,
    entity_type, entity_id,
    details
  ) VALUES (
    v_refund.org_id, v_refund.created_by, 'tickets_voided',
    'refund', _refund_id,
    'refund', _refund_id,
    jsonb_build_object('order_id', v_refund.order_id, 'voided_count', v_voided_count)
  );

  RETURN jsonb_build_object('status', 'OK', 'voided_count', v_voided_count);
END;
$$;
```

## RPC: get_order_refund_summary

```sql
CREATE OR REPLACE FUNCTION public.get_order_refund_summary(_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order RECORD;
  v_total_refunded INT := 0;
  v_refunds JSONB;
BEGIN
  -- Get order
  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND');
  END IF;

  -- Calculate total refunded (only completed refunds)
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_total_refunded
  FROM public.refunds
  WHERE order_id = _order_id
  AND status = 'refunded';

  -- Get all refunds for this order
  SELECT jsonb_agg(jsonb_build_object(
    'id', r.id,
    'amount_cents', r.amount_cents,
    'status', r.status,
    'reason', r.reason,
    'created_at', r.created_at,
    'refunded_at', r.refunded_at
  )) INTO v_refunds
  FROM public.refunds r
  WHERE r.order_id = _order_id
  ORDER BY r.created_at DESC;

  RETURN jsonb_build_object(
    'order_id', _order_id,
    'total_amount_cents', (v_order.total_amount * 100)::INT,
    'total_refunded_cents', v_total_refunded,
    'remaining_refundable_cents', (v_order.total_amount * 100)::INT - v_total_refunded,
    'is_fully_refunded', v_total_refunded >= (v_order.total_amount * 100)::INT,
    'refunds', COALESCE(v_refunds, '[]'::JSONB)
  );
END;
$$;
```

## File Structure

```
supabase/
├── migrations/
│   └── 20250128150000_f009_refunds.sql
└── functions/
    ├── create-refund/
    │   └── index.ts
    └── mollie-webhook/
        └── index.ts  (extended for refunds)
```

## Error Handling

| Error | Code | Action |
|-------|------|--------|
| Order not found | ORDER_NOT_FOUND | Return 404 |
| Order not paid | ORDER_NOT_PAID | Return 400 |
| Already fully refunded | ALREADY_REFUNDED | Return 400 |
| Amount exceeds refundable | EXCEEDS_REFUNDABLE | Return 400 |
| Duplicate idempotency key | - | Return existing refund |
| Mollie API error | MOLLIE_ERROR | Return 502, mark pending |
| Unauthorized | UNAUTHORIZED | Return 403 |

## Mollie Test/Sandbox Setup

Voor development:
1. Login op Mollie Dashboard
2. Switch naar "Test mode"
3. Gebruik test API key (`test_...`)
4. Test payments kunnen direct gerefund worden

Test IDs voor refunds:
- Payment `tr_test123` → Refund succeeds
- Use Mollie test amounts for specific scenarios

---

*Architecture: 2026-01-28*
