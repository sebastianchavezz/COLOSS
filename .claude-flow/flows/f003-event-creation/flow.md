# Flow: Event Creation

**ID**: F003
**Status**: 🟡 In Progress
**Total Sprints**: 3
**Current Sprint**: S1 (GPX Routes)

## Sprints
| Sprint | Focus | Status |
|--------|-------|--------|
| S1 | GPX Route Import & Map Display | 🟡 In Progress |
| S2 | Event CRUD Basics | 🔴 Planned |
| S3 | Event Settings Management | 🔴 Planned |

## Dependencies
- **Requires**: F001 (User Registration), F002 (User Login)
- **Blocks**: F004 (Event Discovery), F010 (Organizer Dashboard)

## Overview

Organisatoren kunnen evenementen aanmaken en beheren, inclusief routes.

```
Als organisator
Wil ik evenementen kunnen aanmaken en routes uploaden
Zodat deelnemers zich kunnen inschrijven en voorbereiden
```

## Flow Diagram

```
[Dashboard] → [Create Event]
                    │
                    ▼
              [Event Details]
                    │
         ┌─────────┴─────────┐
         ▼                   ▼
   [Route/Map]         [Settings]
         │                   │
         ▼                   ▼
   [GPX Upload]        [Tickets]
         │                   │
         ▼                   ▼
   [Preview Map]       [Publish]
         │
         ▼
   [Publish Route]
```

## Supabase

### Tables
| Table | Purpose |
|-------|---------|
| `events` | Event definitions |
| `event_settings` | Event configuration |
| `event_routes` | GPX routes with geometry |

### Storage
| Bucket | Purpose |
|--------|---------|
| `gpx-routes` | Original GPX files |

### RLS Policies
| Policy | Table | Rule |
|--------|-------|------|
| `org_members_manage` | `event_routes` | Org admin/owner can CRUD |
| `participants_view_published` | `event_routes` | Published routes only |

### RPC Functions
| Function | Purpose |
|----------|---------|
| `upload_event_route` | Parse GPX, store, create record |
| `get_event_route` | Get route with auth scoping |
| `set_event_route_status` | Toggle draft/published |
| `delete_event_route` | Soft delete route |

### Edge Functions
| Function | Purpose |
|----------|---------|
| `process-gpx` | Server-side GPX processing |

## API Endpoints

| Method | Endpoint | Auth |
|--------|----------|------|
| RPC | `upload_event_route(_event_id, _gpx_data)` | Org member |
| RPC | `get_event_route(_event_id)` | Org/Participant |
| RPC | `set_event_route_status(_event_id, _status)` | Org member |
| RPC | `delete_event_route(_event_id)` | Org member |

## Test Scenarios

| ID | Scenario | Expected | Status |
|----|----------|----------|--------|
| T1 | Upload valid GPX | Route created + preview | 🔴 |
| T2 | Upload invalid file | Error message | 🔴 |
| T3 | Upload oversized file | Error message | 🔴 |
| T4 | View route as organizer | Full access | 🔴 |
| T5 | View route as participant | Published only | 🔴 |
| T6 | Publish route | Status changes | 🔴 |
| T7 | Replace route | Old replaced | 🔴 |
| T8 | Delete route | Soft deleted | 🔴 |

## Acceptance Criteria

- [ ] GPX upload with drag & drop
- [ ] File validation (type, size)
- [ ] Map preview with polyline
- [ ] Start/finish markers
- [ ] Publish/unpublish toggle
- [ ] Participant view (published only)
- [ ] Audit logging

---

*Last updated: 2026-01-28*
