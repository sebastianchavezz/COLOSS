/**
 * EmbedCheckout
 *
 * Stripped-down checkout page designed for iframe embedding.
 * No header, no navigation, no footer. Guest checkout only (email field).
 *
 * Route: /embed/:eventSlug
 *
 * Query params:
 *   sourceUrl - URL of the embedding page (for analytics/origin targeting)
 *   theme     - light|dark (default: light)
 *   accent    - hex color for buttons (default: #4f46e5)
 *
 * Security:
 *   - Accent color applied via CSS custom property (not inline style injection)
 *   - Polling has safe cleanup (clearInterval on unmount + timeout ref tracking)
 *   - Popup blocked fallback provides clickable payment link
 *   - No auth tokens sent to parent via postMessage
 *
 * Payment flow:
 *   Mollie opens in a popup window (banks block payment in iframes).
 *   We poll order status and show confirmation inline when paid.
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Loader2, ShoppingCart, AlertCircle, CheckCircle, Mail, Ticket, ExternalLink } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getPublicEventBySlug } from '../../data/public_events'
import { useEmbed, EmbedProvider } from '../../contexts/EmbedContext'

// -- Types --

interface TicketWithAvailability {
  id: string
  name: string
  description: string | null
  price: number
  currency: string
  capacity_total: number
  sold_count: number
  available_count: number
  is_sold_out: boolean
  distance_value: number | null
  distance_unit: string | null
  ticket_category: string | null
  max_per_participant: number | null
  sales_start: string | null
  sales_end: string | null
  on_sale: boolean
  sort_order: number | null
}

interface ValidationError {
  ticket_type_id?: string
  ticket_name?: string
  error: string
  requested?: number
  available?: number
  max_allowed?: number
}

type EmbedStep = 'tickets' | 'checkout' | 'processing' | 'confirmed'

// -- Inner Component (uses useEmbed) --

function EmbedCheckoutInner() {
  const { eventSlug } = useParams<{ eventSlug: string }>()
  const { accentColor, postToParent, notifyResize } = useEmbed()

  const [step, setStep] = useState<EmbedStep>('tickets')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])
  const [event, setEvent] = useState<any>(null)
  const [tickets, setTickets] = useState<TicketWithAvailability[]>([])
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [orderResult, setOrderResult] = useState<any>(null)
  // Fix 5: Store checkout URL for fallback link when popup is blocked
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Fix 4: Track the timeout that kills polling, so we can clean it up
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const popupRef = useRef<Window | null>(null)

  // Load event and tickets
  useEffect(() => {
    async function fetchEvent() {
      if (!eventSlug) return

      setLoading(true)
      setError(null)

      const { data: eventData, error: eventError } = await getPublicEventBySlug(eventSlug)

      if (eventError || !eventData) {
        setError('Event niet gevonden of niet beschikbaar')
        setLoading(false)
        return
      }

      if (eventData.status !== 'published') {
        setError('Dit evenement is niet beschikbaar voor inschrijving')
        setLoading(false)
        return
      }

      setEvent(eventData)

      const { data: availabilityData, error: availabilityError } = await supabase
        .rpc('get_ticket_availability', { _event_id: eventData.id })

      if (availabilityError || availabilityData?.error) {
        setError('Kon tickets niet ophalen')
      } else {
        setTickets(availabilityData?.ticket_types || [])
      }

      setLoading(false)
    }

    fetchEvent()
  }, [eventSlug])

  // Notify parent of resize after state changes
  useEffect(() => {
    const timer = setTimeout(notifyResize, 50)
    return () => clearTimeout(timer)
  }, [step, loading, error, tickets, quantities, validationErrors, notifyResize])

  // Fix 4: Cleanup polling AND timeout on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current)
    }
  }, [])

  const handleQuantityChange = (ticketId: string, delta: number) => {
    const ticket = tickets.find(t => t.id === ticketId)
    if (!ticket) return

    const maxAllowed = Math.min(
      ticket.available_count,
      ticket.max_per_participant ?? 99
    )

    setQuantities(prev => {
      const current = prev[ticketId] || 0
      const newQty = Math.max(0, Math.min(maxAllowed, current + delta))
      return { ...prev, [ticketId]: newQty }
    })
    setValidationErrors([])
  }

  const totalItems = Object.values(quantities).reduce((sum, qty) => sum + qty, 0)
  const totalPrice = tickets.reduce((sum, ticket) => {
    const qty = quantities[ticket.id] || 0
    return sum + (ticket.price * qty)
  }, 0)

  const isTicketDisabled = (ticket: TicketWithAvailability): boolean => {
    return ticket.is_sold_out || !ticket.on_sale
  }

  const getMaxQuantity = (ticket: TicketWithAvailability): number => {
    return Math.min(ticket.available_count, ticket.max_per_participant ?? 99)
  }

  const getTicketStatusBadge = (ticket: TicketWithAvailability) => {
    if (ticket.is_sold_out) return { text: 'Uitverkocht', className: 'bg-red-100 text-red-800' }
    if (!ticket.on_sale && ticket.sales_start && new Date(ticket.sales_start) > new Date())
      return { text: 'Binnenkort', className: 'bg-yellow-100 text-yellow-800' }
    if (!ticket.on_sale && ticket.sales_end && new Date(ticket.sales_end) < new Date())
      return { text: 'Verkoop gesloten', className: 'bg-gray-100 text-gray-800' }
    if (ticket.available_count <= 5 && ticket.available_count > 0)
      return { text: `Nog ${ticket.available_count}`, className: 'bg-orange-100 text-orange-800' }
    return null
  }

  const translateError = (err: ValidationError): string => {
    const ticketName = err.ticket_name || 'Ticket'
    switch (err.error) {
      case 'NO_ITEMS': return 'Selecteer minimaal een ticket'
      case 'EVENT_NOT_FOUND': return 'Event niet gevonden'
      case 'TICKET_NOT_PUBLISHED': return `${ticketName}: Niet beschikbaar`
      case 'SALES_NOT_STARTED': return `${ticketName}: Verkoop nog niet gestart`
      case 'SALES_ENDED': return `${ticketName}: Verkoop gesloten`
      case 'INSUFFICIENT_CAPACITY': return `${ticketName}: Niet genoeg beschikbaar (${err.available} over)`
      case 'EXCEEDS_MAX_PER_PARTICIPANT': return `${ticketName}: Max ${err.max_allowed} per bestelling`
      default: return `${ticketName}: ${err.error}`
    }
  }

  const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)

  // Fix 4: Safe polling with proper cleanup of both interval and timeout
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current)
      pollTimeoutRef.current = null
    }
  }, [])

  const startPolling = useCallback((publicToken: string) => {
    // Always clean up existing polling before starting new one
    stopPolling()

    pollRef.current = setInterval(async () => {
      try {
        const { data } = await supabase.functions.invoke('get-order-public', {
          body: { public_token: publicToken }
        })

        if (data?.order?.status === 'paid') {
          stopPolling()
          setOrderResult(data)
          setStep('confirmed')
          setCheckoutUrl(null)
          postToParent({
            type: 'coloss:checkout-complete',
            orderId: data.order.id,
            totalAmount: data.order.total_amount,
          })

          // Close popup if still open
          if (popupRef.current && !popupRef.current.closed) {
            popupRef.current.close()
          }
        }
      } catch {
        // Silently retry
      }
    }, 2500)

    // Stop polling after 10 minutes
    pollTimeoutRef.current = setTimeout(() => {
      stopPolling()
    }, 10 * 60 * 1000)
  }, [postToParent, stopPolling])

  const handleProceedToCheckout = () => {
    if (totalItems === 0) {
      setError('Selecteer minimaal een ticket')
      return
    }
    setError(null)
    setStep('checkout')
  }

  const handleBackToTickets = () => {
    stopPolling()
    setStep('tickets')
    setError(null)
    setValidationErrors([])
    setCheckoutUrl(null)
  }

  const handleCheckout = async () => {
    if (!email || !isValidEmail(email)) {
      setError('Vul een geldig e-mailadres in')
      return
    }

    setSubmitting(true)
    setError(null)
    setValidationErrors([])

    try {
      // Validate
      const items = Object.entries(quantities)
        .filter(([, qty]) => qty > 0)
        .map(([ticketId, qty]) => ({ ticket_type_id: ticketId, quantity: qty }))

      const { data: valData, error: valError } = await supabase
        .rpc('validate_ticket_order', { _event_id: event.id, _items: items })

      if (valError) throw new Error('Kon bestelling niet valideren')
      if (!valData?.valid) {
        setValidationErrors(valData?.errors || [])
        setSubmitting(false)
        return
      }

      // Create order (guest checkout)
      const { data, error: createError } = await supabase.functions.invoke('create-order-public', {
        body: {
          event_slug: eventSlug,
          items,
          email,
          purchaser_name: name || null,
        }
      })

      if (createError) throw new Error(createError.message)
      if (data?.error) throw new Error(data.error)

      const isPaidOrder = totalPrice > 0

      if (data?.checkout_url) {
        // Store checkout URL for fallback
        setCheckoutUrl(data.checkout_url)
        setStep('processing')

        // Open Mollie in popup window (banks block payment in iframes)
        const popup = window.open(
          data.checkout_url,
          'coloss-payment',
          'width=500,height=700,scrollbars=yes,resizable=yes'
        )
        popupRef.current = popup

        // Start polling for payment confirmation
        if (data.public_token) {
          startPolling(data.public_token)
        }

        // Fix 5: If popup was blocked, stay on processing step with fallback link
        // (don't go back to checkout - the order is already created)
        if (!popup || popup.closed) {
          // Popup was blocked - user can still click the fallback link
          console.log('[Embed] Popup blocked, fallback link available')
        }

        setSubmitting(false)
        return
      }

      // Paid order without checkout URL = error
      if (isPaidOrder && !data?.checkout_url) {
        throw new Error('Betaling kon niet worden gestart. Probeer het opnieuw.')
      }

      // Free order - show confirmation directly
      if (data?.public_token) {
        const { data: orderData } = await supabase.functions.invoke('get-order-public', {
          body: { public_token: data.public_token }
        })
        setOrderResult(orderData)
        setStep('confirmed')
        postToParent({
          type: 'coloss:checkout-complete',
          orderId: data.order?.id || '',
          totalAmount: 0,
        })
      } else {
        throw new Error('Geen bevestiging ontvangen')
      }
    } catch (err: any) {
      setError(err.message || 'Er ging iets mis bij het plaatsen van je bestelling')
      postToParent({ type: 'coloss:error', message: err.message || 'Checkout error' })
    }

    setSubmitting(false)
  }

  // -- Render --

  // Fix 3: Apply accent color via CSS custom property for defense-in-depth
  const accentStyle = { '--embed-accent': accentColor } as React.CSSProperties

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16" style={accentStyle}>
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--embed-accent)' }} />
      </div>
    )
  }

  if (error && !event) {
    return (
      <div className="text-center py-12 px-4">
        <AlertCircle className="mx-auto h-10 w-10 text-red-500 mb-3" />
        <p className="text-gray-700 font-medium">{error}</p>
      </div>
    )
  }

  // STEP: Confirmed
  if (step === 'confirmed') {
    return (
      <div className="px-4 py-8" style={accentStyle}>
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-green-100 mb-4">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">Bestelling bevestigd!</h2>
          <p className="mt-1 text-sm text-gray-600">
            Je tickets zijn verstuurd naar <strong>{email}</strong>
          </p>
        </div>

        {orderResult?.items && (
          <div className="border border-gray-200 rounded-lg p-4 mb-4">
            <h3 className="text-sm font-medium text-gray-900 mb-2">Bestelde tickets</h3>
            {orderResult.items.map((item: any, idx: number) => (
              <div key={idx} className="flex justify-between text-sm py-1">
                <span className="text-gray-700">{item.quantity}x {item.ticket_name}</span>
                <span className="font-medium">
                  {item.total_price === 0 ? 'Gratis' : `\u20AC${item.total_price.toFixed(2)}`}
                </span>
              </div>
            ))}
            <div className="border-t border-gray-200 mt-2 pt-2 flex justify-between font-medium">
              <span>Totaal</span>
              <span style={{ color: 'var(--embed-accent)' }}>
                {orderResult.order?.total_amount === 0
                  ? 'Gratis'
                  : `\u20AC${orderResult.order?.total_amount?.toFixed(2)}`}
              </span>
            </div>
          </div>
        )}

        <p className="text-xs text-gray-500 text-center">
          Check je inbox voor de bevestigingsmail met je tickets.
        </p>
      </div>
    )
  }

  // STEP: Processing (waiting for Mollie popup)
  if (step === 'processing') {
    return (
      <div className="px-4 py-12 text-center" style={accentStyle}>
        <Loader2 className="mx-auto h-8 w-8 animate-spin mb-4" style={{ color: 'var(--embed-accent)' }} />
        <h2 className="text-lg font-semibold text-gray-900">Betaling verwerken...</h2>
        <p className="mt-2 text-sm text-gray-600">
          Rond je betaling af in het geopende venster.
        </p>

        {/* Fix 5: Fallback link when popup is blocked */}
        {checkoutUrl && (
          <a
            href={checkoutUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium underline"
            style={{ color: 'var(--embed-accent)' }}
          >
            <ExternalLink className="h-4 w-4" />
            Betaalvenster niet geopend? Klik hier
          </a>
        )}

        <p className="mt-2 text-xs text-gray-400">
          Dit scherm wordt automatisch bijgewerkt na betaling.
        </p>
        <button
          onClick={handleBackToTickets}
          className="mt-6 text-sm underline text-gray-500 hover:text-gray-700"
        >
          Annuleren
        </button>
      </div>
    )
  }

  // STEP: Checkout (email + name form)
  if (step === 'checkout') {
    return (
      <div className="px-4 py-6" style={accentStyle}>
        {/* Back button */}
        <button
          onClick={handleBackToTickets}
          className="text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          &larr; Terug naar tickets
        </button>

        {/* Event name */}
        <h2 className="text-lg font-bold text-gray-900 mb-1">{event?.name}</h2>

        {/* Order summary */}
        <div className="border border-gray-200 rounded-lg p-4 mb-5">
          {tickets
            .filter(t => (quantities[t.id] || 0) > 0)
            .map(ticket => (
              <div key={ticket.id} className="flex justify-between text-sm py-1">
                <span className="text-gray-700">{quantities[ticket.id]}x {ticket.name}</span>
                <span className="font-medium">
                  {ticket.price === 0 ? 'Gratis' : `\u20AC${(ticket.price * (quantities[ticket.id] || 0)).toFixed(2)}`}
                </span>
              </div>
            ))}
          <div className="border-t border-gray-200 mt-2 pt-2 flex justify-between font-semibold">
            <span>Totaal</span>
            <span style={{ color: 'var(--embed-accent)' }}>
              {totalPrice === 0 ? 'Gratis' : `\u20AC${totalPrice.toFixed(2)}`}
            </span>
          </div>
        </div>

        {/* Guest form */}
        <div className="space-y-4 mb-5">
          <div>
            <label htmlFor="embed-email" className="block text-sm font-medium text-gray-700 mb-1">
              E-mailadres *
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                id="embed-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jouw@email.nl"
                required
                autoComplete="email"
                className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>
          <div>
            <label htmlFor="embed-name" className="block text-sm font-medium text-gray-700 mb-1">
              Naam <span className="text-gray-400">(optioneel)</span>
            </label>
            <input
              id="embed-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Je volledige naam"
              autoComplete="name"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Validation errors */}
        {validationErrors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            <div className="flex items-start">
              <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 mr-2 flex-shrink-0" />
              <div className="text-sm text-red-800">
                {validationErrors.map((err, idx) => (
                  <p key={idx}>{translateError(err)}</p>
                ))}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <button
          onClick={handleCheckout}
          disabled={submitting || !email}
          className="w-full py-3 px-4 rounded-lg text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          style={{ backgroundColor: 'var(--embed-accent)' }}
        >
          {submitting ? (
            <>
              <Loader2 className="inline animate-spin mr-2 h-4 w-4" />
              Bezig met bestellen...
            </>
          ) : (
            <>
              <ShoppingCart className="inline mr-2 h-4 w-4" />
              {totalPrice === 0 ? 'Gratis bestellen' : `Afrekenen (\u20AC${totalPrice.toFixed(2)})`}
            </>
          )}
        </button>

        <p className="mt-3 text-xs text-gray-400 text-center">
          Beveiligd door COLOSS
        </p>
      </div>
    )
  }

  // STEP: Tickets (default)
  return (
    <div className="px-4 py-6" style={accentStyle}>
      {/* Event header - minimal */}
      <div className="mb-5">
        <h2 className="text-lg font-bold text-gray-900">{event?.name}</h2>
        {event?.start_time && (
          <p className="text-sm text-gray-500 mt-1">
            {new Date(event.start_time).toLocaleDateString('nl-NL', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
            {event.location_name && ` \u2022 ${event.location_name}`}
          </p>
        )}
      </div>

      {/* Ticket list */}
      {tickets.length === 0 ? (
        <div className="text-center py-8">
          <Ticket className="mx-auto h-10 w-10 text-gray-400 mb-2" />
          <p className="text-gray-600 text-sm">Momenteel geen tickets beschikbaar.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map(ticket => {
            const disabled = isTicketDisabled(ticket)
            const statusBadge = getTicketStatusBadge(ticket)
            const maxQty = getMaxQuantity(ticket)
            const currentQty = quantities[ticket.id] || 0

            return (
              <div
                key={ticket.id}
                className={`border rounded-lg p-4 ${disabled ? 'opacity-50 border-gray-100' : 'border-gray-200'}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0 mr-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-gray-900">{ticket.name}</h3>
                      {ticket.distance_value && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                          {ticket.distance_value} {ticket.distance_unit || 'km'}
                        </span>
                      )}
                      {statusBadge && (
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${statusBadge.className}`}>
                          {statusBadge.text}
                        </span>
                      )}
                    </div>
                    {ticket.description && (
                      <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">{ticket.description}</p>
                    )}
                    <p className="mt-1 text-lg font-bold" style={{ color: 'var(--embed-accent)' }}>
                      {ticket.price === 0 ? 'Gratis' : `\u20AC${ticket.price.toFixed(2)}`}
                    </p>
                  </div>

                  {/* Quantity controls */}
                  <div className="flex items-center space-x-2 flex-shrink-0">
                    <button
                      onClick={() => handleQuantityChange(ticket.id, -1)}
                      disabled={disabled || currentQty === 0}
                      className="w-7 h-7 rounded-full border border-gray-300 flex items-center justify-center text-sm hover:border-gray-500 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      &minus;
                    </button>
                    <span className="w-6 text-center text-sm font-medium">{currentQty}</span>
                    <button
                      onClick={() => handleQuantityChange(ticket.id, 1)}
                      disabled={disabled || currentQty >= maxQty}
                      className="w-7 h-7 rounded-full text-white flex items-center justify-center text-sm disabled:opacity-30 disabled:cursor-not-allowed"
                      style={{ backgroundColor: 'var(--embed-accent)' }}
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Proceed button */}
      {tickets.length > 0 && (
        <div className="mt-5">
          <div className="flex justify-between text-sm mb-3">
            <span className="text-gray-600">{totalItems} ticket{totalItems !== 1 ? 's' : ''}</span>
            <span className="font-semibold" style={{ color: 'var(--embed-accent)' }}>
              {totalPrice === 0 ? 'Gratis' : `\u20AC${totalPrice.toFixed(2)}`}
            </span>
          </div>
          <button
            onClick={handleProceedToCheckout}
            disabled={totalItems === 0}
            className="w-full py-3 px-4 rounded-lg text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            style={{ backgroundColor: 'var(--embed-accent)' }}
          >
            <Ticket className="inline mr-2 h-4 w-4" />
            Doorgaan naar bestellen
          </button>
        </div>
      )}

      {/* Powered by */}
      <p className="mt-4 text-xs text-gray-400 text-center">
        Powered by COLOSS
      </p>
    </div>
  )
}

// -- Wrapper with EmbedProvider --

export function EmbedCheckout() {
  const [searchParams] = useSearchParams()
  const sourceUrl = searchParams.get('sourceUrl')
  const accent = searchParams.get('accent')

  return (
    <EmbedProvider sourceUrl={sourceUrl} accent={accent}>
      <div className="bg-white min-h-screen font-sans antialiased">
        <EmbedCheckoutInner />
      </div>
    </EmbedProvider>
  )
}
