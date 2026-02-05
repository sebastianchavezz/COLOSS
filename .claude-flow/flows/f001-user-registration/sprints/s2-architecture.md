# F001 Sprint S2: Architecture Design

## Metadata

| Field | Value |
|-------|-------|
| **Flow** | F001 - User Registration |
| **Sprint** | S2 (Upgrade) |
| **Author** | @architect |
| **Date** | 2026-02-05 |
| **Status** | Approved |

---

## ADR-1: AuthCallback calls create_or_link_participant

**Decision**: Replace `link_current_user_to_participant()` call in AuthCallback with `create_or_link_participant()`.

**Rationale**:
- `create_or_link_participant()` already handles all 3 scenarios: already linked, link existing, create new
- It's a superset of `link_current_user_to_participant()`
- Passing first_name/last_name from auth.user.user_metadata ensures profile has name data

**Consequence**: Every authenticated user will always have a participant record after their first login.

## ADR-2: Profile editing via dedicated RPC

**Decision**: Create `update_my_participant_profile()` RPC instead of direct table UPDATE via RLS.

**Rationale**:
- SECURITY DEFINER ensures consistent validation
- Server-side validation for phone format, required fields
- Audit logging built into the function
- Matches existing pattern (all participant operations via RPC)

## ADR-3: Upgrade get_my_participant_profile

**Decision**: Add all profile fields to the existing RPC response.

**Rationale**: Current RPC only returns id, email, first_name, last_name, created_at, updated_at. Missing: phone, birth_date, gender, address, city, country.

---

## Database Changes

### Migration: `20260205100000_f001_s2_user_registration_upgrade.sql`

#### 1. Upgrade `get_my_participant_profile()` - Return all fields

```sql
CREATE OR REPLACE FUNCTION public.get_my_participant_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- Returns ALL participant fields including phone, birth_date, gender, city, country
$$;
```

#### 2. New RPC: `update_my_participant_profile()`

```sql
CREATE OR REPLACE FUNCTION public.update_my_participant_profile(
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_birth_date date DEFAULT NULL,
  p_gender text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_country text DEFAULT NULL
)
RETURNS jsonb
-- Updates only non-NULL params, validates, audit logs
```

---

## Frontend Changes

### 1. AuthCallback.tsx
- Replace `link_current_user_to_participant` with `create_or_link_participant`
- Pass first_name, last_name from `session.user.user_metadata`

### 2. Profiel.tsx
- Load profile via `get_my_participant_profile()` on mount
- Editable form fields: first_name, last_name, phone, birth_date, gender, city, country
- Save via `update_my_participant_profile()` RPC
- Show "Complete je profiel" banner when name is empty

---

## File Structure (Changes)

```
supabase/migrations/
  20260205100000_f001_s2_user_registration_upgrade.sql  # NEW

web/src/pages/
  AuthCallback.tsx     # MODIFIED: use create_or_link_participant
  sporter/
    Profiel.tsx        # MODIFIED: profile editing UI
```

---

*Architecture Design - F001 S2*
