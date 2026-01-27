# Flow: Organizer Dashboard

**ID**: F010
**Status**: 🔴 Planned
**Total Sprints**: 3
**Current Sprint**: -

## Sprints
| Sprint | Focus | Status |
|--------|-------|--------|
| S1 | Event overview + stats | 🔴 |
| S2 | Participant management | 🔴 |
| S3 | Reports + export | 🔴 |

## Dependencies
- **Requires**: F002, F003
- **Blocks**: None

## Overview

Organisatoren hebben een dashboard om hun evenementen te beheren.

```
Als organisator
Wil ik een overzicht van mijn evenementen
Zodat ik alles kan beheren en monitoren
```

## Flow Diagram

```
[Login] → [Dashboard Home]
                │
    ┌───────────┼───────────┐
    ▼           ▼           ▼
[Events]   [Analytics]  [Settings]
    │           │           │
    ▼           ▼           ▼
[Manage]   [Reports]   [Team]
```

## Supabase

### Tables
| Table | Purpose |
|-------|---------|
| `orgs` | Organization data |
| `org_members` | Team members |
| `events` | All org events |
| `registrations` | Participant data |
| `orders` | Financial data |

### RLS Policies
| Policy | Table | Rule |
|--------|-------|------|
| `org_member_read` | all | User is org member |
| `org_admin_write` | settings | User is owner/admin |

### Edge Functions
| Function | Purpose |
|----------|---------|
| `dashboard-stats` | Aggregate statistics |
| `export-participants` | CSV/Excel export |
| `check-in` | Scan ticket QR |

## API Endpoints

| Method | Endpoint | Auth |
|--------|----------|------|
| GET | `/rest/v1/events?org_id=eq.{id}` | Yes (org) |
| GET | `/functions/v1/dashboard-stats` | Yes (org) |
| GET | `/functions/v1/export-participants` | Yes (org) |
| POST | `/functions/v1/check-in` | Yes (org) |

## Test Scenarios

| ID | Scenario | Expected |
|----|----------|----------|
| T1 | View dashboard | Stats shown |
| T2 | List participants | Searchable list |
| T3 | Export CSV | Download works |
| T4 | Check-in scan | Ticket validated |
| T5 | View financials | Revenue shown |
| T6 | Cross-org access | RLS denied |

## Acceptance Criteria

- [ ] Dashboard shows key metrics
- [ ] Participant list searchable
- [ ] Export to CSV/Excel
- [ ] Check-in scanner works
- [ ] Financial overview accurate
- [ ] Team management works
- [ ] RLS enforces org isolation

---

*Last updated: 2025-01-27*
