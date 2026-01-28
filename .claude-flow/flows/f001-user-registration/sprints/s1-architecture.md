# F001 Sprint S1: Architecture Design

## Metadata

| Field | Value |
|-------|-------|
| **Flow** | F001 - User Registration |
| **Sprint** | S1 |
| **Author** | @architect |
| **Date** | 2026-01-28 |
| **Status** | ✅ Approved |

---

## Overview

This sprint adds the post-purchase registration sync logic. The key insight is that registration should be **derived from orders**, not separately managed. When an order is paid, the registration is automatically created.

## Architecture Decision Records

### ADR-1: Registration Uniqueness via order_id

**Decision**: Use `registrations.order_id` as the unique key (not event_id + participant_id).

**Rationale**: 
- One person can buy multiple orders for the same event (e.g., for family members)
- Each order represents one "registration transaction"
- Prevents duplicates on webhook retry (same order_id = same registration)

**Consequence**: Existing unique constraint `(event_id, participant_id)` must be changed to `(event_id, order_id)`.

### ADR-2: Participant Upsert by Email

**Decision**: Use email as the natural key for participant upsert.

**Rationale**:
- Orders always have email (required field)
- Guest purchases don't have user_id
- ON CONFLICT (email) DO UPDATE handles re-orders

**Consequence**: Add unique index on `participants.email`.

### ADR-3: Trigger-Based Sync vs Edge Function Call

**Decision**: Use database trigger on orders table instead of Edge Function call.

**Rationale**:
- Atomic: registration created in same transaction as order status update
- No network hop: faster and more reliable
- Already have `handle_payment_status` RPC that updates order status

**Consequence**: Trigger calls `sync_registration_on_payment()` when `NEW.status = 'paid' AND OLD.status != 'paid'`.

---

## Schema Changes

### 1. Modify `participants` Table

```sql
-- Add phone and locale for profile completeness
ALTER TABLE public.participants 
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS locale text DEFAULT 'nl';

-- Add unique constraint on email for upsert
CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_email_unique 
  ON public.participants(email);
```

### 2. Modify `registrations` Table

```sql
-- Add order_id for idempotency
ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.orders(id);

-- Change unique constraint from (event_id, participant_id) to (event_id, order_id)
ALTER TABLE public.registrations
  DROP CONSTRAINT IF EXISTS registrations_event_participant_unique;
  
CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_event_order_unique
  ON public.registrations(event_id, order_id);

-- Add index for order lookup
CREATE INDEX IF NOT EXISTS idx_registrations_order_id
  ON public.registrations(order_id);
```

### 3. Modify `ticket_instances` Table

```sql
-- Add participant_id for ticket ownership
ALTER TABLE public.ticket_instances
  ADD COLUMN IF NOT EXISTS participant_id uuid 
    REFERENCES public.participants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ticket_instances_participant_id
  ON public.ticket_instances(participant_id);
```

---

## RPC Functions

### sync_registration_on_payment(p_order_id uuid)

```sql
CREATE OR REPLACE FUNCTION public.sync_registration_on_payment(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_participant_id uuid;
  v_registration_id uuid;
  v_existing_registration_id uuid;
  v_org_id uuid;
  v_ticket_count integer;
BEGIN
  -- 1. Fetch order with event info
  SELECT o.*, e.org_id, e.name as event_name
  INTO v_order
  FROM public.orders o
  JOIN public.events e ON e.id = o.event_id
  WHERE o.id = p_order_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND');
  END IF;
  
  IF v_order.status != 'paid' THEN
    RETURN jsonb_build_object('error', 'ORDER_NOT_PAID', 'status', v_order.status);
  END IF;
  
  v_org_id := v_order.org_id;
  
  -- 2. Check if registration already exists (idempotency)
  SELECT id INTO v_existing_registration_id
  FROM public.registrations
  WHERE order_id = p_order_id;
  
  IF v_existing_registration_id IS NOT NULL THEN
    -- Already synced, return existing data
    RETURN jsonb_build_object(
      'status', 'ALREADY_SYNCED',
      'registration_id', v_existing_registration_id
    );
  END IF;
  
  -- 3. Upsert participant by email
  INSERT INTO public.participants (email, first_name, last_name, user_id)
  VALUES (
    v_order.email,
    COALESCE((v_order.metadata->>'first_name'), 'Guest'),
    COALESCE((v_order.metadata->>'last_name'), ''),
    v_order.user_id
  )
  ON CONFLICT (email) DO UPDATE SET
    user_id = COALESCE(EXCLUDED.user_id, participants.user_id),
    updated_at = now()
  RETURNING id INTO v_participant_id;
  
  -- 4. Create registration
  INSERT INTO public.registrations (event_id, participant_id, order_id, status)
  VALUES (v_order.event_id, v_participant_id, p_order_id, 'confirmed')
  RETURNING id INTO v_registration_id;
  
  -- 5. Link all ticket_instances to participant
  UPDATE public.ticket_instances
  SET participant_id = v_participant_id
  WHERE order_id = p_order_id
    AND participant_id IS NULL;
  
  GET DIAGNOSTICS v_ticket_count = ROW_COUNT;
  
  -- 6. Queue confirmation email via outbox
  INSERT INTO public.email_outbox (
    org_id,
    to_email,
    to_name,
    email_type,
    template_key,
    template_data,
    idempotency_key
  ) VALUES (
    v_org_id,
    v_order.email,
    COALESCE((v_order.metadata->>'first_name'), 'Guest'),
    'transactional',
    'order_confirmation',
    jsonb_build_object(
      'order_id', p_order_id,
      'registration_id', v_registration_id,
      'event_name', v_order.event_name,
      'ticket_count', v_ticket_count
    ),
    'order_confirmation_' || p_order_id::text
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
  
  -- 7. Audit log
  INSERT INTO public.audit_log (
    resource_type,
    resource_id,
    action,
    actor_id,
    metadata
  ) VALUES (
    'registration',
    v_registration_id,
    'REGISTRATION_CREATED',
    v_order.user_id,
    jsonb_build_object(
      'order_id', p_order_id,
      'participant_id', v_participant_id,
      'tickets_linked', v_ticket_count
    )
  );
  
  RETURN jsonb_build_object(
    'status', 'SYNCED',
    'participant_id', v_participant_id,
    'registration_id', v_registration_id,
    'tickets_linked', v_ticket_count
  );
END;
$$;
```

### Trigger: Auto-sync on Order Paid

```sql
CREATE OR REPLACE FUNCTION public.trigger_sync_registration_on_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only trigger when status changes TO 'paid'
  IF NEW.status = 'paid' AND (OLD.status IS NULL OR OLD.status != 'paid') THEN
    PERFORM public.sync_registration_on_payment(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_order_paid_sync_registration
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_sync_registration_on_paid();
```

---

## Organizer View

```sql
CREATE OR REPLACE VIEW public.organiser_registrations_view AS
SELECT 
  r.id as registration_id,
  r.event_id,
  r.status as registration_status,
  r.created_at as registered_at,
  
  -- Participant info
  p.id as participant_id,
  p.email,
  p.first_name,
  p.last_name,
  p.phone,
  p.user_id,
  
  -- Order info
  o.id as order_id,
  o.status as order_status,
  o.total_amount,
  o.created_at as order_date,
  
  -- Ticket summary
  (SELECT COUNT(*) FROM public.ticket_instances ti WHERE ti.order_id = o.id) as ticket_count,
  (SELECT array_agg(DISTINCT tt.name) 
   FROM public.ticket_instances ti 
   JOIN public.ticket_types tt ON ti.ticket_type_id = tt.id 
   WHERE ti.order_id = o.id) as ticket_types,
  
  -- Event info for filtering
  e.org_id,
  e.name as event_name
  
FROM public.registrations r
JOIN public.participants p ON r.participant_id = p.id
JOIN public.orders o ON r.order_id = o.id
JOIN public.events e ON r.event_id = e.id;

-- Security invoker for RLS
ALTER VIEW public.organiser_registrations_view SET (security_invoker = true);
```

---

## RLS Updates

```sql
-- Allow org members to query the view
-- (The view uses security_invoker so underlying table policies apply)

-- No additional policies needed if existing registrations/orders policies are correct
-- But we should verify org members can see registrations for their events

-- Ensure organizers can UPDATE registrations (e.g., cancel)
CREATE POLICY IF NOT EXISTS "Org members can update registrations"
  ON public.registrations
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = registrations.event_id
      AND public.is_org_member(e.org_id)
    )
  );
```

---

## Sequence Diagram

```
┌─────────┐    ┌──────────┐    ┌─────────────┐    ┌────────────┐
│ Mollie  │    │ Webhook  │    │  Database   │    │  Outbox    │
│ Payment │    │   EF     │    │ (Trigger)   │    │  Worker    │
└────┬────┘    └────┬─────┘    └──────┬──────┘    └─────┬──────┘
     │              │                 │                  │
     │ payment.paid │                 │                  │
     │─────────────>│                 │                  │
     │              │                 │                  │
     │              │ UPDATE orders   │                  │
     │              │ SET status=paid │                  │
     │              │────────────────>│                  │
     │              │                 │                  │
     │              │                 │──┐ TRIGGER       │
     │              │                 │  │ sync_reg..()  │
     │              │                 │<─┘               │
     │              │                 │                  │
     │              │                 │ INSERT           │
     │              │                 │ participant      │
     │              │                 │ registration     │
     │              │                 │ UPDATE tickets   │
     │              │                 │ INSERT outbox    │
     │              │                 │                  │
     │              │       200 OK    │                  │
     │              │<────────────────│                  │
     │              │                 │                  │
     │              │                 │    poll outbox   │
     │              │                 │<─────────────────│
     │              │                 │                  │
     │              │                 │  email_outbox    │
     │              │                 │─────────────────>│
     │              │                 │                  │
     │              │                 │                  │ Send email
     │              │                 │                  │─────>
```

---

## File Structure

```
supabase/migrations/
└── 20250128XXXXXX_f001_user_registration.sql   # All schema + RPC + triggers
```

---

## Test Cases

| ID | Test | Expected |
|----|------|----------|
| T1 | Call sync on paid order | Registration created, participant upserted |
| T2 | Call sync twice | Second call returns ALREADY_SYNCED |
| T3 | Call sync on pending order | Returns ORDER_NOT_PAID error |
| T4 | Order paid triggers registration | Trigger auto-creates registration |
| T5 | Organizer view accessible | Returns registrations for org events |
| T6 | Anon cannot call sync | RPC denied |

---

*Architecture Design - F001 User Registration*
