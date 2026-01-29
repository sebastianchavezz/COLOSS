/**
 * Authentication Helpers
 *
 * Centralized auth logic to prevent duplication.
 * Handles user authentication and authorization.
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { User } from 'https://esm.sh/@supabase/supabase-js@2'

export interface AuthResult {
  user: User | null
  error: string | null
  client: SupabaseClient | null
}

/**
 * Authenticate user from Authorization header
 *
 * Usage:
 * ```typescript
 * const { user, error, client } = await authenticateUser(req)
 * if (error) {
 *   return errorResponse('Unauthorized', error, 401)
 * }
 * ```
 *
 * @param req - The incoming request
 * @returns Auth result with user, error, and authenticated client
 */
export async function authenticateUser(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get('Authorization')

  // Debug: log auth header presence
  console.log('[auth] Auth header present:', !!authHeader)

  if (!authHeader) {
    return { user: null, error: 'NO_AUTH_HEADER', client: null }
  }

  // Debug: log token info (first 50 chars)
  const token = authHeader.replace('Bearer ', '')
  console.log('[auth] Token preview:', token.substring(0, 50) + '...')

  // Debug: try to decode token header
  try {
    const header = JSON.parse(atob(token.split('.')[0]))
    console.log('[auth] Token header:', JSON.stringify(header))
  } catch (e) {
    console.log('[auth] Could not decode token header:', e)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')

  console.log('[auth] Supabase URL:', supabaseUrl ? 'set' : 'NOT SET')
  console.log('[auth] Supabase Anon Key:', supabaseAnonKey ? 'set' : 'NOT SET')

  if (!supabaseUrl || !supabaseAnonKey) {
    return { user: null, error: 'SERVER_CONFIG_ERROR', client: null }
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } }
  })

  console.log('[auth] Calling getUser()...')
  const { data: { user }, error: authError } = await client.auth.getUser()

  if (authError) {
    console.log('[auth] getUser() error:', authError.message, authError.status)
    return { user: null, error: `INVALID_TOKEN: ${authError.message}`, client }
  }

  if (!user) {
    console.log('[auth] getUser() returned no user')
    return { user: null, error: 'NO_USER_RETURNED', client }
  }

  console.log('[auth] User authenticated:', user.id)
  return { user, error: null, client }
}

/**
 * Verify user is a member of an organization
 *
 * @param client - Authenticated Supabase client (service role recommended)
 * @param orgId - Organization ID
 * @param userId - User ID to check
 * @param requiredRoles - Optional array of required roles
 * @returns True if user is a member with required role
 */
export async function isOrgMember(
  client: SupabaseClient,
  orgId: string,
  userId: string,
  requiredRoles?: string[]
): Promise<boolean> {
  const query = client
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .single()

  const { data: membership } = await query

  if (!membership) return false
  if (!requiredRoles || requiredRoles.length === 0) return true

  return requiredRoles.includes(membership.role)
}
