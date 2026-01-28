# Sprint S1: GPX Route Import & Map Display

**Flow**: F003 Event Creation
**Sprint**: S1
**Date**: 2026-01-28
**Status**: In Progress

---

## Context

F003 Event Creation is a multi-sprint flow. This S1 focuses specifically on:
- **GPX Route Import** for event organizers
- **Route Map Display** for participants

Dependencies F001 (User Registration) and F002 (User Login) are already complete.

---

## Scope

### In Scope
1. **Database**: `event_routes` table with geometry, bounds, distance
2. **Storage**: GPX file storage in Supabase Storage
3. **RPC Functions**: Upload, get, update status, delete routes
4. **Frontend Organizer**: Upload + preview + publish workflow
5. **Frontend Participant**: Read-only route map view
6. **Security**: RLS for org members and participants

### Out of Scope (Future Sprints)
- Event CRUD basics (S2)
- Event settings management (S3)
- Multi-track/segment advanced handling
- Waypoint markers beyond start/finish
- Route download functionality
- Elevation profiles

---

## User Stories

### Organizer
| ID | Story | Priority |
|----|-------|----------|
| US1 | Upload GPX file for event route | HIGH |
| US2 | Preview route on map after upload | HIGH |
| US3 | Save and publish/unpublish route | HIGH |
| US4 | Replace route with new GPX | MEDIUM |

### Participant
| ID | Story | Priority |
|----|-------|----------|
| US5 | View published route on map | HIGH |
| US6 | See route distance info | HIGH |

---

## Technical Requirements

### Database
- `event_routes` table:
  - id, org_id, event_id (unique per event)
  - gpx_file_path (storage reference)
  - status (draft/published)
  - route_geometry (JSONB - GeoJSON LineString)
  - bounds (JSONB - {minLat, maxLat, minLng, maxLng})
  - distance_m (integer)
  - created_at, updated_at, updated_by

### Storage
- Bucket: `gpx-routes`
- Path: `{org_id}/{event_id}/route.gpx`
- Max size: 5MB
- MIME: application/gpx+xml

### RPC Functions
| Function | Auth | Description |
|----------|------|-------------|
| `upload_event_route` | Org member | Parse GPX, store, create record |
| `get_event_route` | Org/Participant | Get route (published only for participants) |
| `set_event_route_status` | Org member | Toggle draft/published |
| `delete_event_route` | Org member | Soft delete route |

### Frontend
- Map library: Leaflet (react-leaflet)
- GPX parsing: @tmcw/togeojson (client-side preview)
- Douglas-Peucker simplification for performance

---

## Acceptance Criteria

- [ ] Organizer can upload GPX file (drag & drop + file picker)
- [ ] GPX validation: .gpx only, max 5MB, valid XML
- [ ] Route preview on map with polyline
- [ ] Start/finish markers displayed
- [ ] Auto fit-bounds on route
- [ ] Save route to database
- [ ] Publish/unpublish toggle works
- [ ] Participant sees only published routes
- [ ] Empty state when no route
- [ ] Audit logs for route actions
- [ ] RLS: org members can edit, participants can view published

---

## Deliverables

| Artifact | Location |
|----------|----------|
| Sprint Plan | `sprints/s1-plan.md` |
| Architecture | `sprints/s1-architecture.md` |
| Migration | `supabase/migrations/20250128170000_f003_event_routes.sql` |
| Edge Function | `supabase/functions/process-gpx/` |
| Organizer Page | `web/src/pages/events/EventRouteAdmin.tsx` |
| Participant Page | `web/src/pages/public/EventRoute.tsx` |
| Integration Tests | `tests/integration-tests.mjs` |
| Review | `sprints/s1-review.md` |

---

*Sprint S1 Plan - F003 Event Creation - 2026-01-28*
