# B001: useOutletContext undefined on initial render

**Status**: ✅ Fixed
**Flow**: f014-team-management
**Date**: 28-01-2026
**Attempts**: 1

## Bug

```
Uncaught TypeError: Cannot destructure property 'org' of 'useOutletContext(...)' as it is undefined.
    at TeamPage (TeamPage.tsx:36:13)
```

De TeamPage crashed bij initial render omdat `useOutletContext()` undefined retourneert voordat de Layout component klaar is met laden.

## Root Cause

De destructuring `const { org } = useOutletContext<LayoutContext>()` faalt als de context nog niet beschikbaar is tijdens de eerste render cycle.

## Fix

1. Safe access van context: `const context = useOutletContext<LayoutContext>()`
2. Optional chaining: `const org = context?.org`
3. Guard clause toegevoegd die loading spinner toont als `org` undefined is

## Files
- `web/src/pages/TeamPage.tsx` - Safe context access + guard clause

## Test
- [x] Build succeeds
- [x] No TypeScript errors
- [x] TeamPage loads without crash

## Notes
Attempt 1: Added optional chaining and guard - Success
