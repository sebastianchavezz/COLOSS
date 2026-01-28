# F003 Bug Tracker

## Bugs

| ID | Bug | Status | Fixed |
|----|-----|--------|-------|
| B001 | Leaflet image imports fail with Vite bundler | Fixed | 2026-01-28 |

---

## B001: Leaflet Image Imports

**Error**: `[plugin:vite:import-analysis] Failed to resolve import "leaflet" from "src/components/RouteMap.tsx"`

**Root Cause**: Vite bundler couldn't resolve Leaflet's default marker icon images from node_modules.

**Fix Applied**:
1. Changed image imports from local file imports to CDN URLs in `RouteMap.tsx`
2. Fixed type-only import for `ParsedGpx` in `EventRouteAdmin.tsx`
3. Removed unused `Clock` import from `PublicEventDetail.tsx`
4. Removed unused `navigate` import from `Signup.tsx`

**Files Modified**:
- `web/src/components/RouteMap.tsx` - CDN URLs for marker icons
- `web/src/pages/events/EventRouteAdmin.tsx` - type-only import fix
- `web/src/pages/public/PublicEventDetail.tsx` - removed unused import
- `web/src/pages/Signup.tsx` - removed unused import

**Verification**: `npm run build` passes successfully

---

*Last updated: 2026-01-28*
