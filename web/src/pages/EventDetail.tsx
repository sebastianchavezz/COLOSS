/**
 * EventDetail Page
 * 
 * Detail pagina voor een specifiek event.
 * Features:
 * - Header met naam, datum, status, acties
 * - Status toggle (draft <-> published)
 * - Delete knop (soft delete met confirm)
 * - Tabs voor sub-secties (Coming soon placeholders)
 */

import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Link, NavLink, Outlet } from 'react-router-dom'
import { ArrowLeft, Calendar, MapPin, Loader2, MoreVertical, Trash2, CheckCircle, XCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { useOrgSafe } from '../hooks/useOrg'
import { getEventBySlug, setEventStatus, softDeleteEvent } from '../data/events'
import type { AppEvent } from '../types/supabase'

export function EventDetail() {
    const { eventSlug } = useParams<{ eventSlug: string }>()
    const context = useOrgSafe()
    const org = context?.org
    const navigate = useNavigate()

    const [event, setEvent] = useState<AppEvent | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [actionLoading, setActionLoading] = useState(false)
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

    // Fetch event data
    const fetchEvent = useCallback(async () => {
        if (!org || !eventSlug) return

        console.log('[EventDetail] Fetching event:', { orgId: org.id, eventSlug })

        const { data, error: fetchError } = await getEventBySlug(org.id, eventSlug)

        if (fetchError) {
            console.error('[EventDetail] Error:', fetchError)
            setError(fetchError.message)
        } else if (!data) {
            setError('Event niet gevonden')
        } else {
            console.log('[EventDetail] Loaded event:', data.name)
            setEvent(data)
        }

        setLoading(false)
    }, [org?.id, eventSlug])

    useEffect(() => {
        fetchEvent()
    }, [fetchEvent])

    // Toggle status
    const handleToggleStatus = async () => {
        if (!event) return

        const newStatus = event.status === 'published' ? 'draft' : 'published'

        setActionLoading(true)
        console.log('[EventDetail] Toggling status:', { from: event.status, to: newStatus })

        const { data, error: updateError } = await setEventStatus(event.id, newStatus)

        if (updateError) {
            console.error('[EventDetail] Status update error:', updateError)
            setError(updateError.message)
        } else if (data) {
            setEvent(data)
        }

        setActionLoading(false)
    }

    // Delete event
    const handleDelete = async () => {
        if (!event || !org) return

        setActionLoading(true)
        console.log('[EventDetail] Deleting event:', event.id)

        const { success, error: deleteError } = await softDeleteEvent(event.id)

        if (deleteError) {
            console.error('[EventDetail] Delete error:', deleteError)
            setError(deleteError.message)
            setActionLoading(false)
        } else if (success) {
            console.log('[EventDetail] Deleted, navigating back')
            navigate(`/org/${org.slug}/events`)
        }
    }

    // Guards
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

    if (error || !event) {
        return (
            <div className="text-center py-12">
                <h2 className="text-lg font-medium text-gray-900 mb-2">Event niet gevonden</h2>
                <p className="text-gray-500 mb-4">{error || 'Dit event bestaat niet of is verwijderd.'}</p>
                <Link
                    to={`/org/${org.slug}/events`}
                    className="inline-flex items-center text-indigo-600 hover:text-indigo-500"
                >
                    <ArrowLeft className="mr-1 h-4 w-4" />
                    Terug naar evenementen
                </Link>
            </div>
        )
    }


    // Tab configuratie
    const tabs = [
        { name: 'Overzicht', href: '' },
        { name: 'Tickets', href: 'tickets' },
        { name: 'Bestellingen', href: 'orders' },
        { name: 'Deelnemers', href: 'participants' },
        { name: 'Producten', href: 'products' },
        { name: 'Communicatie', href: 'communication' },
        { name: 'Instellingen', href: 'settings' },
    ]


    return (
        <div className="space-y-6">
            {/* Back link */}
            <Link
                to={`/org/${org.slug}/events`}
                className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
            >
                <ArrowLeft className="mr-1 h-4 w-4" />
                Alle evenementen
            </Link>

            {/* Event Header */}
            <div className="bg-white shadow sm:rounded-lg">
                <div className="px-4 py-5 sm:px-6">
                    <div className="flex items-start justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">{event.name}</h1>
                            <div className="mt-2 flex items-center text-sm text-gray-500 space-x-4">
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
                                {event.location_name && (
                                    <span className="flex items-center">
                                        <MapPin className="mr-1 h-4 w-4" />
                                        {event.location_name}
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Status + Actions */}
                        <div className="flex items-center space-x-3">
                            <StatusBadge status={event.status} />

                            {/* Toggle Status Button */}
                            <button
                                onClick={handleToggleStatus}
                                disabled={actionLoading}
                                className={clsx(
                                    'inline-flex items-center px-3 py-2 border text-sm font-medium rounded-md',
                                    event.status === 'published'
                                        ? 'border-yellow-300 text-yellow-700 bg-yellow-50 hover:bg-yellow-100'
                                        : 'border-green-300 text-green-700 bg-green-50 hover:bg-green-100',
                                    'disabled:opacity-50'
                                )}
                            >
                                {actionLoading ? (
                                    <Loader2 className="animate-spin h-4 w-4" />
                                ) : event.status === 'published' ? (
                                    <>
                                        <XCircle className="mr-1 h-4 w-4" />
                                        Zet naar concept
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle className="mr-1 h-4 w-4" />
                                        Publiceer
                                    </>
                                )}
                            </button>

                            {/* Delete Button */}
                            <button
                                onClick={() => setShowDeleteConfirm(true)}
                                disabled={actionLoading}
                                className="inline-flex items-center px-3 py-2 border border-red-300 text-sm font-medium rounded-md text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50"
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="border-t border-gray-200">
                    <nav className="-mb-px flex space-x-8 px-6" aria-label="Tabs">
                        {tabs.map((tab) => {
                            const fullPath = tab.href
                                ? `/org/${org.slug}/events/${eventSlug}/${tab.href}`
                                : `/org/${org.slug}/events/${eventSlug}`

                            return (
                                <NavLink
                                    key={tab.name}
                                    to={fullPath}
                                    end={!tab.href}
                                    className={({ isActive }) => clsx(
                                        'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm',
                                        isActive
                                            ? 'border-indigo-500 text-indigo-600'
                                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                    )}
                                >
                                    {tab.name}
                                </NavLink>
                            )
                        })}
                    </nav>
                </div>
            </div>

            {/* Tab Content */}
            <div className="bg-white shadow sm:rounded-lg p-6">
                <Outlet context={{ event, org, refreshEvent: fetchEvent }} />
            </div>

            {/* Delete Confirmation Modal */}
            {showDeleteConfirm && (
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                        <h3 className="text-lg font-medium text-gray-900 mb-2">Event verwijderen?</h3>
                        <p className="text-sm text-gray-500 mb-4">
                            Weet je zeker dat je "{event.name}" wilt verwijderen? Dit kan niet ongedaan worden gemaakt.
                        </p>
                        <div className="flex justify-end space-x-3">
                            <button
                                onClick={() => setShowDeleteConfirm(false)}
                                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                            >
                                Annuleren
                            </button>
                            <button
                                onClick={handleDelete}
                                disabled={actionLoading}
                                className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
                            >
                                {actionLoading ? 'Verwijderen...' : 'Verwijderen'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

/**
 * Status Badge Component
 */
function StatusBadge({ status }: { status: string }) {
    const config = {
        draft: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Concept' },
        published: { bg: 'bg-green-100', text: 'text-green-800', label: 'Gepubliceerd' },
        closed: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Gesloten' },
    }

    const { bg, text, label } = config[status as keyof typeof config] || config.draft

    return (
        <span className={clsx(
            'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
            bg, text
        )}>
            {label}
        </span>
    )
}

// ============================================================
// SUB-ROUTE COMPONENTS (Placeholders for non-implemented tabs)
// ============================================================

export function EventOverview() {
    return (
        <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4">Event Overzicht</h3>
            <p className="text-gray-500">
                Hier komt een dashboard met statistieken: aantal inschrijvingen, omzet, etc.
            </p>
            <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
                {['Inschrijvingen', 'Omzet', 'Tickets verkocht'].map((stat) => (
                    <div key={stat} className="bg-gray-50 rounded-lg px-4 py-5 text-center">
                        <p className="text-sm font-medium text-gray-500">{stat}</p>
                        <p className="mt-1 text-3xl font-semibold text-gray-900">–</p>
                    </div>
                ))}
            </div>
        </div>
    )
}

// Note: EventTickets is now in its own file: src/pages/EventTickets.tsx

export function EventProducts() {
    return (
        <div className="text-center py-12">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Producten</h3>
            <p className="text-gray-500">Coming soon: merchandise, add-ons, extra's.</p>
        </div>
    )
}

export function EventSettings() {
    return (
        <div className="text-center py-12">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Instellingen</h3>
            <p className="text-gray-500">Coming soon: event naam/datum wijzigen, valuta, BTW instellingen.</p>
        </div>
    )
}
