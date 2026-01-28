# Flow: Event Creation

**ID**: F003
**Status**: 🟢 Done
**Total Sprints**: 3
**Current Sprint**: All Complete

## Sprints
| Sprint | Focus | Status |
|--------|-------|--------|
| S1 | GPX Route Import & Map Display | 🟢 Done |
| S2 | Event CRUD Basics | 🟢 Done |
| S3 | Event Settings Management | 🟢 Done |

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
| `event_settings` | Event configuration (12 domains) |
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
| `admins_manage_events` | `events` | Org admin/owner can CRUD |
| `public_view_published` | `events` | Published events visible |

### RPC Functions
| Function | Purpose |
|----------|---------|
| `save_event_route` | Store parsed GPX data |
| `get_event_route` | Get route with auth scoping |
| `set_event_route_status` | Toggle draft/published |
| `delete_event_route` | Soft delete route |
| `get_event_config` | Get all event settings |
| `set_event_config` | Update event settings domain |
| `get_event_config_permissions` | Check user permissions |

### Edge Functions
| Function | Purpose |
|----------|---------|
| `process-gpx` | Server-side GPX processing |

## Implementation Status

### S1: GPX Route Import (Complete)
- ✅ `event_routes` table with geometry, bounds, distance
- ✅ Storage bucket for GPX files
- ✅ Edge Function for GPX parsing
- ✅ Frontend: drag & drop upload, preview, publish
- ✅ Participant: read-only route map
- ✅ 12/12 integration tests passing

### S2: Event CRUD (Complete)
- ✅ `EventsList.tsx` - List all events for org
- ✅ `EventCreate.tsx` - Create new event form
- ✅ `EventDetail.tsx` - Event header, tabs, status toggle
- ✅ `data/events.ts` - Full CRUD operations
- ✅ Slug generation with uniqueness check
- ✅ Soft delete support

### S3: Event Settings (Complete)
- ✅ `EventSettings.tsx` - General settings form
- ✅ `events/Settings.tsx` - Advanced 12-domain config system
  - Governance (visibility, legal terms)
  - Content (basic info, checkout messages)
  - Branding (hero, logo, colors)
  - Waitlist & Interest list
  - Tickets & Privacy
  - Payments (profile, VAT)
  - Transfers (enable, expiry)
  - Communication (sender, bulk, rate limits)
- ✅ Role-based permissions per domain
- ✅ Reset to defaults functionality

## Test Scenarios

| ID | Scenario | Expected | Status |
|----|----------|----------|--------|
| T1 | Upload valid GPX | Route created + preview | ✅ |
| T2 | Upload invalid file | Error message | ✅ |
| T3 | Upload oversized file | Error message | ✅ |
| T4 | View route as organizer | Full access | ✅ |
| T5 | View route as participant | Published only | ✅ |
| T6 | Publish route | Status changes | ✅ |
| T7 | Replace route | Old replaced | ✅ |
| T8 | Delete route | Soft deleted | ✅ |
| T9 | Create event | Event + settings created | ✅ |
| T10 | Update event details | Changes saved | ✅ |
| T11 | Toggle event status | Draft ↔ Published | ✅ |
| T12 | Delete event | Soft deleted | ✅ |

## Acceptance Criteria

- [x] GPX upload with drag & drop
- [x] File validation (type, size)
- [x] Map preview with polyline
- [x] Start/finish markers
- [x] Publish/unpublish toggle
- [x] Participant view (published only)
- [x] Audit logging
- [x] Event create form
- [x] Event list with status badges
- [x] Event detail with tabs
- [x] Settings management (12 domains)
- [x] Role-based permissions

---

*Last updated: 2026-01-28*
