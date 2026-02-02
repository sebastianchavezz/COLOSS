# Sprint S2: Organizer Dashboard - Participant Management UI + Excel Export

**Flow**: F010 Organizer Dashboard
**Sprint**: S2 - Participant Management + Export
**Status**: 🟡 Active

## Context

S1 implemented the data layer (RPCs, views). S2 adds:
1. **Org-level Dashboard Page** - New landing page for organizers
2. **Excel Export** - In addition to existing CSV export
3. **Bulk Actions** - Check-in multiple participants at once
4. **Improved UI** - Dashboard cards using S1 RPCs

## What Already Exists (F011)

The following is already implemented:
- `EventParticipants.tsx` - Full participant list with filters
- `get_registrations_list` RPC - Paginated, filtered list
- `export_registrations_csv` RPC - CSV export
- Search by email/name
- Filters: ticket_type, status, payment, assignment
- Pagination

## Scope S2

### IN SCOPE
1. **Org Dashboard Page** (`/org/:orgSlug`)
   - Use `get_org_dashboard_stats` RPC
   - Event cards with quick stats
   - Recent activity feed
   - Quick links to events

2. **Event Dashboard Enhancement** (`EventOverview`)
   - Use `get_event_dashboard_stats` RPC
   - Ticket type breakdown chart
   - Recent orders/check-ins
   - Check-in progress bar

3. **Excel Export**
   - New RPC: `export_registrations_xlsx_data`
   - Frontend xlsx generation (SheetJS)
   - Same filters as CSV

4. **Bulk Check-in**
   - Select multiple participants
   - Check-in all selected
   - Uses existing check-in RPC

### OUT OF SCOPE (S3)
- Financial reports
- Revenue dashboards
- PDF exports

## Technical Design

### 1. New Migration: Excel Export RPC

```sql
-- Returns JSONB array for client-side xlsx generation
CREATE OR REPLACE FUNCTION export_registrations_xlsx_data(
  _event_id UUID,
  _filters JSONB DEFAULT '{}'
)
RETURNS JSONB
```

### 2. New Pages

| Page | Route | Component |
|------|-------|-----------|
| Org Dashboard | `/org/:orgSlug` | `OrgDashboard.tsx` |

### 3. Enhanced Components

| Component | Changes |
|-----------|---------|
| `EventOverview` | Use dashboard RPC, add charts |
| `EventParticipants` | Add Excel export, bulk actions |

## Files to Create/Modify

### New
- `web/src/pages/OrgDashboard.tsx` - New org landing page
- `supabase/migrations/20260202000002_f010_s2_excel_export.sql`

### Modify
- `web/src/pages/EventDetail.tsx` - Update EventOverview
- `web/src/pages/EventParticipants.tsx` - Add Excel + bulk
- `web/src/App.tsx` - Add OrgDashboard route

## Dependencies

- F010 S1 ✅ (Dashboard RPCs)
- F011 ✅ (Participants/Registrations)

## Acceptance Criteria

- [ ] Org Dashboard shows overview stats
- [ ] Event Overview uses dashboard RPC
- [ ] Excel export works with all filters
- [ ] Bulk check-in works
- [ ] RLS enforces org membership
- [ ] Tests passing

---
*Created: 2026-02-02*
