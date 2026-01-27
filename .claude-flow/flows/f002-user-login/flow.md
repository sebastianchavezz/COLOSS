# Flow: User Login/Auth

**ID**: F002
**Status**: 🔴 Planned
**Total Sprints**: 2
**Current Sprint**: -

## Sprints
| Sprint | Focus | Status |
|--------|-------|--------|
| S1 | Auth Setup + Sessions | 🔴 |
| S2 | Magic Link + Password Reset | 🔴 |

## Dependencies
- **Requires**: F001
- **Blocks**: F003, F008, F010

## Overview

Bestaande gebruikers kunnen inloggen en hun sessie beheren.

```
Als geregistreerde gebruiker
Wil ik kunnen inloggen met mijn credentials
Zodat ik toegang krijg tot mijn account en tickets
```

## Flow Diagram

```
[Landing] → [Login Form]
                │
    ┌───────────┴───────────┐
    ▼                       ▼
[Email/Pass]          [Magic Link]
    │                       │
    ▼                       ▼
[Verify]              [Send Email]
    │                       │
    ▼                       ▼
[Session]             [Click Link]
    │                       │
    └───────────┬───────────┘
                ▼
          [Dashboard]
```

## Supabase

### Tables
| Table | Purpose |
|-------|---------|
| `auth.users` | Authentication |
| `auth.sessions` | Session management |

### RLS Policies
- Uses Supabase Auth built-in policies

### Edge Functions
| Function | Purpose |
|----------|---------|
| `send-magic-link` | Custom magic link email (optional) |

## API Endpoints

| Method | Endpoint | Auth |
|--------|----------|------|
| POST | `/auth/v1/token?grant_type=password` | No |
| POST | `/auth/v1/otp` | No |
| POST | `/auth/v1/logout` | Yes |
| POST | `/auth/v1/recover` | No |

## Test Scenarios

| ID | Scenario | Expected |
|----|----------|----------|
| T1 | Valid login | Session created, redirected |
| T2 | Invalid password | Error: invalid credentials |
| T3 | Non-existent user | Error: user not found |
| T4 | Magic link | Email sent, link works |
| T5 | Password reset | Reset email sent |
| T6 | Logout | Session destroyed |

## Acceptance Criteria

- [ ] Email/password login works
- [ ] Magic link login works
- [ ] Password reset works
- [ ] Session persists across refresh
- [ ] Logout destroys session
- [ ] Rate limiting on login attempts

---

*Last updated: 2025-01-27*
