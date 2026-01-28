# Flow: User Login/Auth

**ID**: F002
**Status**: 🟢 Done
**Total Sprints**: 1
**Current Sprint**: Done

## Sprints
| Sprint | Focus | Status |
|--------|-------|--------|
| S1 | Auth Foundation (Signup, Reset, Participant Link) | 🟢 Done |

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

- [x] Email/password login works
- [x] Magic link login works
- [x] Password reset works
- [x] Session persists across refresh
- [x] Logout destroys session
- [x] Rate limiting on login attempts (Supabase built-in)
- [x] Signup page with email/password
- [x] Auto-link participants to auth users

## Deliverables

| Artifact | Status | Location |
|----------|--------|----------|
| Sprint Plan | Done | `sprints/s1-plan.md` |
| Architecture | Done | `sprints/s1-architecture.md` |
| Signup Page | Done | `web/src/pages/Signup.tsx` |
| ResetPassword Page | Done | `web/src/pages/ResetPassword.tsx` |
| SQL Migration | Done | `supabase/migrations/20250128140000_f002_auth_participant_link.sql` |
| Integration Tests | Done (10/10) | `tests/integration-tests.mjs` |
| Review | Approved | `sprints/s1-review.md` |
| Test Report | Done | `sprints/s1-test-report.md` |

---

*Last updated: 2026-01-28*
