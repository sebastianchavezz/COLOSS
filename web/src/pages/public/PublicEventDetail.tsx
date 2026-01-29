import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { PublicHeader } from '../../components/PublicHeader'
import { RouteMap } from '../../components/RouteMap'
import { formatDistance } from '../../lib/gpx'
import { MapPin, Calendar, Mail, ArrowLeft, Loader2, Ticket, AlertCircle, Map, Ruler, ChevronDown, HelpCircle, MessageCircle } from 'lucide-react'
import { clsx } from 'clsx'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

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

interface FaqItem {
    id: string
    title: string
    content: string
    category: string
    sort_order: number
}

interface EventRoute {
    id: string
    event_id: string
    name: string
    description: string | null
    status: 'draft' | 'published'
    route_geometry: number[][]
    bounds: {
        minLat: number
        maxLat: number
        minLng: number
        maxLng: number
    }
    distance_m: number
    point_count: number
}

export function PublicEventDetail() {
    const { slug } = useParams<{ slug: string }>()
    const [event, setEvent] = useState<EventDetail | null>(null)
    const [ticketTypes, setTicketTypes] = useState<TicketType[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // FAQ state
    const [faqItems, setFaqItems] = useState<FaqItem[]>([])
    const [expandedFaqId, setExpandedFaqId] = useState<string | null>(null)

    // Route state
    const [route, setRoute] = useState<EventRoute | null>(null)

    useEffect(() => {
        if (slug) {
            fetchEventDetail()
        }
    }, [slug])

    // Fetch FAQ items
    const fetchFaqs = useCallback(async (eventId: string) => {
        try {
            const response = await fetch(
                `${SUPABASE_URL}/functions/v1/get-faqs?event_id=${eventId}`,
                {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' },
                }
            )
            if (response.ok) {
                const data = await response.json()
                setFaqItems(data.faqs || [])
            }
        } catch (err) {
            console.error('Error fetching FAQs:', err)
        }
    }, [])

    // Fetch route
    const fetchRoute = useCallback(async (eventId: string) => {
        try {
            const { data } = await supabase.rpc('get_event_route', {
                _event_id: eventId,
            })
            if (data?.route) {
                setRoute(data.route)
            }
        } catch (err) {
            console.error('Error fetching route:', err)
        }
    }, [])

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
            // Fetch additional data
            fetchFaqs(response.event.id)
            fetchRoute(response.event.id)
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
            <PublicHeader />

            {/* Back Navigation */}
            <div className="bg-white border-b border-gray-100">
                <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
                    <Link
                        to="/events"
                        className="inline-flex items-center text-sm text-gray-600 hover:text-black"
                    >
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Terug naar events
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

                        {/* Route Section */}
                        {route && (
                            <div className="mt-8">
                                <div className="flex items-center justify-between mb-4">
                                    <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                                        <Map className="h-5 w-5 mr-2 text-indigo-600" />
                                        Route
                                    </h2>
                                    <div className="flex items-center text-sm text-gray-500">
                                        <Ruler className="h-4 w-4 mr-1" />
                                        {formatDistance(route.distance_m)}
                                    </div>
                                </div>
                                {route.description && (
                                    <p className="text-gray-600 text-sm mb-4">{route.description}</p>
                                )}
                                <div className="rounded-lg overflow-hidden border border-gray-200">
                                    <RouteMap
                                        geometry={route.route_geometry}
                                        bounds={route.bounds}
                                        height="300px"
                                    />
                                </div>
                                <div className="mt-2 flex items-center justify-center space-x-6 text-xs text-gray-500">
                                    <div className="flex items-center">
                                        <div className="w-3 h-3 rounded-full bg-green-500 mr-1" />
                                        Start
                                    </div>
                                    <div className="flex items-center">
                                        <div className="w-3 h-3 rounded-full bg-red-500 mr-1" />
                                        Finish
                                    </div>
                                </div>
                                <Link
                                    to={`/e/${event.slug}/route`}
                                    className="mt-3 inline-flex items-center text-sm text-indigo-600 hover:text-indigo-500"
                                >
                                    Bekijk volledige route
                                    <ArrowLeft className="h-4 w-4 ml-1 rotate-180" />
                                </Link>
                            </div>
                        )}

                        {/* FAQ Section */}
                        {faqItems.length > 0 && (
                            <div className="mt-8">
                                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                                    <HelpCircle className="h-5 w-5 mr-2 text-indigo-600" />
                                    Veelgestelde vragen
                                </h2>
                                <div className="space-y-2">
                                    {faqItems.slice(0, 5).map((faq) => (
                                        <div
                                            key={faq.id}
                                            className="border border-gray-200 rounded-lg overflow-hidden"
                                        >
                                            <button
                                                onClick={() => setExpandedFaqId(expandedFaqId === faq.id ? null : faq.id)}
                                                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
                                            >
                                                <span className="font-medium text-gray-900 text-sm">{faq.title}</span>
                                                <ChevronDown
                                                    className={clsx(
                                                        'h-4 w-4 text-gray-400 transition-transform flex-shrink-0 ml-2',
                                                        expandedFaqId === faq.id && 'rotate-180'
                                                    )}
                                                />
                                            </button>
                                            {expandedFaqId === faq.id && (
                                                <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
                                                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{faq.content}</p>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                                {faqItems.length > 5 && (
                                    <Link
                                        to={`/e/${event.slug}/faq`}
                                        className="mt-3 inline-flex items-center text-sm text-indigo-600 hover:text-indigo-500"
                                    >
                                        Bekijk alle {faqItems.length} vragen
                                        <ArrowLeft className="h-4 w-4 ml-1 rotate-180" />
                                    </Link>
                                )}
                            </div>
                        )}

                        {/* Contact */}
                        <div className="mt-8 p-4 bg-gray-100 rounded-lg">
                            <h3 className="text-sm font-medium text-gray-900 mb-2">Vragen?</h3>
                            <div className="space-y-2">
                                <Link
                                    to={`/e/${event.slug}/chat`}
                                    className="text-sm text-indigo-600 hover:text-indigo-500 flex items-center"
                                >
                                    <MessageCircle className="h-4 w-4 mr-2" />
                                    Start een gesprek met de organisatie
                                </Link>
                                {event.support_email && (
                                    <a
                                        href={`mailto:${event.support_email}`}
                                        className="text-sm text-gray-600 hover:text-gray-900 flex items-center"
                                    >
                                        <Mail className="h-4 w-4 mr-2" />
                                        {event.support_email}
                                    </a>
                                )}
                            </div>
                        </div>
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
