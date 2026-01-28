# Sprint S2: Event CRUD Basics

**Flow**: F003 Event Creation
**Sprint**: S2
**Date**: 2026-01-28
**Status**: Complete (Pre-existing)

---

## Context

S2 focuses on basic event CRUD operations. This functionality was implemented as part of the initial organizer MVP before the flow system was established.

---

## Scope

### Implemented Features
1. **Event List Page** (`EventsList.tsx`)
   - List all events for current organization
   - Status badges (draft/published/closed)
   - Date and location display
   - Link to event detail

2. **Event Create Page** (`EventCreate.tsx`)
   - Form: name, start date/time, location, description
   - Client-side validation
   - Auto-generates unique slug
   - Creates event + auto-creates event_settings via trigger

3. **Event Detail Page** (`EventDetail.tsx`)
   - Header with event info
   - Tab navigation (Overview, Tickets, Orders, Participants, Products, Communication, Messaging, FAQ, Settings)
   - Status toggle (draft ↔ published)
   - Delete with confirmation modal

4. **Data Layer** (`data/events.ts`)
   - `listEvents(orgId)` - Get all events for org
   - `getEventBySlug(orgId, slug)` - Get single event
   - `getEventById(eventId)` - Get by ID
   - `createEvent(orgId, payload)` - Create new
   - `updateEvent(eventId, payload)` - Update existing
   - `setEventStatus(eventId, status)` - Change status
   - `softDeleteEvent(eventId)` - Soft delete

---

## Database

### events table
```sql
CREATE TABLE public.events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES orgs(id),
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    location_name text,
    start_time timestamptz NOT NULL,
    end_time timestamptz,
    status event_status NOT NULL DEFAULT 'draft',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    UNIQUE (org_id, slug)
);
```

### RLS Policies
- Public can view published events
- Org members can view all org events
- Admins/owners can manage events

### Triggers
- `on_event_created` → Creates event_settings row
- `handle_updated_at_events` → Updates updated_at

---

## Files

| File | Purpose |
|------|---------|
| `web/src/pages/EventsList.tsx` | Event list page |
| `web/src/pages/EventCreate.tsx` | Create event form |
| `web/src/pages/EventDetail.tsx` | Event detail + tabs |
| `web/src/data/events.ts` | CRUD operations |
| `supabase/migrations/20240119000002_layer_2_events.sql` | Schema |
| `supabase/migrations/20240120000002_events_schema_improvements.sql` | Indexes |

---

## Acceptance Criteria

- [x] List events with status badges
- [x] Create event with form validation
- [x] Auto-generate unique slug
- [x] View event details
- [x] Toggle event status
- [x] Soft delete event
- [x] Tab navigation

---

*Sprint S2 - F003 Event Creation - 2026-01-28*
