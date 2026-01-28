# Sprint S2: Architecture

**Flow**: F005 Ticket Selection
**Sprint**: S2
**Date**: 2026-01-28

---

## Overview

Complete ticket selection with availability tracking, limits enforcement, and enhanced UI.

---

## Database Design

### RPC: get_ticket_availability

Returns all ticket types for an event with real-time availability.

```sql
CREATE OR REPLACE FUNCTION public.get_ticket_availability(_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'status', 'OK',
    'ticket_types', COALESCE(jsonb_agg(ticket_row ORDER BY sort_order, price), '[]'::jsonb)
  ) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', tt.id,
      'name', tt.name,
      'description', tt.description,
      'price', tt.price,
      'currency', COALESCE(tt.currency, 'EUR'),
      'vat_percentage', tt.vat_percentage,
      'capacity_total', tt.capacity_total,
      'sold_count', COALESCE(sold.count, 0),
      'available_count', GREATEST(tt.capacity_total - COALESCE(sold.count, 0), 0),
      'is_sold_out', tt.capacity_total <= COALESCE(sold.count, 0),
      'distance_value', tt.distance_value,
      'distance_unit', tt.distance_unit,
      'ticket_category', tt.ticket_category,
      'max_per_participant', tt.max_per_participant,
      'sales_start', tt.sales_start,
      'sales_end', tt.sales_end,
      'on_sale', (
        (tt.sales_start IS NULL OR tt.sales_start <= now())
        AND (tt.sales_end IS NULL OR tt.sales_end > now())
      ),
      'time_slots', COALESCE(slots.slots, '[]'::jsonb)
    ) as ticket_row,
    tt.sort_order,
    tt.price
    FROM ticket_types tt
    LEFT JOIN LATERAL (
      SELECT COUNT(*) as count
      FROM ticket_instances ti
      WHERE ti.ticket_type_id = tt.id
        AND ti.status != 'void'
    ) sold ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', ts.id,
          'slot_time', ts.slot_time,
          'slot_date', ts.slot_date,
          'label', ts.label,
          'capacity', ts.capacity,
          'sold_count', COALESCE(slot_sold.count, 0),
          'available_count', GREATEST(
            COALESCE(ts.capacity, tt.capacity_total) - COALESCE(slot_sold.count, 0),
            0
          )
        ) ORDER BY ts.slot_date NULLS FIRST, ts.slot_time
      ) as slots
      FROM ticket_time_slots ts
      LEFT JOIN LATERAL (
        SELECT COUNT(*) as count
        FROM ticket_instances ti
        WHERE ti.ticket_type_id = tt.id
          AND ti.status != 'void'
          -- Note: would need time_slot_id on ticket_instances for per-slot tracking
      ) slot_sold ON true
      WHERE ts.ticket_type_id = tt.id
        AND ts.deleted_at IS NULL
    ) slots ON true
    WHERE tt.event_id = _event_id
      AND tt.deleted_at IS NULL
      AND tt.status = 'published'
      AND tt.visibility = 'visible'
  ) sub;

  IF v_result IS NULL THEN
    v_result := jsonb_build_object('status', 'OK', 'ticket_types', '[]'::jsonb);
  END IF;

  RETURN v_result;
END;
$$;
```

### RPC: validate_ticket_order

Pre-validates an order before submission.

```sql
CREATE OR REPLACE FUNCTION public.validate_ticket_order(
  _event_id uuid,
  _items jsonb  -- [{ticket_type_id, quantity}]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item record;
  v_ticket record;
  v_errors jsonb := '[]'::jsonb;
  v_sold int;
  v_available int;
BEGIN
  -- Check event exists and is published
  IF NOT EXISTS (
    SELECT 1 FROM events
    WHERE id = _event_id
      AND status = 'published'
      AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('valid', false, 'errors', jsonb_build_array('EVENT_NOT_FOUND'));
  END IF;

  -- Validate each item
  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(ticket_type_id uuid, quantity int)
  LOOP
    -- Get ticket type
    SELECT * INTO v_ticket
    FROM ticket_types
    WHERE id = v_item.ticket_type_id
      AND event_id = _event_id
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
      v_errors := v_errors || jsonb_build_object(
        'ticket_type_id', v_item.ticket_type_id,
        'error', 'TICKET_TYPE_NOT_FOUND'
      );
      CONTINUE;
    END IF;

    -- Check visibility
    IF v_ticket.visibility != 'visible' THEN
      v_errors := v_errors || jsonb_build_object(
        'ticket_type_id', v_item.ticket_type_id,
        'error', 'TICKET_NOT_AVAILABLE'
      );
      CONTINUE;
    END IF;

    -- Check sales window
    IF v_ticket.sales_start IS NOT NULL AND v_ticket.sales_start > now() THEN
      v_errors := v_errors || jsonb_build_object(
        'ticket_type_id', v_item.ticket_type_id,
        'error', 'SALES_NOT_STARTED'
      );
      CONTINUE;
    END IF;

    IF v_ticket.sales_end IS NOT NULL AND v_ticket.sales_end < now() THEN
      v_errors := v_errors || jsonb_build_object(
        'ticket_type_id', v_item.ticket_type_id,
        'error', 'SALES_ENDED'
      );
      CONTINUE;
    END IF;

    -- Get sold count
    SELECT COUNT(*) INTO v_sold
    FROM ticket_instances ti
    WHERE ti.ticket_type_id = v_item.ticket_type_id
      AND ti.status != 'void';

    v_available := v_ticket.capacity_total - v_sold;

    -- Check capacity
    IF v_item.quantity > v_available THEN
      v_errors := v_errors || jsonb_build_object(
        'ticket_type_id', v_item.ticket_type_id,
        'error', 'INSUFFICIENT_CAPACITY',
        'requested', v_item.quantity,
        'available', v_available
      );
      CONTINUE;
    END IF;

    -- Check max per participant
    IF v_ticket.max_per_participant IS NOT NULL AND v_item.quantity > v_ticket.max_per_participant THEN
      v_errors := v_errors || jsonb_build_object(
        'ticket_type_id', v_item.ticket_type_id,
        'error', 'EXCEEDS_MAX_PER_PARTICIPANT',
        'requested', v_item.quantity,
        'max', v_ticket.max_per_participant
      );
      CONTINUE;
    END IF;
  END LOOP;

  IF jsonb_array_length(v_errors) > 0 THEN
    RETURN jsonb_build_object('valid', false, 'errors', v_errors);
  END IF;

  RETURN jsonb_build_object('valid', true, 'errors', '[]'::jsonb);
END;
$$;
```

---

## Frontend Design

### Enhanced PublicEventCheckout

```typescript
// New state
const [availability, setAvailability] = useState<TicketAvailability[]>([])

// Fetch availability instead of raw tickets
useEffect(() => {
  const { data } = await supabase.rpc('get_ticket_availability', {
    _event_id: event.id
  })
  setAvailability(data.ticket_types)
}, [event])

// Enhanced ticket card
<TicketCard
  ticket={ticket}
  quantity={quantities[ticket.id] || 0}
  onQuantityChange={(delta) => handleQuantityChange(ticket.id, delta)}
  maxQuantity={Math.min(
    ticket.available_count,
    ticket.max_per_participant || 99
  )}
  disabled={ticket.is_sold_out || !ticket.on_sale}
/>

// Pre-validate before checkout
const handleCheckout = async () => {
  const validation = await supabase.rpc('validate_ticket_order', {
    _event_id: event.id,
    _items: items
  })
  if (!validation.data.valid) {
    setErrors(validation.data.errors)
    return
  }
  // Proceed with order
}
```

### TicketCard Component

```tsx
function TicketCard({ ticket, quantity, onQuantityChange, maxQuantity, disabled }) {
  return (
    <div className={`border rounded-lg p-4 ${disabled ? 'opacity-50' : ''}`}>
      {/* Header with name + badges */}
      <div className="flex justify-between">
        <h3>{ticket.name}</h3>
        <div className="flex gap-2">
          {ticket.distance_value && (
            <span className="badge">{ticket.distance_value} {ticket.distance_unit}</span>
          )}
          {ticket.is_sold_out && (
            <span className="badge bg-red-100 text-red-800">Sold Out</span>
          )}
        </div>
      </div>

      {/* Availability */}
      <p className="text-sm text-gray-500">
        {ticket.available_count} of {ticket.capacity_total} available
      </p>

      {/* Price + Quantity */}
      <div className="flex justify-between items-center mt-4">
        <span className="font-bold">{formatPrice(ticket.price)}</span>
        <QuantitySelector
          value={quantity}
          onChange={onQuantityChange}
          min={0}
          max={maxQuantity}
          disabled={disabled}
        />
      </div>
    </div>
  )
}
```

---

## File Structure

```
supabase/migrations/
└── 20250128160000_f005_s2_availability_rpcs.sql  # NEW

web/src/pages/public/
└── PublicEventCheckout.tsx  # UPDATE
```

---

*Architecture - F005 S2 - 2026-01-28*
