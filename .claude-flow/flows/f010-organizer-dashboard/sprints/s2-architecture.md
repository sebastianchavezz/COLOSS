# Sprint S2: Architecture - Participant Management + Export

**Flow**: F010 Organizer Dashboard
**Sprint**: S2
**Role**: Architect

## Design Decisions (ADRs)

### ADR-1: Excel Export Approach
**Decision**: Client-side XLSX generation using SheetJS
**Rationale**:
- No server-side xlsx library needed (Deno doesn't have good xlsx support)
- RPC returns JSONB data, frontend converts to xlsx
- Keeps Edge Functions lightweight
- SheetJS is well-maintained and ~100KB gzipped

### ADR-2: Org Dashboard Location
**Decision**: Replace current redirect with actual dashboard component
**Rationale**:
- `/org/:orgSlug` currently redirects to events
- New OrgDashboard provides landing page with overview
- Events list moves to `/org/:orgSlug/events`

### ADR-3: Bulk Check-in UI
**Decision**: Checkbox selection with floating action bar
**Rationale**:
- Familiar pattern (Gmail, Notion)
- Non-intrusive until items selected
- Clear feedback on selection count

## Database Changes

### New RPC: export_registrations_xlsx_data

```sql
-- Returns structured JSONB for client-side xlsx generation
CREATE OR REPLACE FUNCTION export_registrations_xlsx_data(
  _event_id UUID,
  _filters JSONB DEFAULT '{}'
)
RETURNS JSONB
```

Returns:
```json
{
  "event_name": "...",
  "export_date": "...",
  "total_rows": 123,
  "columns": ["email", "first_name", ...],
  "rows": [
    {"email": "...", "first_name": "...", ...}
  ]
}
```

### New RPC: bulk_checkin_participants

```sql
CREATE OR REPLACE FUNCTION bulk_checkin_participants(
  _event_id UUID,
  _ticket_instance_ids UUID[]
)
RETURNS JSONB
```

Returns:
```json
{
  "success_count": 10,
  "failed_count": 2,
  "failures": [
    {"id": "...", "reason": "ALREADY_CHECKED_IN"}
  ]
}
```

## Frontend Components

### 1. OrgDashboard.tsx (New)

```tsx
// /org/:orgSlug shows org overview
export function OrgDashboard() {
  // Uses get_org_dashboard_stats RPC
  return (
    <>
      <OrgHeader />
      <StatsCards summary={data.summary} />
      <EventsGrid events={data.events} />
      <RecentActivity items={data.recent_activity} />
    </>
  )
}
```

### 2. EventOverview Enhancement

```tsx
// Replaces placeholder with real dashboard
export function EventOverview() {
  // Uses get_event_dashboard_stats RPC
  return (
    <>
      <StatsRow tickets={data.tickets} checkins={data.checkins} />
      <TicketTypeBreakdown types={data.ticket_types} />
      <div className="grid grid-cols-2 gap-6">
        <RecentOrders orders={data.recent_orders} />
        <RecentCheckins checkins={data.recent_checkins} />
      </div>
    </>
  )
}
```

### 3. EventParticipants Enhancements

```tsx
// Add to existing component
<ExportDropdown
  onCSV={handleExportCSV}
  onExcel={handleExportExcel}
/>

<BulkActionBar
  selectedCount={selected.length}
  onCheckIn={handleBulkCheckIn}
  onClear={() => setSelected([])}
/>

// Each row gets checkbox
<input
  type="checkbox"
  checked={selected.includes(row.ticket_instance_id)}
  onChange={() => toggleSelect(row.ticket_instance_id)}
/>
```

## File Changes

### New Files
| File | Purpose |
|------|---------|
| `web/src/pages/OrgDashboard.tsx` | Org landing page |
| `supabase/migrations/20260202000002_f010_s2_exports.sql` | Excel export + bulk checkin RPCs |

### Modified Files
| File | Changes |
|------|---------|
| `web/src/App.tsx` | Add OrgDashboard route |
| `web/src/pages/EventDetail.tsx` | Update EventOverview |
| `web/src/pages/EventParticipants.tsx` | Add Excel export + bulk actions |
| `web/package.json` | Add xlsx dependency |

## Route Changes

| Before | After |
|--------|-------|
| `/org/:orgSlug` → redirect to events | `/org/:orgSlug` → OrgDashboard |
| - | Events list stays at `/org/:orgSlug/events` |

## Security Considerations

1. **Excel export** requires admin role (same as CSV)
2. **Bulk check-in** requires org membership
3. **Both RPCs** use SECURITY DEFINER with explicit checks

## Dependencies

```json
{
  "xlsx": "^0.18.5"
}
```

Note: xlsx package is for xlsx generation only, no file reading needed.

---
*Created: 2026-02-02*
