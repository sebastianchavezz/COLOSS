# Flow: Organizer Dashboard

**ID**: F010
**Status**: 🟡 Active
**Total Sprints**: 3
**Current Sprint**: S1 (Complete)

## Sprints
| Sprint | Focus | Status |
|--------|-------|--------|
| S1 | Data Layer + Stats RPCs | 🟢 Done |
| S2 | Participant management + Export | 🔴 Planned |
| S3 | Reports + Financial (later) | 🔴 Planned |

## Dependencies
- **Requires**: F002 ✅, F003 ✅, F006 ✅
- **Blocks**: None

## Overview

Organisatoren hebben een dashboard om hun evenementen te beheren.

```
Als organisator
Wil ik een overzicht van mijn evenementen
Zodat ik alles kan beheren en monitoren
```

## Sprint S1 Deliverables (Complete)

### RPCs Created
| RPC | Purpose | Auth |
|-----|---------|------|
| `get_org_dashboard_stats` | Full org overview | org_member |
| `get_event_dashboard_stats` | Event-level KPIs | org_member |
| `get_event_participant_stats` | Participant breakdown | org_member |

### Views Created
| View | Purpose |
|------|---------|
| `v_event_ticket_stats` | Aggregated ticket counts per event |
| `v_ticket_type_stats` | Breakdown by ticket type |
| `v_event_checkin_stats` | Check-in statistics |

### TypeScript Types
- `web/src/types/dashboard.ts` - Full type definitions for all RPC responses

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

### Tables Used
| Table | Purpose |
|-------|---------|
| `orgs` | Organization data |
| `org_members` | Team members (RLS check) |
| `events` | All org events |
| `ticket_types` | Ticket configuration |
| `ticket_instances` | Sold tickets |
| `ticket_checkins` | Check-in records |
| `orders` | Order data |
| `audit_log` | Activity feed |

### RLS Policies
| Policy | Table | Rule |
|--------|-------|------|
| `org_member_read` | all views | User is org member |
| RPC auth check | RPCs | `is_org_member()` called |

### API Endpoints (S1)

| Method | Endpoint | Auth |
|--------|----------|------|
| POST | `/rest/v1/rpc/get_org_dashboard_stats` | org_member |
| POST | `/rest/v1/rpc/get_event_dashboard_stats` | org_member |
| POST | `/rest/v1/rpc/get_event_participant_stats` | org_member |

## Test Results (S1)

| Test | Result |
|------|--------|
| RPC get_org_dashboard_stats exists | ✅ |
| RPC get_event_dashboard_stats exists | ✅ |
| RPC get_event_participant_stats exists | ✅ |
| Anonymous blocked from org dashboard | ✅ |
| Anonymous blocked from event dashboard | ✅ |
| View v_event_ticket_stats queryable | ✅ |
| View v_ticket_type_stats queryable | ✅ |
| View v_event_checkin_stats queryable | ✅ |
| Response structure validation | ✅ |

**Total: 10/10 passing**

## Acceptance Criteria

### S1 (Complete)
- [x] Dashboard RPCs return correct data
- [x] RLS enforces org isolation
- [x] Views aggregate ticket/checkin stats
- [x] TypeScript types match RPC output
- [x] Tests passing

### S2 (Planned)
- [ ] Participant list searchable
- [ ] Export to CSV/Excel
- [ ] Check-in scanner works

### S3 (Planned - Later)
- [ ] Financial overview (financing module)
- [ ] Reports generation

---

*Last updated: 2026-02-02*
