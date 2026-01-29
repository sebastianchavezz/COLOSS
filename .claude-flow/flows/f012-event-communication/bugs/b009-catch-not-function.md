# B009: .catch() is not a function on Supabase query

**Status**: ✅ Fixed
**Flow**: F012
**Date**: 2026-01-29
**Attempts**: 1

## Bug

500 Internal Server Error when sending chat message:
```
supabaseAdmin.from(...).update(...).eq(...).catch is not a function
```

## Root Cause

Supabase's `PostgrestFilterBuilder` does not have a `.catch()` method. The query builder returns a Promise-like object that must be awaited, and errors must be extracted from the response.

## Fix

Replace invalid `.catch()` with proper Supabase error handling pattern:

**Before:**
```typescript
await supabaseAdmin
    .from('chat_threads')
    .update({ participant_has_access: participantHasAccess })
    .eq('id', activeThreadId)
    .catch((err) => logger.warn(...))
```

**After:**
```typescript
const { error: updateAccessError } = await supabaseAdmin
    .from('chat_threads')
    .update({ participant_has_access: participantHasAccess })
    .eq('id', activeThreadId)

if (updateAccessError) {
    logger.warn('Failed to update participant_has_access', { error: updateAccessError.message })
}
```

## Files

- `supabase/functions/send-message/index.ts:265-274` - Fixed error handling

## Test

- [x] Chat message sends without 500 error
