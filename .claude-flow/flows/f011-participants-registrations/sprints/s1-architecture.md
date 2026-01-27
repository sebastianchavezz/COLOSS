# Architecture: F011 Participants/Registrations List + Export

## Overview

Dit document beschrijft de technische architectuur voor de Registraties list view met Atleta-achtige filtering en CSV export.

---

## Database Schema

### Current State
- `orders` has: org_id, discount_amount, subtotal_amount (already exists)
- `ticket_instances` has: order_item_id column (needs to be added)
- `registrations` has: ticket_type_id, order_item_id (exists)

### Missing Column
```sql
-- ticket_instances needs order_item_id for proper linking
ALTER TABLE ticket_instances ADD COLUMN IF NOT EXISTS order_item_id UUID
  REFERENCES order_items(id) ON DELETE SET NULL;
```

---

## View: `registrations_list_v`

Security-invoker view voor directe RLS access:

```sql
CREATE OR REPLACE VIEW registrations_list_v AS
SELECT
  r.id,
  r.event_id,
  r.participant_id,
  r.status as registration_status,
  r.ticket_type_id,
  r.order_item_id,
  r.bib_number,
  r.created_at,
  r.updated_at,
  -- Participant
  p.email,
  p.first_name,
  p.last_name,
  p.phone,
  p.birth_date,
  p.gender,
  p.country,
  -- Ticket Type
  tt.name as ticket_type_name,
  tt.price as ticket_type_price,
  -- Order via order_item
  oi.order_id,
  o.status as order_status,
  o.total_amount as order_total,
  o.discount_amount,
  CASE
    WHEN o.status = 'paid' THEN 'paid'
    WHEN o.status = 'refunded' THEN 'refunded'
    WHEN o.status = 'cancelled' THEN 'cancelled'
    ELSE 'unpaid'
  END as payment_status,
  COALESCE(o.discount_amount > 0, false) as has_discount,
  -- Ticket Instance (via order_item_id)
  ti.id as ticket_instance_id,
  ti.qr_code,
  ti.status as ticket_status,
  ti.checked_in_at,
  CASE WHEN ti.id IS NOT NULL THEN 'assigned' ELSE 'unassigned' END as assignment_status,
  -- Event org_id for RLS
  e.org_id
FROM registrations r
JOIN participants p ON p.id = r.participant_id
JOIN events e ON e.id = r.event_id
LEFT JOIN ticket_types tt ON tt.id = r.ticket_type_id
LEFT JOIN order_items oi ON oi.id = r.order_item_id
LEFT JOIN orders o ON o.id = oi.order_id
LEFT JOIN ticket_instances ti ON ti.order_item_id = r.order_item_id
  AND ti.deleted_at IS NULL
WHERE r.deleted_at IS NULL;

ALTER VIEW registrations_list_v SET (security_invoker = true);
```

---

## Trigger: Sync Registration on Order Paid

```sql
CREATE OR REPLACE FUNCTION sync_registration_on_order_paid()
RETURNS TRIGGER AS $$
DECLARE
  v_item RECORD;
  v_participant_id UUID;
  v_registration_id UUID;
BEGIN
  -- Only trigger on status change to 'paid'
  IF NEW.status = 'paid' AND (OLD.status IS NULL OR OLD.status <> 'paid') THEN

    -- Loop through order items
    FOR v_item IN
      SELECT oi.*, tt.event_id
      FROM order_items oi
      JOIN ticket_types tt ON tt.id = oi.ticket_type_id
      WHERE oi.order_id = NEW.id
    LOOP
      -- 1. Upsert participant by email
      INSERT INTO participants (email, first_name, last_name, user_id)
      VALUES (
        NEW.email,
        COALESCE((NEW.metadata->>'first_name')::text, 'Guest'),
        COALESCE((NEW.metadata->>'last_name')::text, ''),
        NEW.user_id
      )
      ON CONFLICT (email) WHERE deleted_at IS NULL
      DO UPDATE SET
        user_id = COALESCE(participants.user_id, EXCLUDED.user_id),
        updated_at = NOW()
      RETURNING id INTO v_participant_id;

      -- 2. Upsert registration (idempotent by order_item_id)
      INSERT INTO registrations (
        event_id,
        participant_id,
        ticket_type_id,
        order_item_id,
        status
      )
      VALUES (
        v_item.event_id,
        v_participant_id,
        v_item.ticket_type_id,
        v_item.id,
        'confirmed'
      )
      ON CONFLICT (order_item_id) WHERE deleted_at IS NULL
      DO UPDATE SET
        status = 'confirmed',
        updated_at = NOW()
      RETURNING id INTO v_registration_id;

      -- 3. Audit log
      INSERT INTO audit_log (
        org_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
      )
      SELECT
        e.org_id,
        NEW.user_id,
        'REGISTRATION_CREATED_FROM_ORDER',
        'registration',
        v_registration_id,
        jsonb_build_object(
          'order_id', NEW.id,
          'order_item_id', v_item.id,
          'participant_id', v_participant_id
        )
      FROM events e WHERE e.id = v_item.event_id;

    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS sync_registration_on_order_paid_trigger ON orders;
CREATE TRIGGER sync_registration_on_order_paid_trigger
AFTER UPDATE ON orders
FOR EACH ROW
EXECUTE FUNCTION sync_registration_on_order_paid();
```

---

## RPC: get_registrations_list

```sql
CREATE OR REPLACE FUNCTION get_registrations_list(
  _event_id UUID,
  _filters JSONB DEFAULT '{}',
  _page INTEGER DEFAULT 1,
  _page_size INTEGER DEFAULT 50,
  _sort_by TEXT DEFAULT 'created_at',
  _sort_order TEXT DEFAULT 'desc'
)
RETURNS JSONB AS $$
DECLARE
  v_org_id UUID;
  v_offset INTEGER;
  v_result JSONB;
  v_total INTEGER;
  v_data JSONB;
BEGIN
  -- 1. Verify org membership
  SELECT e.org_id INTO v_org_id
  FROM events e
  WHERE e.id = _event_id;

  IF NOT public.is_org_member(v_org_id) THEN
    RETURN jsonb_build_object('error', 'UNAUTHORIZED');
  END IF;

  -- 2. Calculate offset
  v_offset := (_page - 1) * _page_size;

  -- 3. Build dynamic query with filters
  WITH filtered AS (
    SELECT *
    FROM registrations_list_v
    WHERE event_id = _event_id
      -- Filters
      AND ((_filters->>'ticket_type_id') IS NULL
           OR ticket_type_id = (_filters->>'ticket_type_id')::uuid)
      AND ((_filters->>'registration_status') IS NULL
           OR registration_status = (_filters->>'registration_status'))
      AND ((_filters->>'payment_status') IS NULL
           OR payment_status = (_filters->>'payment_status'))
      AND ((_filters->>'assignment_status') IS NULL
           OR assignment_status = (_filters->>'assignment_status'))
      AND ((_filters->>'search') IS NULL
           OR email ILIKE '%' || (_filters->>'search') || '%'
           OR first_name ILIKE '%' || (_filters->>'search') || '%'
           OR last_name ILIKE '%' || (_filters->>'search') || '%')
  ),
  counted AS (
    SELECT COUNT(*) as total FROM filtered
  ),
  paged AS (
    SELECT * FROM filtered
    ORDER BY
      CASE WHEN _sort_order = 'asc' AND _sort_by = 'created_at' THEN created_at END ASC,
      CASE WHEN _sort_order = 'desc' AND _sort_by = 'created_at' THEN created_at END DESC,
      CASE WHEN _sort_order = 'asc' AND _sort_by = 'email' THEN email END ASC,
      CASE WHEN _sort_order = 'desc' AND _sort_by = 'email' THEN email END DESC,
      CASE WHEN _sort_order = 'asc' AND _sort_by = 'last_name' THEN last_name END ASC,
      CASE WHEN _sort_order = 'desc' AND _sort_by = 'last_name' THEN last_name END DESC
    LIMIT _page_size
    OFFSET v_offset
  )
  SELECT
    (SELECT total FROM counted),
    jsonb_agg(row_to_json(paged)::jsonb)
  INTO v_total, v_data
  FROM paged;

  RETURN jsonb_build_object(
    'total', COALESCE(v_total, 0),
    'page', _page,
    'page_size', _page_size,
    'data', COALESCE(v_data, '[]'::jsonb)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## RPC: export_registrations_csv

```sql
CREATE OR REPLACE FUNCTION export_registrations_csv(
  _event_id UUID,
  _filters JSONB DEFAULT '{}'
)
RETURNS TABLE (csv_row TEXT) AS $$
DECLARE
  v_org_id UUID;
  v_role TEXT;
  v_max_rows INTEGER;
BEGIN
  -- 1. Verify org membership + role
  SELECT e.org_id INTO v_org_id FROM events e WHERE e.id = _event_id;
  SELECT om.role INTO v_role
  FROM org_members om
  WHERE om.org_id = v_org_id AND om.user_id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'UNAUTHORIZED: admin role required for export';
  END IF;

  -- 2. Get max rows from settings
  SELECT COALESCE(
    (get_event_config(_event_id)->'participants'->'export'->>'max_rows')::integer,
    10000
  ) INTO v_max_rows;

  -- 3. Return CSV header
  RETURN QUERY SELECT 'email,first_name,last_name,ticket_type,registration_status,payment_status,assignment_status,created_at';

  -- 4. Return data rows
  RETURN QUERY
  SELECT
    format('%s,%s,%s,%s,%s,%s,%s,%s',
      COALESCE(email, ''),
      COALESCE(first_name, ''),
      COALESCE(last_name, ''),
      COALESCE(ticket_type_name, ''),
      COALESCE(registration_status::text, ''),
      COALESCE(payment_status, ''),
      COALESCE(assignment_status, ''),
      COALESCE(created_at::text, '')
    )
  FROM registrations_list_v
  WHERE event_id = _event_id
    AND ((_filters->>'ticket_type_id') IS NULL
         OR ticket_type_id = (_filters->>'ticket_type_id')::uuid)
    AND ((_filters->>'registration_status') IS NULL
         OR registration_status = (_filters->>'registration_status'))
    AND ((_filters->>'payment_status') IS NULL
         OR payment_status = (_filters->>'payment_status'))
    AND ((_filters->>'search') IS NULL
         OR email ILIKE '%' || (_filters->>'search') || '%')
  ORDER BY created_at DESC
  LIMIT v_max_rows;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## Settings Domain: participants.*

```sql
-- Add to get_default_settings()
'participants', jsonb_build_object(
  'list', jsonb_build_object(
    'default_sort', 'created_at_desc',
    'page_size_default', 50
  ),
  'export', jsonb_build_object(
    'max_rows', 10000
  ),
  'privacy', jsonb_build_object(
    'mask_email_for_support', true
  ),
  'filters', jsonb_build_object(
    'enable_age_gender', false,
    'enable_invitation_code', false,
    'enable_team', false
  )
)
```

---

## Frontend: EventParticipants.tsx

### State
```typescript
interface Filters {
  ticket_type_id?: string
  registration_status?: string
  payment_status?: string
  assignment_status?: string
  search?: string
}

const [filters, setFilters] = useState<Filters>({})
const [page, setPage] = useState(1)
const [pageSize, setPageSize] = useState(50)
```

### Data Fetching
```typescript
const fetchRegistrations = async () => {
  const { data } = await supabase.rpc('get_registrations_list', {
    _event_id: event.id,
    _filters: filters,
    _page: page,
    _page_size: pageSize
  })
  return data
}
```

### Filter Components
- Ticket Type dropdown (from ticket_types)
- Status dropdown: complete/incomplete/cancelled/waitlist
- Payment Status: paid/unpaid/refunded
- Assignment Status: assigned/unassigned
- Search input

### Export Button
```typescript
const handleExport = async () => {
  const { data } = await supabase.rpc('export_registrations_csv', {
    _event_id: event.id,
    _filters: filters
  })
  // Download as CSV file
}
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `supabase/migrations/20250127100001_participants_registrations_list.sql` | View, trigger, RPCs |
| `supabase/migrations/20250127100002_participants_settings_domain.sql` | Settings extension |
| `web/src/pages/EventParticipants.tsx` | Updated with filters + export |

---

## Acceptance Criteria

- [ ] Order→paid creates registration automatically
- [ ] Duplicate webhooks don't create duplicates
- [ ] Org members can list registrations with filters
- [ ] CSV export works with filters applied
- [ ] RLS prevents cross-org access
- [ ] Audit log records registration creation

---

*Generated: 2025-01-27*
