# F002 Sprint S1: Auth Foundation

## Metadata

| Field | Value |
|-------|-------|
| **Flow** | F002 - User Login/Auth |
| **Sprint** | S1 |
| **Author** | @pm |
| **Date** | 2026-01-28 |
| **Status** | Review Existing Implementation |

---

## Current State Analysis

### Already Implemented
| Component | Location | Status |
|-----------|----------|--------|
| Login Page | `web/src/pages/Login.tsx` | Email/password + Magic Link + Google OAuth |
| AuthContext | `web/src/contexts/AuthContext.tsx` | Session management, signOut |
| ProtectedRoute | `web/src/components/ProtectedRoute.tsx` | Route guarding |
| AuthCallback | `web/src/pages/AuthCallback.tsx` | OAuth redirect handling |
| Auth Helpers | `web/src/lib/auth-helpers.ts` | Return-to path storage |
| Participants Table | Layer 3 migration | `user_id` FK to `auth.users` |

### Missing Components
| Component | Priority | Description |
|-----------|----------|-------------|
| Signup Page | HIGH | Users can create account with email/password |
| Password Reset | HIGH | "Forgot password" flow |
| Profile Page | MEDIUM | View/edit profile, link to participant |
| Auto-link Participant | MEDIUM | Link auth user to existing participant by email |

---

## Sprint Scope

This sprint will add:
1. **Signup flow** - Email/password registration
2. **Password reset flow** - Forgot password with email
3. **Auto-link participants** - When user signs up, auto-link to existing participant record if email matches

### Out of Scope (S2)
- Profile/settings page
- Account deletion
- 2FA/MFA
- Custom email templates

---

## Deliverables

| Artifact | Status |
|----------|--------|
| Sprint Plan | This document |
| Architecture | `s1-architecture.md` |
| Signup Page | `web/src/pages/Signup.tsx` |
| Reset Password Page | `web/src/pages/ResetPassword.tsx` |
| DB Trigger | Auto-link participants |
| Integration Tests | `tests/integration-tests.mjs` |
| Code Review | `s1-review.md` |

---

## Acceptance Criteria

- [ ] User can create account with email/password
- [ ] User receives email confirmation link
- [ ] User can request password reset
- [ ] Password reset email is sent
- [ ] New user auto-linked to existing participant (same email)
- [ ] All auth pages have consistent UI
- [ ] Tests verify signup and reset flows

---

*Sprint Plan - F002 User Login/Auth - 2026-01-28*
