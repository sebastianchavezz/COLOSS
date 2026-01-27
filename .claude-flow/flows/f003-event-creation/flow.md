# Flow: Event Creation

**ID**: F003
**Status**: 🔴 Planned
**Total Sprints**: 3
**Current Sprint**: -

## Sprints
| Sprint | Focus | Status |
|--------|-------|--------|
| S1 | DB Schema (events, orgs) | 🔴 |
| S2 | RLS + Multi-tenant | 🔴 |
| S3 | Edge Functions + Validation | 🔴 |

## Dependencies
- **Requires**: F002
- **Blocks**: F004, F010

## Overview

Organisatoren kunnen nieuwe evenementen aanmaken en beheren.

```
Als organisator
Wil ik een nieuw evenement kunnen aanmaken
Zodat deelnemers zich kunnen inschrijven
```

## Flow Diagram

```
[Dashboard] → [Create Event] → [Form]
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
              [Draft Saved]               [Validation Error]
                    │
                    ▼
              [Edit/Preview]
                    │
                    ▼
              [Publish] → [Event Live]
```

## Supabase

### Tables
| Table | Purpose |
|-------|---------|
| `orgs` | Organizations |
| `org_members` | Org membership |
| `events` | Event records |
| `event_settings` | Event config |

### RLS Policies
| Policy | Table | Rule |
|--------|-------|------|
| `select_org_member` | `events` | User is org member |
| `insert_org_admin` | `events` | User is org owner/admin |
| `update_org_admin` | `events` | User is org owner/admin |

### Edge Functions
| Function | Purpose |
|----------|---------|
| `create-event` | Validate & create event |
| `publish-event` | Validate & publish |

## API Endpoints

| Method | Endpoint | Auth |
|--------|----------|------|
| POST | `/rest/v1/events` | Yes (org admin) |
| PATCH | `/rest/v1/events?id=eq.{id}` | Yes (org admin) |
| POST | `/functions/v1/publish-event` | Yes (org admin) |

## Test Scenarios

| ID | Scenario | Expected |
|----|----------|----------|
| T1 | Create draft | Event saved as draft |
| T2 | Publish event | Status → published |
| T3 | Non-org-member | RLS denied |
| T4 | Missing required fields | Validation error |
| T5 | Cross-org access | RLS denied |

## Acceptance Criteria

- [ ] Org admin can create events
- [ ] Draft → Published lifecycle works
- [ ] RLS enforces org isolation
- [ ] Required fields validated
- [ ] Slug is unique per org

---

*Last updated: 2025-01-27*
