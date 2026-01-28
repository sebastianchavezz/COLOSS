# Flow: Event Discovery

**ID**: F004
**Status**: 🟢 Done
**Total Sprints**: 1
**Current Sprint**: Done

## Sprints
| Sprint | Focus | Status |
|--------|-------|--------|
| S1 | Public Event Listing + Detail + Search | 🟢 Done |

## Dependencies
- **Requires**: F003
- **Blocks**: F005

## Overview

Bezoekers kunnen gepubliceerde evenementen ontdekken en bekijken.

```
Als bezoeker
Wil ik evenementen kunnen zoeken en filteren
Zodat ik interessante evenementen kan vinden
```

## Flow Diagram

```
[Landing] → [Browse Events] → [Filter/Search]
                                    │
                                    ▼
                             [Event List]
                                    │
                                    ▼
                             [Event Detail]
```

## Supabase

### Tables
| Table | Purpose |
|-------|---------|
| `events` | Event data |
| `event_settings` | Public settings |

### RLS Policies
| Policy | Table | Rule |
|--------|-------|------|
| `public_read` | `events` | `status = 'published'` |

### Edge Functions
- None (uses direct table access with RLS)

## API Endpoints

| Method | Endpoint | Auth |
|--------|----------|------|
| GET | `/rest/v1/events?status=eq.published` | No |
| GET | `/rest/v1/events?slug=eq.{slug}` | No |

## Test Scenarios

| ID | Scenario | Expected |
|----|----------|----------|
| T1 | Browse public events | List of published events |
| T2 | Draft event hidden | Not in public list |
| T3 | Event detail | Full event info shown |
| T4 | Search by name | Filtered results |
| T5 | Filter by date | Events in date range |

## Acceptance Criteria

- [x] Only published events visible publicly
- [x] Draft events hidden from public
- [x] Event detail page works
- [x] Search functionality works
- [x] Filter by date works
- [x] Pagination works

## Deliverables

| Artifact | Status | Location |
|----------|--------|----------|
| Sprint Plan | Done | `sprints/s1-plan.md` |
| Architecture | Done | `sprints/s1-architecture.md` |
| SQL Migration | Done | `supabase/migrations/20250128150000_f004_event_discovery.sql` |
| PublicEvents Page | Done | `web/src/pages/public/PublicEvents.tsx` |
| PublicEventDetail Page | Done | `web/src/pages/public/PublicEventDetail.tsx` |
| Integration Tests | Done (12/12) | `tests/integration-tests.mjs` |
| Review | Approved | `sprints/s1-review.md` |
| Test Report | Done | `sprints/s1-test-report.md` |

---

*Last updated: 2026-01-28*
