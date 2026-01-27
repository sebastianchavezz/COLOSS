# Flow: Participants/Registrations

**ID**: F011
**Status**: 🟢 Done
**Total Sprints**: 1
**Current Sprint**: Done

## Sprints
| Sprint | Focus | Status |
|--------|-------|--------|
| S1 | List + Filters + Export | 🟢 |

## Dependencies
- **Requires**: F001, F003, F005, F006
- **Blocks**: None

## Overview

Registratie management voor organisatoren met Atleta-achtige filtering, CSV export, en automatische sync van order→registratie bij betaling.

```
Als organisator
Wil ik alle registraties van mijn event kunnen bekijken en filteren
Zodat ik overzicht heb over wie er komt

Als organisator
Wil ik registraties kunnen exporteren naar CSV
Zodat ik de data kan gebruiken voor externe systemen

Als systeem
Wil ik automatisch registraties aanmaken bij betaalde orders
Zodat de deelnemerslijst altijd up-to-date is
```

## Flow Diagram

```
           ┌─────────────────────────────────┐
           │        ORDER LIFECYCLE          │
           └─────────────┬───────────────────┘
                         │
                    [Order Paid]
                         │
                         ▼
              ┌──────────────────────┐
              │  TRIGGER: sync_      │
              │  registration_on_    │
              │  order_paid          │
              └──────────┬───────────┘
                         │
           ┌─────────────┴─────────────┐
           ▼                           ▼
    [Upsert Participant]      [Upsert Registration]
           │                           │
           └─────────────┬─────────────┘
                         │
                         ▼
                  [Audit Log Entry]

           ┌─────────────────────────────────┐
           │     ORGANIZER DASHBOARD         │
           └─────────────┬───────────────────┘
                         │
    ┌────────────────────┼────────────────────┐
    ▼                    ▼                    ▼
[Filter Panel]    [List View]          [Export Button]
    │                    │                    │
    └────────────────────┴────────────────────┘
                         │
                         ▼
              [get_registrations_list RPC]
                         │
                         ▼
              [registrations_list_v View]
                  (security_invoker)
```

## Supabase

### Views
| View | Purpose |
|------|---------|
| `registrations_list_v` | Pre-joined view for efficient list queries |

### Tables Modified
| Table | Change |
|-------|--------|
| `ticket_instances` | Added `order_item_id` column |
| `orders` | Added `metadata` column |

### Indexes
| Index | Purpose |
|-------|---------|
| `idx_registrations_event_status` | Filter by event + status |
| `idx_registrations_participant_id` | Join to participants |
| `idx_registrations_order_item_unique` | Idempotency constraint |
| `idx_ticket_instances_order_item_id` | Join to order items |
| `idx_participants_email_unique` | Participant upsert |

### RLS Policies
| Policy | Table/View | Rule |
|--------|------------|------|
| `security_invoker` | `registrations_list_v` | Inherits from base tables |
| `org_check` | `get_registrations_list` | `is_org_member(org_id)` |
| `admin_only` | `export_registrations_csv` | `role IN ('owner', 'admin')` |

### Functions (RPC)
| Function | Purpose | Security |
|----------|---------|----------|
| `get_registrations_list` | Paginated list with filters | SECURITY DEFINER |
| `get_registration_detail` | Single registration + answers | SECURITY DEFINER |
| `export_registrations_csv` | CSV export | SECURITY DEFINER, admin only |

### Triggers
| Trigger | Table | Event | Purpose |
|---------|-------|-------|---------|
| `sync_registration_on_order_paid_trigger` | `orders` | AFTER UPDATE | Auto-create registration |

## Frontend

### Components
| Component | Purpose |
|-----------|---------|
| `EventParticipants.tsx` | List page with filters |
| Filter bar | Ticket type, status, payment, assignment, search |
| Export button | Download CSV |
| Pagination | Page navigation |

### State
```typescript
interface Filters {
  ticket_type_id?: string
  registration_status?: string
  payment_status?: string
  assignment_status?: string
  search?: string
}
```

## Settings Domain

```
participants.list.default_sort
participants.list.page_size_default
participants.export.max_rows
participants.privacy.mask_email_for_support
participants.filters.enable_age_gender
participants.filters.enable_invitation_code
participants.filters.enable_team
```

## Test Scenarios

| ID | Scenario | Expected | Status |
|----|----------|----------|--------|
| T1 | Order paid creates registration | Registration in DB | ✅ |
| T2 | Duplicate webhook idempotent | No duplicate records | ✅ |
| T3 | Org member can list | Data returned | ✅ |
| T4 | Non-member blocked | UNAUTHORIZED error | ✅ |
| T5 | Cross-org blocked | UNAUTHORIZED error | ✅ |
| T6 | Filter by status | Filtered results | ✅ |
| T7 | Search by name/email | Matching results | ✅ |
| T8 | Pagination works | Correct page size | ✅ |
| T9 | Admin can export | CSV returned | ✅ |
| T10 | Non-admin export blocked | Exception raised | ✅ |
| T11 | Settings validation | Invalid rejected | ✅ |

## Acceptance Criteria

- [x] Order→paid automatically creates registration
- [x] Duplicate webhooks don't create duplicates
- [x] Org members can list registrations with filters
- [x] Search works on email, first_name, last_name
- [x] CSV export works with filters applied
- [x] Admin role required for export
- [x] RLS prevents cross-org access
- [x] Audit log records registration creation
- [x] Settings domain configurable per event
- [x] Frontend has filter bar and pagination

## Files

### Migrations
- `supabase/migrations/20250127100001_participants_registrations_list.sql`
- `supabase/migrations/20250127100002_participants_settings_domain.sql`

### Frontend
- `web/src/pages/EventParticipants.tsx`

### Tests
- `tests/supabase/f011_participants_registrations_rls.sql`
- `tests/verification/verify_f011_participants_registrations.sql`

### Documentation
- `.claude-flow/flows/f011-participants-registrations/sprints/s1-plan.md`
- `.claude-flow/flows/f011-participants-registrations/sprints/s1-architecture.md`
- `.claude-flow/flows/f011-participants-registrations/sprints/s1-review.md`
- `.claude-flow/flows/f011-participants-registrations/sprints/s1-test-report.md`

---

*Last updated: 2025-01-27*
