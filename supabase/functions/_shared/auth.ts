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
  if (!authHeader) {
    return { user: null, error: 'NO_AUTH_HEADER', client: null }
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')

  if (!supabaseUrl || !supabaseAnonKey) {
    return { user: null, error: 'SERVER_CONFIG_ERROR', client: null }
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } }
  })

  const { data: { user }, error: authError } = await client.auth.getUser()

  if (authError || !user) {
    return { user: null, error: 'INVALID_TOKEN', client }
  }

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
