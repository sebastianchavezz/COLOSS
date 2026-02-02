# Sprint S1: Organizer Dashboard - Data Layer & Stats

**Flow**: F010 Organizer Dashboard
**Sprint**: S1 - Data Layer & Stats
**Status**: 🟡 Active

## Overview

Dit sprint bouwt de data layer voor het organizer dashboard.
**Nota bene**: Financing module komt later - we focussen nu op operationele KPIs.

## Dashboard Best Practices

### Design Principles
1. **Single RPC voor alle stats** - Eén call, alle data (geen waterfall requests)
2. **Materialized aggregates** - Pre-computed counts voor performance
3. **Org-level RLS** - Alle stats gefilterd op org membership
4. **Time-range support** - Filteren op periode (today, week, month, all)
5. **Real-time capable** - Stats kunnen later via Realtime updates krijgen

### Data Architecture
- **Views** voor complex joins (security_invoker = true)
- **RPC functions** voor aggregated stats (security definer met auth check)
- **Indexes** voor veelgebruikte queries

## Scope

### IN SCOPE (Sprint 1)
- Dashboard overview stats (events, tickets, check-ins)
- Event-level KPIs
- Recent activity feed
- Participant summary per event
- Check-in statistics

### OUT OF SCOPE (Later)
- Financial reports (F010 S3 of aparte finance flow)
- CSV/Excel export (F010 S2)
- Real-time updates (F010 S2+)
- Team member activity (F014)

## Data Requirements

### 1. Organization Overview
```
- Total events (draft/published/closed)
- Total tickets sold (issued)
- Total check-ins (today/all)
- Total revenue (placeholder - geen finance module)
```

### 2. Event Summary
```
Per event:
- Ticket stats: sold / capacity / available
- Check-in stats: checked_in / total / percentage
- Recent orders: last 5-10
- Status: draft / published / closed
- Days until event / days since
```

### 3. Recent Activity (Audit Trail)
```
Last N activities across:
- Ticket purchases
- Check-ins
- Refunds
- Settings changes
```

### 4. Participant Overview
```
Per event:
- Total unique participants
- With/without account (user_id null check)
- Ticket type distribution
```

## Technical Design

### 1. Dashboard Stats RPC
```sql
create or replace function get_org_dashboard_stats(_org_id uuid)
returns jsonb
```

Returns:
```json
{
  "org": { "id", "name", "slug" },
  "summary": {
    "events": { "total", "draft", "published", "closed" },
    "tickets": { "issued", "checked_in", "available" },
    "participants": { "total", "unique" }
  },
  "events": [
    {
      "id", "name", "slug", "status", "start_time",
      "tickets": { "sold", "capacity", "available" },
      "checkins": { "count", "percentage" }
    }
  ],
  "recent_activity": [
    { "type", "description", "created_at", "event_name" }
  ]
}
```

### 2. Event Detail Stats RPC
```sql
create or replace function get_event_dashboard_stats(_event_id uuid)
returns jsonb
```

Returns:
```json
{
  "event": { "id", "name", "status", ... },
  "ticket_types": [
    { "id", "name", "price", "sold", "capacity", "available" }
  ],
  "checkins": {
    "total", "today", "hourly": [{ "hour", "count" }]
  },
  "recent_orders": [
    { "id", "email", "total_amount", "status", "created_at" }
  ],
  "recent_checkins": [
    { "ticket_id", "checked_in_at", "ticket_type_name" }
  ]
}
```

### 3. Views (Supporting)

```sql
-- Aggregated ticket stats per event
create view event_ticket_stats as ...

-- Aggregated check-in stats per event
create view event_checkin_stats as ...

-- Recent activity feed
create view org_activity_feed as ...
```

## Acceptance Criteria

- [ ] `get_org_dashboard_stats` RPC returns complete org overview
- [ ] `get_event_dashboard_stats` RPC returns complete event stats
- [ ] RLS enforces org membership on all data
- [ ] Non-member gets empty result (not error)
- [ ] Stats are accurate (tested against manual counts)
- [ ] Performance: < 200ms for typical org (10 events, 1000 tickets)

## Dependencies

- F001 User Registration ✅
- F002 User Login/Auth ✅
- F003 Event Creation ✅
- F006 Checkout/Payment ✅
- F007 Ticket Delivery (partial) ✅

## Files to Create/Modify

### New
- `supabase/migrations/YYYYMMDD_f010_dashboard_stats.sql`

### Test
- `.claude-flow/flows/f010-organizer-dashboard/tests/integration-tests.mjs`

---
*Created: 2026-02-02*
