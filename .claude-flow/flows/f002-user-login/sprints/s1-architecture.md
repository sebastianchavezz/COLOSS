# F002 Sprint S1: Architecture

## Metadata

| Field | Value |
|-------|-------|
| **Flow** | F002 - User Login/Auth |
| **Sprint** | S1 |
| **Author** | @architect |
| **Date** | 2026-01-28 |

---

## Overview

Extend existing auth infrastructure with signup, password reset, and auto-linking to participants.

---

## Component Design

### 1. Signup Page (`web/src/pages/Signup.tsx`)

```typescript
// State
- email: string
- password: string
- confirmPassword: string
- firstName: string
- lastName: string
- loading: boolean
- message: { type: 'error' | 'success', text: string } | null

// Actions
- handleSignup() -> supabase.auth.signUp()
  - With user metadata: { first_name, last_name }
  - emailRedirectTo: /auth/callback

// UI
- Same layout as Login.tsx for consistency
- Google OAuth button (reuse from Login)
- Link to Login page
```

### 2. Reset Password Page (`web/src/pages/ResetPassword.tsx`)

```typescript
// Modes
- 'request': User enters email, sends reset link
- 'reset': User enters new password (from email link)

// Request Mode
- handleRequestReset() -> supabase.auth.resetPasswordForEmail()

// Reset Mode (URL has type=recovery token)
- handleUpdatePassword() -> supabase.auth.updateUser({ password })
- Redirect to login on success
```

### 3. Auth Callback Enhancement

Update `AuthCallback.tsx` to detect `type=recovery` in URL and redirect to reset password page.

---

## Database Changes

### Trigger: Auto-link participant on signup

When a new user is created in `auth.users`, check if a participant exists with matching email and link them.

```sql
-- Trigger function
CREATE OR REPLACE FUNCTION public.link_participant_on_signup()
RETURNS TRIGGER AS $$
BEGIN
  -- Update participant.user_id where email matches and user_id is NULL
  UPDATE public.participants
  SET user_id = NEW.id,
      updated_at = now()
  WHERE email = NEW.email
    AND user_id IS NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.link_participant_on_signup();
```

**Note**: Trigger on `auth.users` requires service role or Supabase auth hook.

---

## Routing Changes

Add to `App.tsx`:
```typescript
<Route path="/signup" element={<Signup />} />
<Route path="/reset-password" element={<ResetPassword />} />
```

---

## Sequence Diagrams

### Signup Flow
```
User                  Frontend              Supabase Auth         DB Trigger
  │                      │                        │                    │
  │──enters data────────►│                        │                    │
  │                      │──signUp()─────────────►│                    │
  │                      │                        │──INSERT auth.users─►│
  │                      │                        │                    │──link_participant()
  │                      │◄───email sent──────────│                    │
  │◄───"Check email"─────│                        │                    │
  │                      │                        │                    │
  │──clicks email link───►│                        │                    │
  │                      │──/auth/callback────────►│                    │
  │                      │◄───session created─────│                    │
  │◄───redirect to /─────│                        │                    │
```

### Password Reset Flow
```
User                  Frontend              Supabase Auth
  │                      │                        │
  │──enters email────────►│                        │
  │                      │──resetPasswordForEmail()►│
  │◄───"Check email"─────│◄───email sent──────────│
  │                      │                        │
  │──clicks reset link───►│                        │
  │                      │──/auth/callback?type=recovery
  │                      │──redirect to /reset-password
  │──enters new password─►│                        │
  │                      │──updateUser({ password })
  │◄───"Password updated"│◄───success─────────────│
```

---

## Security Considerations

1. **Password strength**: Supabase enforces minimum requirements
2. **Email verification**: Enabled by default in Supabase
3. **Rate limiting**: Supabase Auth has built-in rate limits
4. **CSRF**: Supabase JS client handles tokens securely

---

## File Structure

```
web/src/
├── pages/
│   ├── Login.tsx         # EXISTS
│   ├── Signup.tsx        # NEW
│   ├── ResetPassword.tsx # NEW
│   └── AuthCallback.tsx  # UPDATE (detect recovery)
└── App.tsx               # UPDATE (add routes)

supabase/migrations/
└── 20250128140000_f002_auth_participant_link.sql  # NEW
```

---

*Architecture - F002 User Login/Auth - 2026-01-28*
