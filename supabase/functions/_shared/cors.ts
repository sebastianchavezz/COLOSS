/**
 * CORS Configuration & Handlers
 *
 * Centralized CORS headers to prevent duplication across Edge Functions.
 * All Edge Functions should import from here instead of defining their own.
 */

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
}

/**
 * Handle CORS preflight requests
 *
 * Usage:
 * ```typescript
 * const corsResponse = handleCors(req)
 * if (corsResponse) return corsResponse
 * ```
 *
 * @param req - The incoming request
 * @returns Response for OPTIONS request, null otherwise
 */
export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  return null
}
