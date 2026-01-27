/**
 * Shared TypeScript Types
 *
 * Common types used across multiple Edge Functions.
 * Prevents duplication and ensures type consistency.
 */

/**
 * Standard API error response
 */
export interface ErrorResponse {
  error: string
  code: string
  details?: unknown
}

/**
 * Standard API success response
 */
export interface SuccessResponse<T = unknown> {
  success: true
  data?: T
  message?: string
}

/**
 * Order item for checkout
 */
export interface OrderItemInput {
  ticket_type_id: string
  quantity: number
}

/**
 * Org member role types
 */
export type OrgRole = 'owner' | 'admin' | 'support' | 'finance'

/**
 * Order status types
 */
export type OrderStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'expired'

/**
 * Ticket status types
 */
export type TicketStatus = 'pending' | 'valid' | 'used' | 'cancelled'

/**
 * Registration status types
 */
export type RegistrationStatus = 'pending' | 'confirmed' | 'cancelled' | 'waitlist'

/**
 * Payment provider types
 */
export type PaymentProvider = 'mollie' | 'stripe' | 'free'

/**
 * Event status types
 */
export type EventStatus = 'draft' | 'published' | 'closed'

/**
 * Email status types (for email_outbox)
 */
export type EmailStatus =
    | 'queued'
    | 'processing'
    | 'sent'
    | 'delivered'
    | 'bounced'
    | 'soft_bounced'
    | 'complained'
    | 'failed'
    | 'cancelled'

/**
 * Batch status types (for message_batches)
 */
export type BatchStatus =
    | 'draft'
    | 'queued'
    | 'processing'
    | 'sending'
    | 'completed'
    | 'paused'
    | 'cancelled'
    | 'failed'

/**
 * Email type for compliance
 */
export type EmailType = 'transactional' | 'marketing' | 'system'
