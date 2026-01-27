/**
 * Supabase Client Factories
 *
 * Centralized Supabase client creation with proper error handling.
 * Security: Service role should ONLY be used in Edge Functions, never in client code.
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Create a Supabase client with service role key
 *
 * WARNING: This bypasses RLS. Only use in Edge Functions for server-side operations.
 *
 * @throws Error if SERVICE_ROLE_KEY is not configured
 * @returns Supabase client with admin privileges
 */
export function getServiceClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ??
                         Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl) {
    throw new Error('Missing SUPABASE_URL environment variable')
  }

  if (!serviceRoleKey) {
    throw new Error('Missing SERVICE_ROLE_KEY environment variable')
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })
}

/**
 * Create a Supabase client with anon key
 *
 * This respects RLS policies and is safe for public access.
 *
 * @throws Error if SUPABASE_ANON_KEY is not configured
 * @returns Supabase client with public privileges
 */
export function getAnonClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')

  if (!supabaseUrl) {
    throw new Error('Missing SUPABASE_URL environment variable')
  }

  if (!anonKey) {
    throw new Error('Missing SUPABASE_ANON_KEY environment variable')
  }

  return createClient(supabaseUrl, anonKey)
}

/**
 * Create a Supabase client with a specific auth token
 *
 * Useful for operations that need to respect RLS for a specific user.
 *
 * @param authToken - JWT token for the user
 * @returns Supabase client authenticated as the user
 */
export function getAuthenticatedClient(authToken: string): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')

  if (!supabaseUrl || !anonKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, anonKey, {
    global: {
      headers: { Authorization: `Bearer ${authToken}` }
    }
  })
}
