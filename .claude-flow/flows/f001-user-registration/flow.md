# Flow: User Registration

**ID**: F001
**Status**: 🔴 Planned
**Total Sprints**: 2
**Current Sprint**: -

## Sprints
| Sprint | Focus | Status |
|--------|-------|--------|
| S1 | DB Schema + RLS | 🔴 |
| S2 | Edge Functions + Auth | 🔴 |

## Dependencies
- **Requires**: None (base flow)
- **Blocks**: F002, F008

## Overview

Nieuwe gebruikers kunnen een account aanmaken om deel te nemen aan evenementen of zelf evenementen te organiseren.

```
Als nieuwe gebruiker
Wil ik een account kunnen aanmaken
Zodat ik me kan inschrijven voor evenementen en mijn tickets kan beheren
```

## Flow Diagram

```
[Landing] → [Register] → [Form] → [Submit]
                                     │
                    ┌────────────────┴────────────────┐
                    ▼                                 ▼
            [Email Verify]                      [Error]
                    │
                    ▼
            [Verify Link]
                    │
                    ▼
            [Account Active] → [Dashboard]
```

## Supabase

### Tables
| Table | Purpose |
|-------|---------|
| `auth.users` | Core auth |
| `participants` | Extended profile |

### RLS Policies
| Policy | Table | Rule |
|--------|-------|------|
| `select_own` | `participants` | `user_id = auth.uid()` |
| `update_own` | `participants` | `user_id = auth.uid()` |

### Triggers
| Trigger | Table | Purpose |
|---------|-------|---------|
| `on_auth_user_created` | `auth.users` | Create `participants` record |

### Edge Functions
- None required (uses Supabase Auth)

## API Endpoints

| Method | Endpoint | Auth |
|--------|----------|------|
| POST | `/auth/v1/signup` | No |
| POST | `/auth/v1/verify` | No |
| GET | `/rest/v1/participants?id=eq.{id}` | Yes |

## Test Scenarios

| ID | Scenario | Expected |
|----|----------|----------|
| T1 | Happy path | Account created, verified |
| T2 | Duplicate email | Error: email exists |
| T3 | Weak password | Error: weak password |
| T4 | Invalid email | Validation error |
| T5 | Empty fields | Validation errors |

## Acceptance Criteria

- [ ] User can register with email/password
- [ ] Password strength validation
- [ ] Verification email sent
- [ ] `participants` record auto-created
- [ ] RLS prevents cross-user access
- [ ] All test scenarios pass

---

*Last updated: 2025-01-27*
