# F001 Sprint S2: End User Registration in App

## Metadata

| Field | Value |
|-------|-------|
| **Flow** | F001 - User Registration |
| **Sprint** | S2 (Upgrade) |
| **Author** | @pm |
| **Date** | 2026-02-05 |
| **Status** | Active |
| **Type** | Upgrade - Backwards compatible |

---

## Problem Statement

Fresh signups get an auth account but NO participant profile is created:
- `link_current_user_to_participant()` only links EXISTING participants by email
- `create_or_link_participant()` exists but is NEVER called
- Profiel page shows only auth data, no profile editing
- `get_my_participant_profile()` doesn't return phone/birth_date/gender/address fields
- No `update_my_participant_profile()` RPC exists

## Goal

1. Auto-create participant profile on signup (call `create_or_link_participant` in AuthCallback)
2. Add `update_my_participant_profile()` RPC for profile editing
3. Upgrade `get_my_participant_profile()` to return ALL profile fields
4. Build profile editing UI in Profiel page

## Scope

### In Scope
- Fix AuthCallback to call `create_or_link_participant` instead of just `link_current_user_to_participant`
- New RPC: `update_my_participant_profile()` for profile editing
- Upgrade `get_my_participant_profile()` to return all fields
- Upgrade Profiel.tsx with profile editing (name, phone, birth_date, gender, city)
- Migration for the new RPC

### Out of Scope
- Profile photo upload
- Social login profile sync
- Address verification

## Acceptance Criteria

### AC1: Auto-create participant on signup
- When a fresh user signs up, a participant record is auto-created
- Uses first_name/last_name from auth metadata
- Works for both email signup and Google OAuth
- Backwards compatible: existing link flow still works

### AC2: Profile editing
- User can edit: first_name, last_name, phone, birth_date, gender, city, country
- Changes saved via RPC (not direct table access)
- Validation: first_name required, phone format check

### AC3: Profile display
- Profiel page loads and displays all profile fields
- Shows loading state while fetching
- Shows "Complete je profiel" prompt if fields are empty

### AC4: Backwards compatibility
- Existing `link_current_user_to_participant()` still works
- Existing `sync_registration_on_payment()` still works
- No breaking changes to participants table

---

## Technical Tasks

### Phase 1: Database Migration
- Task 1.1: Create `update_my_participant_profile()` RPC
- Task 1.2: Upgrade `get_my_participant_profile()` to return all columns

### Phase 2: Frontend Changes
- Task 2.1: Update AuthCallback to call `create_or_link_participant`
- Task 2.2: Upgrade Profiel.tsx with profile editing form
- Task 2.3: Add profile loading in AuthContext or Profiel page

---

*Sprint S2 Plan - F001 User Registration Upgrade*
