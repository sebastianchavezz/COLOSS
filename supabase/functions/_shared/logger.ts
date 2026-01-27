/**
 * Logging Utilities
 *
 * Structured logging for Edge Functions with request tracking.
 * All logs include function name and request ID for debugging.
 */

export interface Logger {
  requestId: string
  info: (message: string, ...args: any[]) => void
  error: (message: string, ...args: any[]) => void
  warn: (message: string, ...args: any[]) => void
  debug: (message: string, ...args: any[]) => void
}

/**
 * Create a logger instance for an Edge Function
 *
 * Usage:
 * ```typescript
 * const logger = createLogger('create-order')
 * logger.info('Order created', { orderId, total })
 * logger.error('Failed to create order', { error })
 * ```
 *
 * @param functionName - Name of the Edge Function
 * @param customRequestId - Optional custom request ID (generates UUID by default)
 * @returns Logger instance
 */
export function createLogger(functionName: string, customRequestId?: string): Logger {
  const requestId = customRequestId || crypto.randomUUID().slice(0, 8)

  return {
    requestId,

    info: (message: string, ...args: any[]) => {
      console.log(`[${requestId}] [${functionName}] ${message}`, ...args)
    },

    error: (message: string, ...args: any[]) => {
      console.error(`[${requestId}] [${functionName}] ERROR: ${message}`, ...args)
    },

    warn: (message: string, ...args: any[]) => {
      console.warn(`[${requestId}] [${functionName}] WARN: ${message}`, ...args)
    },

    debug: (message: string, ...args: any[]) => {
      // Only log debug in development
      const isDev = Deno.env.get('ENVIRONMENT') !== 'production'
      if (isDev) {
        console.log(`[${requestId}] [${functionName}] DEBUG: ${message}`, ...args)
      }
    },
  }
}

/**
 * Create a simple request ID
 *
 * Useful when you need just the ID without the full logger.
 *
 * @returns 8-character request ID
 */
export function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8)
}
