/**
 * SporterDashboard - Main dashboard for sporters
 *
 * Shows:
 * - Upcoming events (registered)
 * - Recent tickets
 * - Quick links
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Ticket, Calendar, ArrowRight, MapPin } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

interface UpcomingRegistration {
    id: string
    event_id: string
    event_name: string
    event_slug: string
    event_start: string
    event_location: string
    ticket_count: number
}

export function SporterDashboard() {
    const { user } = useAuth()
    const [registrations, setRegistrations] = useState<UpcomingRegistration[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!user) return

        async function fetchData() {
            if (!user) return // TypeScript guard

            // Fetch participant's upcoming events via their tickets
            const { data, error } = await supabase
                .from('ticket_instances')
                .select(`
                    id,
                    order:orders!inner(
                        id,
                        user_id,
                        event:events!inner(
                            id,
                            name,
                            slug,
                            start_time,
                            location_name
                        )
                    )
                `)
                .eq('order.user_id', user.id)
                .eq('status', 'issued')
                .gte('order.event.start_time', new Date().toISOString())
                .order('created_at', { ascending: false })
                .limit(10)

            if (error) {
                console.error('Error fetching registrations:', error)
                setLoading(false)
                return
            }

            // Group by event
            const eventMap = new Map<string, UpcomingRegistration>()
            for (const ticket of data || []) {
                const event = (ticket.order as any)?.event
                if (!event) continue

                const existing = eventMap.get(event.id)
                if (existing) {
                    existing.ticket_count++
                } else {
                    eventMap.set(event.id, {
                        id: event.id,
                        event_id: event.id,
                        event_name: event.name,
                        event_slug: event.slug,
                        event_start: event.start_time,
                        event_location: event.location_name,
                        ticket_count: 1,
                    })
                }
            }

            setRegistrations(Array.from(eventMap.values()))
            setLoading(false)
        }

        fetchData()
    }, [user])

    function formatDate(dateString: string) {
        return new Date(dateString).toLocaleDateString('nl-NL', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        })
    }

    return (
        <div className="space-y-8">
            {/* Welcome */}
            <div>
                <h1 className="text-2xl font-bold text-gray-900">
                    Welkom terug!
                </h1>
                <p className="text-gray-600 mt-1">
                    Beheer je inschrijvingen en tickets.
                </p>
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Link
                    to="/events"
                    className="p-6 bg-white rounded-lg border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all"
                >
                    <Calendar className="h-8 w-8 text-gray-400 mb-3" />
                    <h3 className="font-semibold text-gray-900">Ontdek Events</h3>
                    <p className="text-sm text-gray-500 mt-1">
                        Vind nieuwe sportevenementen
                    </p>
                </Link>
                <Link
                    to="/my/tickets"
                    className="p-6 bg-white rounded-lg border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all"
                >
                    <Ticket className="h-8 w-8 text-gray-400 mb-3" />
                    <h3 className="font-semibold text-gray-900">Mijn Tickets</h3>
                    <p className="text-sm text-gray-500 mt-1">
                        Bekijk je tickets en QR codes
                    </p>
                </Link>
            </div>

            {/* Upcoming Events */}
            <div>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-gray-900">
                        Aankomende Events
                    </h2>
                    <Link
                        to="/my/tickets"
                        className="text-sm text-gray-600 hover:text-black flex items-center gap-1"
                    >
                        Alle tickets
                        <ArrowRight className="h-4 w-4" />
                    </Link>
                </div>

                {loading ? (
                    <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400 mx-auto"></div>
                    </div>
                ) : registrations.length === 0 ? (
                    <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
                        <Calendar className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                        <p className="text-gray-500">Geen aankomende events</p>
                        <Link
                            to="/events"
                            className="inline-block mt-4 text-sm font-medium text-black hover:underline"
                        >
                            Ontdek events →
                        </Link>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {registrations.map((reg) => (
                            <Link
                                key={reg.id}
                                to={`/e/${reg.event_slug}`}
                                className="block bg-white rounded-lg border border-gray-200 p-4 hover:border-gray-300 hover:shadow-sm transition-all"
                            >
                                <div className="flex items-start justify-between">
                                    <div>
                                        <h3 className="font-medium text-gray-900">
                                            {reg.event_name}
                                        </h3>
                                        <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                                            <span className="flex items-center gap-1">
                                                <Calendar className="h-4 w-4" />
                                                {formatDate(reg.event_start)}
                                            </span>
                                            {reg.event_location && (
                                                <span className="flex items-center gap-1">
                                                    <MapPin className="h-4 w-4" />
                                                    {reg.event_location}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <span className="text-sm bg-gray-100 px-2 py-1 rounded">
                                        {reg.ticket_count} ticket{reg.ticket_count !== 1 ? 's' : ''}
                                    </span>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

export default SporterDashboard
