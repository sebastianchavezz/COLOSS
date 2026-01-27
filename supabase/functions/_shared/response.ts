/**
 * Response Helpers
 *
 * Standardized response builders for Edge Functions.
 * Ensures consistent error codes and response formats.
 */

import { corsHeaders } from './cors.ts'

/**
 * Create a JSON response with CORS headers
 *
 * @param data - The data to return
 * @param status - HTTP status code (default: 200)
 * @returns Response object
 */
export function jsonResponse(data: object, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/**
 * Create a standardized error response
 *
 * @param error - Error message
 * @param code - Error code (for client-side handling)
 * @param status - HTTP status code (default: 400)
 * @param details - Optional additional details
 * @returns Response object
 */
export function errorResponse(
  error: string,
  code: string,
  status: number = 400,
  details?: unknown
): Response {
  const body: { error: string; code: string; details?: unknown } = { error, code }
  if (details !== undefined) {
    body.details = details
  }
  return jsonResponse(body, status)
}

/**
 * Create a success response
 *
 * @param data - Success data
 * @param message - Optional success message
 * @returns Response object
 */
export function successResponse(data: object, message?: string): Response {
  const body = message ? { success: true, message, ...data } : { success: true, ...data }
  return jsonResponse(body, 200)
}
