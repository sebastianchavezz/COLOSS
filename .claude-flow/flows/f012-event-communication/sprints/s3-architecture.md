# F012 S3: Open Chat Access - Architecture

## Overview

Verwijder de ticket/registratie vereiste voor chat. Elke ingelogde gebruiker kan chatten.

## Current Architecture

```
User → send-message Edge Function
         │
         ├── Check: Is user participant? ❌ Block if no
         │
         └── Check: check_participant_event_access() ❌ Block if no ticket
```

## New Architecture

```
User → send-message Edge Function
         │
         ├── Auto-create participant if needed ✅
         │
         └── Track has_event_access for organizer context ✅
```

## Changes

### 1. Database Migration

Add column to track participant status for organizer UI:

```sql
ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS
    participant_has_access boolean DEFAULT false;
```

### 2. Edge Function: send-message/index.ts

**Lines 179-183** - Remove strict check:
```typescript
// OLD: Block if not participant or organizer
if (!isParticipant && !isOrganizer) { return 403 }

// NEW: Auto-create participant if needed
if (!isParticipant && !isOrganizer) {
    // Create participant from auth user
    participant = await createParticipantFromUser(user)
    isParticipant = true
}
```

**Lines 206-224** - Remove access check, track status instead:
```typescript
// OLD: Block if no access
if (!hasAccess) { return 403 }

// NEW: Just track for organizer UI, don't block
const hasAccess = await checkAccess()
// Continue regardless of hasAccess value
// Update thread.participant_has_access = hasAccess
```

### 3. Edge Function: get-threads/index.ts

Include `participant_has_access` in response for organizer badge display.

## Files to Modify

| File | Change |
|------|--------|
| `supabase/migrations/20260129_f012_open_chat.sql` | Add participant_has_access column |
| `supabase/functions/send-message/index.ts` | Remove access block, auto-create participant |
| `supabase/functions/get-threads/index.ts` | Include access status |

## Backwards Compatibility

- Existing threads: Backfill `participant_has_access` based on current access
- New threads: Calculate on creation
- No breaking changes

---

*F012 S3 Architecture - Open Chat Access*
