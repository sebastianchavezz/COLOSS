# Shared Utilities

This directory contains shared code used across multiple Edge Functions to prevent duplication and ensure consistency.

## Why This Exists

Edge Functions had significant code duplication:
- CORS headers defined 13 times
- Authentication logic duplicated in 10 functions
- Response helpers copied everywhere
- Service role setup repeated 8 times

This violates the DRY principle and makes maintenance difficult.

## Available Utilities

### `cors.ts`
- `corsHeaders` - Standard CORS headers
- `handleCors(req)` - Handle OPTIONS requests

### `response.ts`
- `jsonResponse(data, status)` - Create JSON response
- `errorResponse(error, code, status, details)` - Standardized errors
- `successResponse(data, message)` - Standardized success

### `auth.ts`
- `authenticateUser(req)` - Extract & verify user from auth header
- `isOrgMember(client, orgId, userId, roles)` - Check org membership

### `supabase.ts`
- `getServiceClient()` - Create admin client (bypasses RLS)
- `getAnonClient()` - Create public client (respects RLS)
- `getAuthenticatedClient(token)` - Create user-scoped client

### `logger.ts`
- `createLogger(functionName)` - Create structured logger with request ID
- `generateRequestId()` - Generate unique request ID

### `types.ts`
- Common TypeScript types and interfaces
- Prevents type duplication

## Usage Example

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { authenticateUser } from '../_shared/auth.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

serve(async (req: Request) => {
  // 1. Handle CORS
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  const logger = createLogger('my-function')
  logger.info('Function invoked')

  try {
    // 2. Authenticate
    const { user, error: authError } = await authenticateUser(req)
    if (authError) {
      return errorResponse('Unauthorized', authError, 401)
    }

    // 3. Business logic
    const admin = getServiceClient()
    // ... your code here

    return jsonResponse({ success: true })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Unexpected error', message)
    return errorResponse('Internal server error', 'UNEXPECTED_ERROR', 500)
  }
})
```

## Migration Guide

To migrate an existing Edge Function:

1. **Remove duplicated code** (CORS, auth, responses)
2. **Import from _shared** instead
3. **Test thoroughly** - behavior should be identical
4. **Check error codes** - ensure consistency

## Rules

- **NEVER duplicate** code that exists here
- **Add to _shared** if you're about to copy-paste
- **Keep it generic** - shared code shouldn't contain business logic
- **Document thoroughly** - others will use your code
- **Test changes** - shared code affects all functions

## Maintenance

When you modify shared code:
- Test ALL functions that use it
- Document breaking changes
- Version carefully if needed
- Consider backward compatibility
