/**
 * PublicEventPage
 * 
 * Public checkout pagina - geen auth vereist
 * Route: /e/:eventSlug
 * 
 * Features:
 * - Toon event details
 * - Lijst published tickets met quantity selectors
 * - Checkout form (email + optionele naam)
 * - Call create-order-public Edge Function
 * - Redirect naar confirmation page
 */

import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Calendar, MapPin, Ticket, Loader2, ShoppingCart } from 'lucide-react'
import { getPublicEventBySlug } from '../../data/public_events'
import { supabase } from '../../lib/supabase'

export function PublicEventCheckout() {
    const { eventSlug } = useParams<{ eventSlug: string }>()
    const navigate = useNavigate()

    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [event, setEvent] = useState<any>(null)
    const [tickets, setTickets] = useState<any[]>([])
    const [quantities, setQuantities] = useState<Record<string, number>>({})
    const [email, setEmail] = useState('')
    const [name, setName] = useState('')
    const [submitting, setSubmitting] = useState(false)
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

            // Fetch published tickets
            const { data: ticketsData, error: ticketsError } = await supabase
                .from('ticket_types')
                .select('id, name, description, price, currency, capacity_total, status')
                .eq('event_id', eventData.id)
                .eq('status', 'published')
                .is('deleted_at', null)
                .order('sort_order', { ascending: true })

            if (ticketsError) {
                console.error('[PublicEvent] Tickets error:', ticketsError)
                setError('Kon tickets niet ophalen')
            } else {
                setTickets(ticketsData || [])
            }

            setLoading(false)
        }

        fetchEvent()
    }, [eventSlug])

    const handleQuantityChange = (ticketId: string, delta: number) => {
        setQuantities(prev => {
            const current = prev[ticketId] || 0
            const newQty = Math.max(0, current + delta)
            return { ...prev, [ticketId]: newQty }
        })
    }

    const totalItems = Object.values(quantities).reduce((sum, qty) => sum + qty, 0)
    const totalPrice = tickets.reduce((sum, ticket) => {
        const qty = quantities[ticket.id] || 0
        return sum + (ticket.price * qty)
    }, 0)

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

        try {
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
                                {tickets.map(ticket => (
                                    <div key={ticket.id} className="bg-white rounded-lg shadow p-6">
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                                <h3 className="text-lg font-medium text-gray-900">{ticket.name}</h3>
                                                {ticket.description && (
                                                    <p className="mt-1 text-sm text-gray-500">{ticket.description}</p>
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
                                                    disabled={!quantities[ticket.id]}
                                                    className="w-8 h-8 rounded-full border-2 border-gray-300 flex items-center justify-center hover:border-indigo-500 disabled:opacity-30"
                                                >
                                                    −
                                                </button>
                                                <span className="w-8 text-center font-medium">
                                                    {quantities[ticket.id] || 0}
                                                </span>
                                                <button
                                                    onClick={() => handleQuantityChange(ticket.id, 1)}
                                                    className="w-8 h-8 rounded-full border-2 border-indigo-600 bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700"
                                                >
                                                    +
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
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

                                    {error && (
                                        <div className="bg-red-50 border border-red-200 rounded-md p-3">
                                            <p className="text-sm text-red-800">{error}</p>
                                        </div>
                                    )}

                                    <button
                                        type="submit"
                                        disabled={submitting || !email || totalItems === 0}
                                        className="w-full py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {submitting ? (
                                            <>
                                                <Loader2 className="inline animate-spin mr-2 h-4 w-4" />
                                                Bezig met bestellen...
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
