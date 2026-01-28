/**
 * PublicEventCheckout
 *
 * Public checkout pagina - geen auth vereist
 * Route: /e/:eventSlug
 *
 * Features:
 * - Toon event details
 * - Lijst published tickets met real-time availability
 * - Sold out states + max per participant limits
 * - Checkout form (email + optionele naam)
 * - Pre-checkout validation via RPC
 * - Call create-order-public Edge Function
 * - Redirect naar confirmation page
 */

import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Calendar, MapPin, Ticket, Loader2, ShoppingCart, AlertCircle } from 'lucide-react'
import { getPublicEventBySlug } from '../../data/public_events'
import { supabase } from '../../lib/supabase'

// Ticket type with availability info from RPC
interface TicketWithAvailability {
    id: string
    name: string
    description: string | null
    price: number
    currency: string
    vat_percentage: number | null
    capacity_total: number
    sold_count: number
    available_count: number
    is_sold_out: boolean
    distance_value: number | null
    distance_unit: string | null
    ticket_category: string | null
    max_per_participant: number | null
    image_url: string | null
    sales_start: string | null
    sales_end: string | null
    on_sale: boolean
    sort_order: number | null
    time_slots: any[]
}

// Validation error from RPC
interface ValidationError {
    ticket_type_id?: string
    ticket_name?: string
    error: string
    requested?: number
    available?: number
    max_allowed?: number
    sales_start?: string
    sales_end?: string
}

export function PublicEventCheckout() {
    const { eventSlug } = useParams<{ eventSlug: string }>()
    const navigate = useNavigate()

    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])
    const [event, setEvent] = useState<any>(null)
    const [tickets, setTickets] = useState<TicketWithAvailability[]>([])
    const [quantities, setQuantities] = useState<Record<string, number>>({})
    const [email, setEmail] = useState('')
    const [name, setName] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [validating, setValidating] = useState(false)
    const [showCheckout, setShowCheckout] = useState(false)

    useEffect(() => {
        async function fetchEvent() {
            if (!eventSlug) return

            setLoading(true)
            setError(null)

            // Fetch event (via public view)
            const { data: eventData, error: eventError } = await getPublicEventBySlug(eventSlug)

            if (eventError || !eventData) {
                console.error('[PublicEvent] Event error:', eventError)
                setError('Event niet gevonden of niet beschikbaar')
                setLoading(false)
                return
            }

            // Status check is redundant due to view, but kept for type safety
            if (eventData.status !== 'published') {
                setError('Dit evenement is niet beschikbaar voor inschrijving')
                setLoading(false)
                return
            }

            setEvent(eventData)

            // Fetch tickets with availability via RPC
            const { data: availabilityData, error: availabilityError } = await supabase
                .rpc('get_ticket_availability', { _event_id: eventData.id })

            if (availabilityError) {
                console.error('[PublicEvent] Availability error:', availabilityError)
                setError('Kon tickets niet ophalen')
            } else if (availabilityData?.error) {
                console.error('[PublicEvent] Availability RPC error:', availabilityData.error)
                setError('Kon tickets niet ophalen')
            } else {
                setTickets(availabilityData?.ticket_types || [])
            }

            setLoading(false)
        }

        fetchEvent()
    }, [eventSlug])

    const handleQuantityChange = (ticketId: string, delta: number) => {
        const ticket = tickets.find(t => t.id === ticketId)
        if (!ticket) return

        // Calculate max allowed quantity
        const maxAllowed = Math.min(
            ticket.available_count,
            ticket.max_per_participant ?? 99
        )

        setQuantities(prev => {
            const current = prev[ticketId] || 0
            const newQty = Math.max(0, Math.min(maxAllowed, current + delta))
            return { ...prev, [ticketId]: newQty }
        })

        // Clear validation errors when quantity changes
        setValidationErrors([])
    }

    // Get max quantity for a ticket
    const getMaxQuantity = (ticket: TicketWithAvailability): number => {
        return Math.min(
            ticket.available_count,
            ticket.max_per_participant ?? 99
        )
    }

    // Check if ticket can be selected
    const isTicketDisabled = (ticket: TicketWithAvailability): boolean => {
        return ticket.is_sold_out || !ticket.on_sale
    }

    // Get status badge for ticket
    const getTicketStatusBadge = (ticket: TicketWithAvailability): { text: string; className: string } | null => {
        if (ticket.is_sold_out) {
            return { text: 'Uitverkocht', className: 'bg-red-100 text-red-800' }
        }
        if (!ticket.on_sale && ticket.sales_start && new Date(ticket.sales_start) > new Date()) {
            return { text: 'Binnenkort', className: 'bg-yellow-100 text-yellow-800' }
        }
        if (!ticket.on_sale && ticket.sales_end && new Date(ticket.sales_end) < new Date()) {
            return { text: 'Verkoop gesloten', className: 'bg-gray-100 text-gray-800' }
        }
        if (ticket.available_count <= 5 && ticket.available_count > 0) {
            return { text: `Nog ${ticket.available_count}`, className: 'bg-orange-100 text-orange-800' }
        }
        return null
    }

    // Format distance badge
    const formatDistanceBadge = (ticket: TicketWithAvailability): string | null => {
        if (!ticket.distance_value) return null
        return `${ticket.distance_value} ${ticket.distance_unit || 'km'}`
    }

    const totalItems = Object.values(quantities).reduce((sum, qty) => sum + qty, 0)
    const totalPrice = tickets.reduce((sum, ticket) => {
        const qty = quantities[ticket.id] || 0
        return sum + (ticket.price * qty)
    }, 0)

    // Validate order before checkout
    const validateOrder = async (): Promise<boolean> => {
        if (!event) return false

        setValidating(true)
        setValidationErrors([])

        const items = Object.entries(quantities)
            .filter(([_, qty]) => qty > 0)
            .map(([ticketId, qty]) => ({
                ticket_type_id: ticketId,
                quantity: qty
            }))

        const { data, error: rpcError } = await supabase
            .rpc('validate_ticket_order', {
                _event_id: event.id,
                _items: items
            })

        setValidating(false)

        if (rpcError) {
            console.error('[PublicEvent] Validation RPC error:', rpcError)
            setError('Kon bestelling niet valideren')
            return false
        }

        if (!data?.valid) {
            setValidationErrors(data?.errors || [])
            return false
        }

        return true
    }

    // Translate validation error codes
    const translateError = (err: ValidationError): string => {
        const ticketName = err.ticket_name || 'Ticket'
        switch (err.error) {
            case 'NO_ITEMS':
                return 'Selecteer minimaal één ticket'
            case 'EVENT_NOT_FOUND':
                return 'Event niet gevonden of niet beschikbaar'
            case 'TICKET_TYPE_NOT_FOUND':
                return `${ticketName}: Ticket type niet gevonden`
            case 'TICKET_NOT_PUBLISHED':
                return `${ticketName}: Ticket is niet beschikbaar`
            case 'TICKET_NOT_VISIBLE':
                return `${ticketName}: Ticket is niet beschikbaar`
            case 'SALES_NOT_STARTED':
                return `${ticketName}: Verkoop nog niet gestart`
            case 'SALES_ENDED':
                return `${ticketName}: Verkoop is gesloten`
            case 'INSUFFICIENT_CAPACITY':
                return `${ticketName}: Niet genoeg tickets beschikbaar (${err.available} over, ${err.requested} gevraagd)`
            case 'EXCEEDS_MAX_PER_PARTICIPANT':
                return `${ticketName}: Maximum ${err.max_allowed} per bestelling`
            default:
                return `${ticketName}: ${err.error}`
        }
    }

    const handleCheckout = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!email) {
            setError('Email is verplicht')
            return
        }

        if (totalItems === 0) {
            setError('Selecteer minimaal één ticket')
            return
        }

        setSubmitting(true)
        setError(null)
        setValidationErrors([])

        try {
            // Pre-validate order
            const isValid = await validateOrder()
            if (!isValid) {
                setSubmitting(false)
                return
            }

            // Build items array
            const items = Object.entries(quantities)
                .filter(([_, qty]) => qty > 0)
                .map(([ticketId, qty]) => ({
                    ticket_type_id: ticketId,
                    quantity: qty
                }))

            // Call Edge Function
            const { data, error: createError } = await supabase.functions.invoke('create-order-public', {
                body: {
                    event_slug: eventSlug,
                    items,
                    email,
                    purchaser_name: name || null,
                }
            })

            if (createError) {
                console.error('[PublicEvent] Create order error:', createError)
                throw new Error(createError.message)
            }

            if (data?.public_token) {
                // Redirect to confirmation with state (containing raw tickets)
                navigate(`/e/${eventSlug}/confirm?token=${data.public_token}`, {
                    state: {
                        tickets: data.tickets,
                        order: data.order
                    }
                })
            } else {
                throw new Error('Geen token ontvangen')
            }
        } catch (err: any) {
            console.error('[PublicEvent] Error:', err)
            setError(err.message || 'Er ging iets mis bij het plaatsen van je bestelling')
        }

        setSubmitting(false)
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
            </div>
        )
    }

    if (error && !event) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">Evenement niet gevonden</h2>
                    <p className="text-gray-600">{error}</p>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <div className="bg-white shadow">
                <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
                    <h1 className="text-3xl font-bold text-gray-900">{event?.name}</h1>
                    <div className="mt-2 flex items-center space-x-4 text-sm text-gray-500">
                        {event?.start_time && (
                            <span className="flex items-center">
                                <Calendar className="mr-1 h-4 w-4" />
                                {new Date(event.start_time).toLocaleDateString('nl-NL', {
                                    day: 'numeric',
                                    month: 'long',
                                    year: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                })}
                            </span>
                        )}
                        {event?.location_name && (
                            <span className="flex items-center">
                                <MapPin className="mr-1 h-4 w-4" />
                                {event.location_name}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Tickets */}
                    <div className="lg:col-span-2">
                        <h2 className="text-xl font-semibold text-gray-900 mb-4">Beschikbare tickets</h2>

                        {tickets.length === 0 ? (
                            <div className="bg-white rounded-lg shadow p-8 text-center">
                                <Ticket className="mx-auto h-12 w-12 text-gray-400" />
                                <p className="mt-2 text-gray-600">Momenteel geen tickets beschikbaar.</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {tickets.map(ticket => {
                                    const disabled = isTicketDisabled(ticket)
                                    const statusBadge = getTicketStatusBadge(ticket)
                                    const distanceBadge = formatDistanceBadge(ticket)
                                    const maxQty = getMaxQuantity(ticket)
                                    const currentQty = quantities[ticket.id] || 0

                                    return (
                                        <div
                                            key={ticket.id}
                                            className={`bg-white rounded-lg shadow p-6 ${disabled ? 'opacity-60' : ''}`}
                                        >
                                            <div className="flex items-start justify-between">
                                                <div className="flex-1">
                                                    {/* Title + badges */}
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <h3 className="text-lg font-medium text-gray-900">{ticket.name}</h3>
                                                        {distanceBadge && (
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                                                {distanceBadge}
                                                            </span>
                                                        )}
                                                        {ticket.ticket_category && (
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                                                                {ticket.ticket_category}
                                                            </span>
                                                        )}
                                                        {statusBadge && (
                                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusBadge.className}`}>
                                                                {statusBadge.text}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {ticket.description && (
                                                        <p className="mt-1 text-sm text-gray-500">{ticket.description}</p>
                                                    )}

                                                    {/* Availability info */}
                                                    {!disabled && (
                                                        <p className="mt-1 text-xs text-gray-400">
                                                            {ticket.available_count} van {ticket.capacity_total} beschikbaar
                                                            {ticket.max_per_participant && (
                                                                <span> · Max {ticket.max_per_participant} per bestelling</span>
                                                            )}
                                                        </p>
                                                    )}

                                                    <p className="mt-2 text-2xl font-bold text-indigo-600">
                                                        {ticket.price === 0 ? (
                                                            'Gratis'
                                                        ) : (
                                                            `€${ticket.price.toFixed(2)}`
                                                        )}
                                                    </p>
                                                </div>

                                                {/* Quantity selector */}
                                                <div className="flex items-center space-x-3">
                                                    <button
                                                        onClick={() => handleQuantityChange(ticket.id, -1)}
                                                        disabled={disabled || currentQty === 0}
                                                        className="w-8 h-8 rounded-full border-2 border-gray-300 flex items-center justify-center hover:border-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed"
                                                    >
                                                        −
                                                    </button>
                                                    <span className="w-8 text-center font-medium">
                                                        {currentQty}
                                                    </span>
                                                    <button
                                                        onClick={() => handleQuantityChange(ticket.id, 1)}
                                                        disabled={disabled || currentQty >= maxQty}
                                                        className="w-8 h-8 rounded-full border-2 border-indigo-600 bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700 disabled:opacity-30 disabled:cursor-not-allowed"
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
                    </div>

                    {/* Checkout Sidebar */}
                    <div className="lg:col-span-1">
                        <div className="bg-white rounded-lg shadow p-6 sticky top-8">
                            <h3 className="text-lg font-semibold text-gray-900 mb-4">Bestelling</h3>

                            <div className="space-y-2 mb-4 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-600">Tickets:</span>
                                    <span className="font-medium">{totalItems}</span>
                                </div>
                                <div className="flex justify-between text-lg font-bold">
                                    <span>Totaal:</span>
                                    <span className="text-indigo-600">
                                        {totalPrice === 0 ? 'Gratis' : `€${totalPrice.toFixed(2)}`}
                                    </span>
                                </div>
                            </div>

                            {!showCheckout ? (
                                <button
                                    onClick={() => setShowCheckout(true)}
                                    disabled={totalItems === 0}
                                    className="w-full py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <ShoppingCart className="inline mr-2 h-4 w-4" />
                                    Verder naar checkout
                                </button>
                            ) : (
                                <form onSubmit={handleCheckout} className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Email <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="email"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            placeholder="jouw@email.nl"
                                            required
                                            className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Naam (optioneel)
                                        </label>
                                        <input
                                            type="text"
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            placeholder="Voor- en achternaam"
                                            className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                                        />
                                    </div>

                                    {/* Validation errors */}
                                    {validationErrors.length > 0 && (
                                        <div className="bg-red-50 border border-red-200 rounded-md p-3">
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
                                        <div className="bg-red-50 border border-red-200 rounded-md p-3">
                                            <p className="text-sm text-red-800">{error}</p>
                                        </div>
                                    )}

                                    <button
                                        type="submit"
                                        disabled={submitting || validating || !email || totalItems === 0}
                                        className="w-full py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {submitting || validating ? (
                                            <>
                                                <Loader2 className="inline animate-spin mr-2 h-4 w-4" />
                                                {validating ? 'Valideren...' : 'Bezig met bestellen...'}
                                            </>
                                        ) : (
                                            'Bestelling plaatsen'
                                        )}
                                    </button>
                                </form>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
