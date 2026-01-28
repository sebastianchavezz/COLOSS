import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { MapPin, Calendar, Clock, Mail, ArrowLeft, Loader2, Ticket, AlertCircle } from 'lucide-react'

interface TicketType {
    id: string
    name: string
    description: string
    price: number
    vat_percentage: number
    capacity_total: number
    sold: number
    available: number
    sales_start: string | null
    sales_end: string | null
    on_sale: boolean
}

interface EventDetail {
    id: string
    slug: string
    name: string
    description: string
    location_name: string
    start_time: string
    end_time: string
    org_slug: string
    org_name: string
    currency: string
    vat_percentage: number
    support_email: string
    allow_waitlist: boolean
}

interface EventDetailResponse {
    status?: string
    error?: string
    event?: EventDetail
    ticket_types?: TicketType[]
}

export function PublicEventDetail() {
    const { slug } = useParams<{ slug: string }>()
    const [event, setEvent] = useState<EventDetail | null>(null)
    const [ticketTypes, setTicketTypes] = useState<TicketType[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (slug) {
            fetchEventDetail()
        }
    }, [slug])

    async function fetchEventDetail() {
        setLoading(true)
        setError(null)

        const { data, error: rpcError } = await supabase.rpc('get_public_event_detail', {
            _event_slug: slug,
        })

        if (rpcError) {
            setError(rpcError.message)
            setLoading(false)
            return
        }

        const response = data as EventDetailResponse
        if (response.error === 'EVENT_NOT_FOUND') {
            setError('Event not found')
        } else if (response.status === 'OK' && response.event) {
            setEvent(response.event)
            setTicketTypes(response.ticket_types || [])
        } else {
            setError('Failed to load event')
        }

        setLoading(false)
    }

    function formatDate(dateString: string) {
        const date = new Date(dateString)
        return date.toLocaleDateString('nl-NL', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        })
    }

    function formatTime(dateString: string) {
        const date = new Date(dateString)
        return date.toLocaleTimeString('nl-NL', {
            hour: '2-digit',
            minute: '2-digit',
        })
    }

    function formatPrice(price: number, currency: string) {
        return new Intl.NumberFormat('nl-NL', {
            style: 'currency',
            currency: currency || 'EUR',
        }).format(price)
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
            </div>
        )
    }

    if (error || !event) {
        return (
            <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center">
                <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
                <h1 className="text-xl font-semibold text-gray-900">{error || 'Event not found'}</h1>
                <Link
                    to="/events"
                    className="mt-4 text-indigo-600 hover:text-indigo-500 flex items-center"
                >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to events
                </Link>
            </div>
        )
    }

    const totalAvailable = ticketTypes.reduce((sum, tt) => sum + tt.available, 0)
    const hasTicketsOnSale = ticketTypes.some(tt => tt.on_sale && tt.available > 0)

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Back Link */}
            <div className="bg-white border-b">
                <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                    <Link
                        to="/events"
                        className="text-sm text-gray-600 hover:text-gray-900 flex items-center"
                    >
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Back to events
                    </Link>
                </div>
            </div>

            {/* Event Header */}
            <div className="bg-white shadow">
                <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                    <p className="text-sm text-indigo-600 font-medium">{event.org_name}</p>
                    <h1 className="mt-2 text-3xl font-bold text-gray-900">{event.name}</h1>

                    <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="flex items-center text-gray-600">
                            <Calendar className="h-5 w-5 mr-3 text-gray-400" />
                            <div>
                                <p className="font-medium">{formatDate(event.start_time)}</p>
                                <p className="text-sm">
                                    {formatTime(event.start_time)}
                                    {event.end_time && ` - ${formatTime(event.end_time)}`}
                                </p>
                            </div>
                        </div>
                        {event.location_name && (
                            <div className="flex items-center text-gray-600">
                                <MapPin className="h-5 w-5 mr-3 text-gray-400" />
                                <p>{event.location_name}</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Description */}
                    <div className="lg:col-span-2">
                        <h2 className="text-lg font-semibold text-gray-900 mb-4">About this event</h2>
                        <div className="prose prose-gray max-w-none">
                            {event.description ? (
                                <p className="whitespace-pre-wrap">{event.description}</p>
                            ) : (
                                <p className="text-gray-500 italic">No description available</p>
                            )}
                        </div>

                        {/* Contact */}
                        {event.support_email && (
                            <div className="mt-8 p-4 bg-gray-100 rounded-lg">
                                <h3 className="text-sm font-medium text-gray-900 mb-2">Questions?</h3>
                                <a
                                    href={`mailto:${event.support_email}`}
                                    className="text-sm text-indigo-600 hover:text-indigo-500 flex items-center"
                                >
                                    <Mail className="h-4 w-4 mr-2" />
                                    {event.support_email}
                                </a>
                            </div>
                        )}
                    </div>

                    {/* Tickets Sidebar */}
                    <div className="lg:col-span-1">
                        <div className="bg-white rounded-lg shadow p-6 sticky top-4">
                            <h2 className="text-lg font-semibold text-gray-900 mb-4">Tickets</h2>

                            {ticketTypes.length === 0 ? (
                                <p className="text-gray-500 text-sm">No tickets available yet</p>
                            ) : (
                                <div className="space-y-4">
                                    {ticketTypes.map((ticket) => (
                                        <div
                                            key={ticket.id}
                                            className={`p-4 border rounded-lg ${
                                                ticket.on_sale && ticket.available > 0
                                                    ? 'border-gray-200'
                                                    : 'border-gray-100 bg-gray-50'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between">
                                                <div>
                                                    <h3 className="font-medium text-gray-900">{ticket.name}</h3>
                                                    {ticket.description && (
                                                        <p className="text-sm text-gray-500 mt-1">
                                                            {ticket.description}
                                                        </p>
                                                    )}
                                                </div>
                                                <span className="font-semibold text-gray-900">
                                                    {ticket.price === 0
                                                        ? 'Free'
                                                        : formatPrice(ticket.price, event.currency)}
                                                </span>
                                            </div>
                                            <div className="mt-2 flex items-center justify-between text-sm">
                                                {ticket.available > 0 ? (
                                                    <span className="text-green-600">
                                                        {ticket.available} available
                                                    </span>
                                                ) : (
                                                    <span className="text-red-600">Sold out</span>
                                                )}
                                                {!ticket.on_sale && ticket.available > 0 && (
                                                    <span className="text-orange-600">Not on sale</span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* CTA Button */}
                            <div className="mt-6">
                                {hasTicketsOnSale ? (
                                    <Link
                                        to={`/e/${event.slug}`}
                                        className="w-full flex items-center justify-center px-6 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                                    >
                                        <Ticket className="h-5 w-5 mr-2" />
                                        Get Tickets
                                    </Link>
                                ) : totalAvailable === 0 ? (
                                    <button
                                        disabled
                                        className="w-full px-6 py-3 bg-gray-300 text-gray-500 font-medium rounded-lg cursor-not-allowed"
                                    >
                                        Sold Out
                                    </button>
                                ) : (
                                    <button
                                        disabled
                                        className="w-full px-6 py-3 bg-gray-300 text-gray-500 font-medium rounded-lg cursor-not-allowed"
                                    >
                                        Not Available Yet
                                    </button>
                                )}
                            </div>

                            {totalAvailable > 0 && totalAvailable < 20 && (
                                <p className="mt-2 text-center text-sm text-orange-600">
                                    Only {totalAvailable} tickets left!
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default PublicEventDetail
