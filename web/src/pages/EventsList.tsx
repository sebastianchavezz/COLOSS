/**
 * EventsList Page
 * 
 * Toont alle events voor de huidige organisatie.
 * Features:
 * - Lijst met event cards (naam, datum, locatie, status badge)
 * - Empty state met CTA naar event aanmaken
 * - Link naar event detail pagina
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Calendar, MapPin, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'
import { useOrgSafe } from '../hooks/useOrg'
import { listEvents } from '../data/events'
import type { AppEvent } from '../types/supabase'

export function EventsList() {
    const context = useOrgSafe()
    const org = context?.org

    const [events, setEvents] = useState<AppEvent[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        async function fetchEvents() {
            if (!org) {
                setLoading(false)
                return
            }

            console.log('[EventsList] Fetching events for org:', org.id)

            const { data, error: fetchError } = await listEvents(org.id)

            if (fetchError) {
                console.error('[EventsList] Error:', fetchError)
                setError(fetchError.message)
            } else {
                console.log('[EventsList] Loaded events:', data?.length)
                setEvents(data || [])
            }

            setLoading(false)
        }

        fetchEvents()
    }, [org?.id]) // Dependency op primitieve waarde

    // Guard: org nog niet geladen
    if (!org) {
        return <div className="p-4 text-gray-500">Organisatie laden...</div>
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="bg-red-50 border border-red-200 rounded-md p-4">
                <p className="text-red-800">Fout bij laden: {error}</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-gray-900">Evenementen</h2>
                <Link
                    to={`/org/${org.slug}/events/new`}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
                >
                    <Plus className="mr-2 h-4 w-4" />
                    Nieuw Evenement
                </Link>
            </div>

            {/* Event List */}
            <div className="bg-white shadow overflow-hidden sm:rounded-md">
                <ul className="divide-y divide-gray-200">
                    {events.length === 0 ? (
                        // Empty State
                        <li className="px-6 py-12 text-center">
                            <Calendar className="mx-auto h-12 w-12 text-gray-400" />
                            <h3 className="mt-2 text-sm font-medium text-gray-900">Geen evenementen</h3>
                            <p className="mt-1 text-sm text-gray-500">Begin met het aanmaken van je eerste event.</p>
                            <div className="mt-6">
                                <Link
                                    to={`/org/${org.slug}/events/new`}
                                    className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
                                >
                                    <Plus className="-ml-1 mr-2 h-5 w-5" />
                                    Nieuw Evenement
                                </Link>
                            </div>
                        </li>
                    ) : (
                        // Event Items
                        events.map((event) => (
                            <li key={event.id}>
                                <Link
                                    to={`/org/${org.slug}/events/${event.slug}`}
                                    className="block hover:bg-gray-50 transition-colors"
                                >
                                    <div className="px-4 py-4 sm:px-6 flex items-center justify-between">
                                        <div className="flex items-center min-w-0 flex-1">
                                            <div className="min-w-0 flex-1 px-4 md:grid md:grid-cols-2 md:gap-4">
                                                {/* Naam + Locatie */}
                                                <div>
                                                    <p className="text-sm font-medium text-indigo-600 truncate">{event.name}</p>
                                                    <p className="mt-2 flex items-center text-sm text-gray-500">
                                                        <MapPin className="flex-shrink-0 mr-1.5 h-4 w-4 text-gray-400" />
                                                        <span className="truncate">{event.location_name || 'Locatie niet ingesteld'}</span>
                                                    </p>
                                                </div>

                                                {/* Datum + Status */}
                                                <div className="hidden md:block">
                                                    <div>
                                                        <p className="text-sm text-gray-900 flex items-center">
                                                            <Calendar className="flex-shrink-0 mr-1.5 h-4 w-4 text-gray-400" />
                                                            {new Date(event.start_time).toLocaleDateString('nl-NL', {
                                                                day: 'numeric',
                                                                month: 'long',
                                                                year: 'numeric',
                                                                hour: '2-digit',
                                                                minute: '2-digit'
                                                            })}
                                                        </p>
                                                        <p className="mt-2 flex items-center text-sm text-gray-500">
                                                            <StatusBadge status={event.status} />
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <div>
                                            <ChevronRight className="h-5 w-5 text-gray-400" />
                                        </div>
                                    </div>
                                </Link>
                            </li>
                        ))
                    )}
                </ul>
            </div>
        </div>
    )
}

/**
 * Status Badge Component
 * Toont een gekleurde badge voor de event status
 */
function StatusBadge({ status }: { status: string }) {
    const styles = {
        draft: 'bg-yellow-100 text-yellow-800',
        published: 'bg-green-100 text-green-800',
        closed: 'bg-gray-100 text-gray-800',
    }

    const labels = {
        draft: 'Concept',
        published: 'Gepubliceerd',
        closed: 'Gesloten',
    }

    return (
        <span className={clsx(
            'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
            styles[status as keyof typeof styles] || styles.draft
        )}>
            {labels[status as keyof typeof labels] || status}
        </span>
    )
}
