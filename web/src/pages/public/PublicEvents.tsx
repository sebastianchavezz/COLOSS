import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { Search, MapPin, Calendar, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'

interface EventListItem {
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
    min_price: number
    max_price: number
    tickets_available: number
    ticket_type_count: number
}

interface EventsResponse {
    status: string
    total: number
    limit: number
    offset: number
    events: EventListItem[]
}

export function PublicEvents() {
    const [searchParams, setSearchParams] = useSearchParams()
    const [events, setEvents] = useState<EventListItem[]>([])
    const [total, setTotal] = useState(0)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const search = searchParams.get('search') || ''
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = 12
    const offset = (page - 1) * limit

    useEffect(() => {
        fetchEvents()
    }, [search, page])

    async function fetchEvents() {
        setLoading(true)
        setError(null)

        const { data, error: rpcError } = await supabase.rpc('get_public_events', {
            _search: search || null,
            _limit: limit,
            _offset: offset,
        })

        if (rpcError) {
            setError(rpcError.message)
            setLoading(false)
            return
        }

        const response = data as EventsResponse
        if (response.status === 'OK') {
            setEvents(response.events)
            setTotal(response.total)
        } else {
            setError('Failed to load events')
        }

        setLoading(false)
    }

    function handleSearch(e: React.FormEvent) {
        e.preventDefault()
        const formData = new FormData(e.target as HTMLFormElement)
        const searchValue = formData.get('search') as string
        setSearchParams(searchValue ? { search: searchValue } : {})
    }

    function formatDate(dateString: string) {
        const date = new Date(dateString)
        return date.toLocaleDateString('nl-NL', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        })
    }

    function formatPrice(min: number, max: number, currency: string) {
        const formatter = new Intl.NumberFormat('nl-NL', {
            style: 'currency',
            currency: currency || 'EUR',
        })
        if (min === 0 && max === 0) return 'Gratis'
        if (min === max) return formatter.format(min)
        return `${formatter.format(min)} - ${formatter.format(max)}`
    }

    const totalPages = Math.ceil(total / limit)

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <div className="bg-white shadow">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                    <h1 className="text-3xl font-bold text-gray-900">Discover Events</h1>
                    <p className="mt-2 text-gray-600">Find your next adventure</p>
                </div>
            </div>

            {/* Search Bar */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                <form onSubmit={handleSearch} className="flex gap-4">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                        <input
                            type="text"
                            name="search"
                            defaultValue={search}
                            placeholder="Search events by name or location..."
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                    </div>
                    <button
                        type="submit"
                        className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                    >
                        Search
                    </button>
                </form>
            </div>

            {/* Events Grid */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
                {loading ? (
                    <div className="flex justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
                    </div>
                ) : error ? (
                    <div className="text-center py-12">
                        <p className="text-red-600">{error}</p>
                        <button
                            onClick={fetchEvents}
                            className="mt-4 text-indigo-600 hover:text-indigo-500"
                        >
                            Try again
                        </button>
                    </div>
                ) : events.length === 0 ? (
                    <div className="text-center py-12">
                        <p className="text-gray-500">No events found</p>
                        {search && (
                            <button
                                onClick={() => setSearchParams({})}
                                className="mt-4 text-indigo-600 hover:text-indigo-500"
                            >
                                Clear search
                            </button>
                        )}
                    </div>
                ) : (
                    <>
                        <p className="text-sm text-gray-500 mb-4">
                            {total} event{total !== 1 ? 's' : ''} found
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {events.map((event) => (
                                <Link
                                    key={event.id}
                                    to={`/events/${event.slug}`}
                                    className="bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow overflow-hidden"
                                >
                                    <div className="p-6">
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                                <h3 className="text-lg font-semibold text-gray-900 line-clamp-2">
                                                    {event.name}
                                                </h3>
                                                <p className="text-sm text-gray-500 mt-1">
                                                    by {event.org_name}
                                                </p>
                                            </div>
                                        </div>

                                        {event.description && (
                                            <p className="mt-3 text-sm text-gray-600 line-clamp-2">
                                                {event.description}
                                            </p>
                                        )}

                                        <div className="mt-4 space-y-2">
                                            <div className="flex items-center text-sm text-gray-500">
                                                <Calendar className="h-4 w-4 mr-2" />
                                                {formatDate(event.start_time)}
                                            </div>
                                            {event.location_name && (
                                                <div className="flex items-center text-sm text-gray-500">
                                                    <MapPin className="h-4 w-4 mr-2" />
                                                    {event.location_name}
                                                </div>
                                            )}
                                        </div>

                                        <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
                                            <span className="text-sm font-medium text-gray-900">
                                                {formatPrice(event.min_price, event.max_price, event.currency)}
                                            </span>
                                            {event.tickets_available > 0 ? (
                                                <span className="text-sm text-green-600">
                                                    {event.tickets_available} tickets left
                                                </span>
                                            ) : (
                                                <span className="text-sm text-red-600">Sold out</span>
                                            )}
                                        </div>
                                    </div>
                                </Link>
                            ))}
                        </div>

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="mt-8 flex items-center justify-center gap-4">
                                <button
                                    onClick={() => setSearchParams({ ...Object.fromEntries(searchParams), page: String(page - 1) })}
                                    disabled={page <= 1}
                                    className="flex items-center px-4 py-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <ChevronLeft className="h-4 w-4 mr-1" />
                                    Previous
                                </button>
                                <span className="text-sm text-gray-500">
                                    Page {page} of {totalPages}
                                </span>
                                <button
                                    onClick={() => setSearchParams({ ...Object.fromEntries(searchParams), page: String(page + 1) })}
                                    disabled={page >= totalPages}
                                    className="flex items-center px-4 py-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Next
                                    <ChevronRight className="h-4 w-4 ml-1" />
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}

export default PublicEvents
