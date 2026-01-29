# F003 Bug Tracker

## Bugs

| ID | Bug | Status | Fixed |
|----|-----|--------|-------|
| B001 | Leaflet image imports fail with Vite bundler | Fixed | 2026-01-28 |
| B002 | process-gpx Edge Function not deployed - CORS error | Fixed | 2026-01-28 |
| B003 | process-gpx returns 401 - missing auth header | Fixed | 2026-01-28 |
| B004 | process-gpx auth verification fails with service role key | Fixed | 2026-01-28 |
| B005 | process-gpx 401 "Invalid JWT" from Edge Runtime | Fixed | 2026-01-28 |
| B006 | process-gpx 500 SAVE_FAILED - RPC auth.uid() NULL | Fixed | 2026-01-28 |
| B007 | process-gpx 500 - .catch() not a function on Supabase query | Fixed | 2026-01-28 |
| B008 | audit_log column "actor_id" does not exist | Fixed | 2026-01-28 |
| B009 | audit_log column "resource_type" NOT NULL violation | Fixed | 2026-01-28 |
| B010 | audit_log has BOTH resource_type AND entity_type as NOT NULL | Fixed | 2026-01-28 |

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

## B002: process-gpx Edge Function Not Deployed

**Error**:
```
Access to fetch at 'https://yihypotpywllwoymjduz.supabase.co/functions/v1/process-gpx' from origin 'http://localhost:5173' has been blocked by CORS policy
```

**Symptom**: GPX upload preview works (client-side parsing) but "Opslaan" button fails with CORS error.

**Root Cause**: The `process-gpx` Edge Function was created but never deployed to Supabase production.

**Fix Applied**:
```bash
supabase functions deploy process-gpx --project-ref yihypotpywllwoymjduz
```

**Verification**: Function now listed in `supabase functions list` with ACTIVE status.

---

## B003: process-gpx Returns 401 Unauthorized

**Error**:
```
Failed to load resource: the server responded with a status of 401 ()
Edge Function returned a non-2xx status code
```

**Symptom**: After deploying the function, saving GPX still fails with 401.

**Root Cause**: `supabase.functions.invoke()` does not automatically include the Authorization header when sessions are stored in `sessionStorage` (instead of `localStorage`).

**Fix Applied**: Explicitly get the session and pass the auth header:

```typescript
// Get current session for auth header
const { data: { session } } = await supabase.auth.getSession();

if (!session?.access_token) {
  throw new Error('Je bent niet ingelogd.');
}

const { data, error } = await supabase.functions.invoke('process-gpx', {
  body: { ... },
  headers: {
    Authorization: `Bearer ${session.access_token}`,
  },
});
```

**Files Modified**:
- `web/src/pages/events/EventRouteAdmin.tsx` - Added explicit auth header

**Verification**: `npm run build` passes successfully

---

## B004: process-gpx Auth Verification Fails

**Error**: `401 Unauthorized` even with valid auth header

**Symptom**: After adding explicit auth header in frontend, Edge Function still returns 401.

**Root Cause**: The Edge Function was using `supabase.auth.getUser(token)` with the service role client. This doesn't work because the service role key bypasses auth, so `getUser()` can't verify user tokens properly.

**Fix Applied**: Create separate clients for auth verification vs DB operations:

```typescript
// Service role client for DB operations (bypasses RLS)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Create client with the user's JWT to verify it
const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    headers: { Authorization: `Bearer ${token}` },
  },
});

const { data: { user }, error } = await supabaseAuth.auth.getUser();

// Use admin client for DB ops
const supabase = supabaseAdmin;
```

**Files Modified**:
- `supabase/functions/process-gpx/index.ts` - Separate auth client from admin client

**Verification**: Redeployed function

---

## B005: process-gpx 401 "Invalid JWT" from Edge Runtime

**Error**:
```
POST https://yihypotpywllwoymjduz.supabase.co/functions/v1/process-gpx 401 (Unauthorized)
{"code":401,"message":"Invalid JWT"}
```

**Symptom**: Despite valid JWT token (correct iss, aud, role, not expired), Supabase Edge Runtime returns "Invalid JWT" before the function code even executes.

**Root Cause**: Supabase Edge Functions have JWT verification enabled by default at the **runtime level** (before function code executes). When calling with a user JWT in the Authorization header and anon key in the apikey header, the runtime's JWT verification fails because it expects a different format.

**Fix Applied**: Disable runtime-level JWT verification and handle auth manually in function code:

```bash
# Deploy with --no-verify-jwt flag
supabase functions deploy process-gpx --project-ref yihypotpywllwoymjduz --no-verify-jwt
```

Also added to `supabase/config.toml` for local development:
```toml
[functions.process-gpx]
enabled = true
verify_jwt = false
entrypoint = "./functions/process-gpx/index.ts"
```

**Files Modified**:
- `supabase/config.toml` - Added process-gpx function config with verify_jwt = false

**Verification**: Function redeployed with --no-verify-jwt flag

---

## B006: process-gpx 500 SAVE_FAILED - RPC auth.uid() NULL

**Error**:
```
[GPX Upload] Response status: 500
Upload error: Error: SAVE_FAILED
```

**Symptom**: Auth now works (B005 fixed), but saving route to database fails with 500.

**Root Cause**: The Edge Function uses service role key (bypasses RLS), then calls `save_event_route` RPC which has `auth.uid()` check. Service role doesn't set `auth.uid()`, so it's NULL and the RPC returns `UNAUTHORIZED`.

**Fix Applied**: Replace RPC call with direct database operations using service role client:

```typescript
// Soft delete existing route first
await supabase
  .from("event_routes")
  .update({ deleted_at: new Date().toISOString() })
  .eq("event_id", event_id)
  .is("deleted_at", null);

// Insert new route directly (service role bypasses RLS)
const { data: savedRoute, error: saveError } = await supabase
  .from("event_routes")
  .insert({
    org_id: event.org_id,
    event_id: event_id,
    // ... other fields
    updated_by: user.id,  // User ID from auth verification
  })
  .select()
  .single();
```

**Files Modified**:
- `supabase/functions/process-gpx/index.ts` - Direct DB operations instead of RPC

**Verification**: Function redeployed

---

*Last updated: 2026-01-28*
