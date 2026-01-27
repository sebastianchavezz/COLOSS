# Flow: Event Discovery

**ID**: F004
**Status**: 🔴 Planned
**Total Sprints**: 2
**Current Sprint**: -

## Sprints
| Sprint | Focus | Status |
|--------|-------|--------|
| S1 | Public event listing | 🔴 |
| S2 | Search + Filter | 🔴 |

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

- [ ] Only published events visible publicly
- [ ] Draft events hidden from public
- [ ] Event detail page works
- [ ] Search functionality works
- [ ] Filter by date/location works

---

*Last updated: 2025-01-27*
