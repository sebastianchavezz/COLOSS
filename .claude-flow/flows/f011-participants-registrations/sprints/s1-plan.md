# Sprint Plan: F011 Participants - Registrations Visibility + Filters + Export

## Metadata
| Field | Value |
|-------|-------|
| **Sprint** | F011-S1 |
| **Flow** | F011 - Participants/Registrations |
| **Status** | Planning |
| **Created** | 2025-01-27 |

---

## Overview

Implementeer de "Registraties" organiser flow met Atleta-achtige filtering en export capabilities:
1. Post-purchase sync: order→paid automatisch participant + registration aanmaken/updaten
2. Registrations list view: snelle lijst per event met filters (tickets, status, betaalstatus, taal)
3. Drilldown: registratie detail + link naar orders
4. Export: CSV export van gefilterde selectie

---

## Current State Analysis

### Bestaande Tabellen
- `participants` - Basis profiel (email, first_name, last_name, birth_date, gender, phone, etc.)
- `registrations` - Event<->Participant koppeling met status, ticket_type_id, order_item_id
- `registration_answers` - Antwoorden op dynamische vragen
- `ticket_instances` - Actuele tickets met QR code
- `orders` / `order_items` - Bestellingen

### Bestaande RLS
- Participants: Users manage own, Orgs view event participants
- Registrations: Users view own, Orgs manage event registrations

### Missende Functionaliteit
1. **Post-purchase sync**: Geen automatische registration creatie bij order→paid
2. **Materialized view**: Geen prejoined view voor snelle filtering
3. **Filter capabilities**: Geen server-side filtering RPC
4. **Export functie**: Geen CSV export
5. **Settings domain**: `participants.*` niet geconfigureerd

---

## Database Changes

### 1. Materialized View: `registrations_list_view`

```sql
-- Prejoined view voor snelle list queries
CREATE MATERIALIZED VIEW registrations_list_mv AS
SELECT
  r.id,
  r.event_id,
  r.participant_id,
  r.status,
  r.ticket_type_id,
  r.order_item_id,
  r.created_at,
  r.updated_at,
  -- Participant data
  p.email,
  p.first_name,
  p.last_name,
  p.phone,
  p.birth_date,
  p.gender,
  p.country,
  -- Ticket type
  tt.name as ticket_type_name,
  tt.price as ticket_type_price,
  -- Order data
  o.id as order_id,
  o.status as order_status,
  o.total_amount as order_total,
  -- Ticket instance
  ti.id as ticket_instance_id,
  ti.qr_code,
  ti.status as ticket_status,
  ti.checked_in_at,
  -- Computed
  CASE WHEN o.status = 'paid' THEN 'paid'
       WHEN o.status = 'refunded' THEN 'refunded'
       ELSE 'unpaid' END as payment_status,
  CASE WHEN ti.id IS NOT NULL THEN 'assigned' ELSE 'unassigned' END as assignment_status,
  -- Discount flag (placeholder)
  COALESCE(oi.discount_amount > 0, false) as has_discount
FROM registrations r
JOIN participants p ON p.id = r.participant_id
LEFT JOIN ticket_types tt ON tt.id = r.ticket_type_id
LEFT JOIN order_items oi ON oi.id = r.order_item_id
LEFT JOIN orders o ON o.id = oi.order_id
LEFT JOIN ticket_instances ti ON ti.order_item_id = oi.id AND ti.deleted_at IS NULL
WHERE r.deleted_at IS NULL;
```

### 2. Trigger: Auto-create Registration on Order Paid

```sql
CREATE FUNCTION sync_registration_on_order_paid()
RETURNS TRIGGER AS $$
-- Idempotent: check if registration already exists
-- Create participant if not exists (upsert by email)
-- Create registration linked to order_item
-- Write audit_log
$$
```

### 3. RPC Functions

| Function | Purpose | Auth |
|----------|---------|------|
| `get_registrations_list` | Filtered list with pagination | org_member |
| `get_registration_detail` | Single registration + answers | org_member |
| `export_registrations_csv` | Generate CSV data | org_member (admin+) |
| `refresh_registrations_mv` | Refresh materialized view | service_role |

### 4. Settings Domain Extension

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

## Edge Functions

### 1. `export-registrations`
- Input: event_id, filters, format (csv)
- Output: CSV file stream
- Auth: org_member with admin+ role
- Rate limit: 1 per minute per user

---

## Frontend Changes

### `EventParticipants.tsx` Enhancements

1. **Filter Bar** (Atleta-style)
   - Ticket type dropdown
   - Status dropdown (complete/incomplete/cancelled/waitlist)
   - Payment status (paid/unpaid/refunded)
   - Assignment status (assigned/unassigned)
   - Search (email/name)

2. **Table Columns**
   - Naam (first + last)
   - Email
   - Ticket Type
   - Status
   - Payment Status
   - Ticket Status (assigned/unassigned)
   - Created

3. **Actions**
   - Export CSV button
   - Drilldown to detail

4. **Registration Detail Modal/Page**
   - Participant info
   - Registration answers
   - Linked order
   - Linked ticket(s)

---

## Implementation Order

### FASE 1: Database
1. Add `discount_amount` column to `order_items` if missing
2. Create `registrations_list_mv` materialized view
3. Create index on MV
4. Create `sync_registration_on_order_paid()` trigger
5. Create RPC functions

### FASE 2: Settings
1. Extend domain constraint for `participants.*`
2. Add default settings
3. Add validation

### FASE 3: Edge Functions
1. Create `export-registrations` function

### FASE 4: Frontend
1. Update `EventParticipants.tsx` with filters
2. Add export button
3. Add detail view

### FASE 5: Tests
1. RLS policy tests
2. Trigger idempotency tests
3. Filter function tests
4. Export tests

---

## Test Scenarios

| ID | Scenario | Expected |
|----|----------|----------|
| T1 | Order paid creates registration | Registration exists, audit logged |
| T2 | Duplicate webhook | No duplicate registration (idempotent) |
| T3 | Filter by ticket type | Only matching registrations |
| T4 | Filter by payment status | Correct filtering |
| T5 | Export CSV | Valid CSV with filtered data |
| T6 | RLS: org A cannot see org B | Access denied |
| T7 | Support role masked email | Email partially hidden |

---

## Security Checklist

- [ ] RLS on materialized view (use function wrapper)
- [ ] Export rate limiting
- [ ] Audit log on create/update
- [ ] Privacy masking for support role
- [ ] No direct MV access from client

---

## Files to Create/Modify

### Migrations
- `supabase/migrations/20250127100001_participants_registrations_list.sql`
- `supabase/migrations/20250127100002_participants_settings_domain.sql`

### Edge Functions
- `supabase/functions/export-registrations/index.ts`

### Frontend
- `web/src/pages/EventParticipants.tsx` (major update)
- `web/src/pages/RegistrationDetail.tsx` (new)

---

## Out of Scope

- Teams/startnummers
- Imports
- Advanced CRM
- Invitation codes filtering (placeholder only)

---

*Generated: 2025-01-27*
