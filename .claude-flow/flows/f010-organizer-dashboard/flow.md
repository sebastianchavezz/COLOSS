# Flow: Organizer Dashboard

**ID**: F010
**Status**: 🟢 Done
**Total Sprints**: 3
**Current Sprint**: S3 Complete

## Sprints
| Sprint | Focus | Status |
|--------|-------|--------|
| S1 | Data Layer + Stats RPCs | 🟢 Done |
| S2 | Participant management + Export | 🟢 Done |
| S3 | Subscription Management Dashboard | 🟢 Done |

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
| `subscriptions` | Subscription tracking (S3) |
| `subscription_payments` | Recurring payment audit (S3) |

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

**S1 Total: 10/10 passing**

## Test Results (S2)

| Test | Result |
|------|--------|
| RPC export_registrations_xlsx_data exists | ✅ |
| RPC bulk_checkin_participants exists | ✅ |
| Excel export requires authorization | ✅ |
| Bulk check-in requires authorization | ✅ |
| Response structure validation | ✅ |

**S2 Total: 6/6 passing**

## Test Results (S3)

| Test | Result |
|------|--------|
| RPC get_org_subscription_stats exists | ✅ |
| Anonymous blocked from subscription stats | ✅ |
| Subscription stats response structure | ✅ |
| Org dashboard includes subscriptions key | ✅ |
| Subscriptions table RLS | ✅ |
| Subscription payments table RLS | ✅ |
| Handles non-existent org | ✅ |
| Subscription index exists | ✅ |

**S3 Total: 8/8 passing**
**Combined Total: 24/24 passing**

## Acceptance Criteria

### S1 (Complete)
- [x] Dashboard RPCs return correct data
- [x] RLS enforces org isolation
- [x] Views aggregate ticket/checkin stats
- [x] TypeScript types match RPC output
- [x] Tests passing

### S2 (Complete)
- [x] Org Dashboard landing page
- [x] Event Overview with real stats
- [x] Excel export (xlsx)
- [x] Bulk check-in with selection
- [x] Progress bars for check-in status

### S3 (Complete)
- [x] New RPC: `get_org_subscription_stats` (KPIs, subscribers, payments)
- [x] Updated `get_org_dashboard_stats` with subscription summary
- [x] Dashboard UI: subscription stats cards + subscriber table
- [x] Subscription activity labels in activity feed
- [x] Review completed (9 issues, 7 fixed)
- [x] 8/8 new tests passing

---

## Sprint S2 Deliverables (Complete)

### RPCs Created
| RPC | Purpose | Auth |
|-----|---------|------|
| `export_registrations_xlsx_data` | Excel export data | admin |
| `bulk_checkin_participants` | Multi-select check-in | org_member |

### Frontend Pages
| Page | Route | Purpose |
|------|-------|---------|
| `OrgDashboard.tsx` | `/org/:slug` | Org landing page |

### Enhanced Components
| Component | Changes |
|-----------|---------|
| `EventOverview` | Real stats from RPC, ticket type breakdown |
| `EventParticipants` | Excel export, bulk check-in, selection |

## Sprint S3 Deliverables (Complete)

### RPCs Created/Updated
| RPC | Purpose | Auth |
|-----|---------|------|
| `get_org_subscription_stats` | Full subscription overview (KPIs, subscribers, payments) | org_member |
| `get_org_dashboard_stats` | Updated with subscription summary (MRR, active, past_due) | org_member |

### New Types
| Type | Purpose |
|------|---------|
| `OrgSubscriptionStats` | Full subscription stats response |
| `SubscriptionsSummary` | Subscription KPIs in org dashboard |
| `SubscriberRow` | Subscriber list item |
| `SubscriptionPaymentRow` | Payment history item |
| `SubscriptionEventBreakdown` | Per-event subscription breakdown |

### Enhanced Components
| Component | Changes |
|-----------|---------|
| `OrgDashboard.tsx` | Added subscription section with KPI cards + subscriber table |
| `ActivityRow` | Added subscription audit log labels |

### Migration
- `20260220100000_f010_s3_subscription_dashboard.sql`

---
*Last updated: 2026-02-19*
