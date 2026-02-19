/**
 * Mollie API Helpers
 *
 * Shared helpers for Mollie Customer, Mandate, and Subscription management.
 * Used by create-subscription-checkout, mollie-webhook, and manage-subscription.
 */

const MOLLIE_API_URL = "https://api.mollie.com/v2"
const MOLLIE_FETCH_TIMEOUT_MS = 10000

function getMollieApiKey(): string {
  const key = Deno.env.get('MOLLIE_API_KEY')
  if (!key) throw new Error('Missing MOLLIE_API_KEY environment variable')
  return key
}

/**
 * Fetch with timeout using AbortController
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = MOLLIE_FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    clearTimeout(timeoutId)
    return response
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }
}

// =====================================================
// CUSTOMER MANAGEMENT
// =====================================================

export interface MollieCustomer {
  id: string           // cst_xxx
  name?: string
  email?: string
  metadata?: Record<string, string>
}

/**
 * Get or create a Mollie Customer for a user.
 *
 * If the user already has a mollie_customers record, returns the existing Mollie customer.
 * Otherwise, creates a new Mollie customer and stores the mapping.
 */
export async function getOrCreateMollieCustomer(
  supabaseAdmin: any,
  userId: string,
  email: string,
  name?: string
): Promise<{ customerId: string; isNew: boolean }> {
  // Check if user already has a Mollie customer
  const { data: existing } = await supabaseAdmin
    .from('mollie_customers')
    .select('mollie_customer_id')
    .eq('user_id', userId)
    .single()

  if (existing?.mollie_customer_id) {
    return { customerId: existing.mollie_customer_id, isNew: false }
  }

  // Create new Mollie customer via API
  const apiKey = getMollieApiKey()
  const response = await fetchWithTimeout(
    `${MOLLIE_API_URL}/customers`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: name || email,
        email,
        metadata: { user_id: userId },
      }),
    }
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(`Mollie create customer failed: ${response.status} - ${JSON.stringify(error)}`)
  }

  const customer: MollieCustomer = await response.json()

  // Store in DB
  const { error: insertError } = await supabaseAdmin
    .from('mollie_customers')
    .insert({
      user_id: userId,
      mollie_customer_id: customer.id,
      mandate_status: 'pending',
    })

  if (insertError) {
    // Handle race condition: another request already created the customer
    if (insertError.code === '23505') {
      const { data: race } = await supabaseAdmin
        .from('mollie_customers')
        .select('mollie_customer_id')
        .eq('user_id', userId)
        .single()
      return { customerId: race.mollie_customer_id, isNew: false }
    }
    throw new Error(`Failed to store Mollie customer: ${insertError.message}`)
  }

  return { customerId: customer.id, isNew: true }
}

// =====================================================
// MANDATE MANAGEMENT
// =====================================================

export interface MollieMandate {
  id: string           // mdt_xxx
  status: string       // valid, pending, invalid
  method: string
  details?: any
}

/**
 * Get the first valid mandate for a Mollie customer.
 */
export async function getCustomerMandate(
  customerId: string
): Promise<MollieMandate | null> {
  const apiKey = getMollieApiKey()
  const response = await fetchWithTimeout(
    `${MOLLIE_API_URL}/customers/${customerId}/mandates`,
    { headers: { 'Authorization': `Bearer ${apiKey}` } }
  )

  if (!response.ok) return null

  const data = await response.json()
  const mandates = data._embedded?.mandates || []

  // Return first valid mandate, or first pending one
  return mandates.find((m: MollieMandate) => m.status === 'valid')
    || mandates.find((m: MollieMandate) => m.status === 'pending')
    || null
}

// =====================================================
// SUBSCRIPTION MANAGEMENT
// =====================================================

export interface CreateMollieSubscriptionParams {
  customerId: string
  amount: { currency: string; value: string }
  interval: string       // "1 month", "3 months", "1 year"
  description: string
  times?: number         // Number of charges (omit for open-ended)
  webhookUrl: string
  metadata?: Record<string, string>
}

/**
 * Create a Mollie Subscription (recurring charges).
 *
 * Requires the customer to have a valid mandate.
 */
export async function createMollieSubscription(
  params: CreateMollieSubscriptionParams
): Promise<any> {
  const apiKey = getMollieApiKey()

  const body: Record<string, any> = {
    amount: params.amount,
    interval: params.interval,
    description: params.description,
    webhookUrl: params.webhookUrl,
  }
  if (params.times) body.times = params.times
  if (params.metadata) body.metadata = params.metadata

  const response = await fetchWithTimeout(
    `${MOLLIE_API_URL}/customers/${params.customerId}/subscriptions`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(`Mollie create subscription failed: ${response.status} - ${JSON.stringify(error)}`)
  }

  return await response.json()
}

/**
 * Cancel a Mollie Subscription.
 */
export async function cancelMollieSubscription(
  customerId: string,
  subscriptionId: string
): Promise<boolean> {
  const apiKey = getMollieApiKey()

  const response = await fetchWithTimeout(
    `${MOLLIE_API_URL}/customers/${customerId}/subscriptions/${subscriptionId}`,
    {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${apiKey}` },
    }
  )

  // 200/204 = success, 404 = already cancelled (fine)
  return response.ok || response.status === 404
}

// =====================================================
// PAYMENT WITH SEQUENCE TYPE
// =====================================================

export interface CreateFirstPaymentParams {
  customerId: string
  amount: { currency: string; value: string }
  description: string
  redirectUrl: string
  webhookUrl: string
  metadata?: Record<string, any>
}

/**
 * Create a first payment for subscription setup.
 *
 * Uses sequenceType: "first" to establish a mandate.
 * The customer will be redirected to complete this payment (iDEAL, Bancontact, etc.).
 * After successful payment, Mollie creates a mandate for recurring charges.
 */
export async function createFirstPayment(
  params: CreateFirstPaymentParams
): Promise<any> {
  const apiKey = getMollieApiKey()

  const body = {
    amount: params.amount,
    description: params.description,
    redirectUrl: params.redirectUrl,
    webhookUrl: params.webhookUrl,
    sequenceType: 'first',
    customerId: params.customerId,
    metadata: params.metadata || {},
  }

  const response = await fetchWithTimeout(
    `${MOLLIE_API_URL}/payments`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(`Mollie first payment failed: ${response.status} - ${JSON.stringify(error)}`)
  }

  return await response.json()
}

/**
 * Fetch a payment from Mollie API.
 */
export async function getMolliePayment(paymentId: string): Promise<any> {
  const apiKey = getMollieApiKey()
  const response = await fetchWithTimeout(
    `${MOLLIE_API_URL}/payments/${paymentId}`,
    { headers: { 'Authorization': `Bearer ${apiKey}` } }
  )

  if (!response.ok) {
    throw new Error(`Mollie get payment failed: ${response.status}`)
  }

  return await response.json()
}
