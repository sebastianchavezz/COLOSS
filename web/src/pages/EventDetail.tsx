/**
 * EventDetail Page
 *
 * Detail pagina voor een specifiek event met sidebar navigatie.
 * Features:
 * - Sidebar met alle event categorieën
 * - Full-width content area per categorie
 * - Compacte header met event info
 */

import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Link, NavLink, Outlet } from 'react-router-dom'
import {
    ArrowLeft, Loader2, Trash2, CheckCircle, XCircle,
    LayoutDashboard, Ticket, ShoppingCart, Users, Route, Package,
    MessageSquare, Mail, HelpCircle, Settings, ChevronDown, CalendarDays, UserPlus
} from 'lucide-react'
import { clsx } from 'clsx'
import { useOrgSafe } from '../hooks/useOrg'
import { getEventBySlug, setEventStatus, softDeleteEvent, listEvents } from '../data/events'
import type { AppEvent } from '../types/supabase'

export function EventDetail() {
    const { eventSlug } = useParams<{ eventSlug: string }>()
    const context = useOrgSafe()
    const org = context?.org
    const navigate = useNavigate()

    const [event, setEvent] = useState<AppEvent | null>(null)
    const [allEvents, setAllEvents] = useState<AppEvent[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [actionLoading, setActionLoading] = useState(false)
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
    const [showEventSwitcher, setShowEventSwitcher] = useState(false)

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

    // Fetch all events for event switcher
    useEffect(() => {
        async function fetchAllEvents() {
            if (!org) return
            const { data } = await listEvents(org.id)
            if (data) setAllEvents(data)
        }
        fetchAllEvents()
    }, [org?.id])

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


    // Sidebar navigatie items
    const navItems = [
        { name: 'Overzicht', href: '', icon: LayoutDashboard },
        { name: 'Tickets', href: 'tickets', icon: Ticket },
        { name: 'Bestellingen', href: 'orders', icon: ShoppingCart },
        { name: 'Deelnemers', href: 'participants', icon: Users },
        { name: 'Uitnodigingen', href: 'invitations', icon: UserPlus },
        { name: 'Route', href: 'route', icon: Route },
        { name: 'Producten', href: 'products', icon: Package },
        { name: 'Communicatie', href: 'communication', icon: MessageSquare },
        { name: 'Berichten', href: 'messaging', icon: Mail },
        { name: 'FAQ', href: 'faq', icon: HelpCircle },
        { name: 'Instellingen', href: 'settings', icon: Settings },
    ]

    return (
        <div className="flex h-screen">
            {/* Sidebar */}
            <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
                {/* COLOSS Header */}
                <div className="h-16 flex items-center px-4 border-b border-gray-200">
                    <Link to={`/org/${org.slug}/events`}>
                        <img src="/coloss-logo.png" alt="COLOSS" className="h-8 w-auto" />
                    </Link>
                </div>

                {/* Event Switcher */}
                <div className="p-3 border-b border-gray-200 relative">
                    <button
                        onClick={() => setShowEventSwitcher(!showEventSwitcher)}
                        className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                        <div className="flex items-center min-w-0">
                            <div className="flex-shrink-0 w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
                                <CalendarDays className="h-4 w-4 text-indigo-600" />
                            </div>
                            <div className="ml-3 text-left min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">{event.name}</p>
                                <p className="text-xs text-gray-500">
                                    {new Date(event.start_time).toLocaleDateString('nl-NL', {
                                        day: 'numeric',
                                        month: 'short'
                                    })}
                                </p>
                            </div>
                        </div>
                        <ChevronDown className={clsx(
                            'h-4 w-4 text-gray-400 transition-transform flex-shrink-0',
                            showEventSwitcher && 'rotate-180'
                        )} />
                    </button>

                    {/* Event Dropdown */}
                    {showEventSwitcher && (
                        <div className="absolute left-3 right-3 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                            <Link
                                to={`/org/${org.slug}/events`}
                                className="flex items-center px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 border-b border-gray-100"
                                onClick={() => setShowEventSwitcher(false)}
                            >
                                <ArrowLeft className="mr-2 h-4 w-4" />
                                Alle evenementen
                            </Link>
                            {allEvents.map((e) => (
                                <button
                                    key={e.id}
                                    onClick={() => {
                                        navigate(`/org/${org.slug}/events/${e.slug}`)
                                        setShowEventSwitcher(false)
                                    }}
                                    className={clsx(
                                        'w-full flex items-center px-3 py-2 text-sm text-left hover:bg-gray-50',
                                        e.id === event.id && 'bg-indigo-50'
                                    )}
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className={clsx(
                                            'truncate',
                                            e.id === event.id ? 'font-medium text-indigo-700' : 'text-gray-700'
                                        )}>
                                            {e.name}
                                        </p>
                                        <p className="text-xs text-gray-500">
                                            {new Date(e.start_time).toLocaleDateString('nl-NL', {
                                                day: 'numeric',
                                                month: 'short'
                                            })}
                                        </p>
                                    </div>
                                    <StatusBadge status={e.status} />
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Navigation */}
                <nav className="flex-1 py-4 overflow-y-auto">
                    {navItems.map((item) => {
                        const fullPath = item.href
                            ? `/org/${org.slug}/events/${eventSlug}/${item.href}`
                            : `/org/${org.slug}/events/${eventSlug}`

                        return (
                            <NavLink
                                key={item.name}
                                to={fullPath}
                                end={!item.href}
                                className={({ isActive }) => clsx(
                                    'flex items-center px-4 py-2.5 text-sm font-medium transition-colors',
                                    isActive
                                        ? 'bg-indigo-50 text-indigo-700 border-r-2 border-indigo-600'
                                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                                )}
                            >
                                <item.icon className="mr-3 h-5 w-5" />
                                {item.name}
                            </NavLink>
                        )
                    })}
                </nav>

                {/* Actions at bottom */}
                <div className="p-4 border-t border-gray-200 space-y-2">
                    <button
                        onClick={handleToggleStatus}
                        disabled={actionLoading}
                        className={clsx(
                            'w-full flex items-center justify-center px-3 py-2 text-sm font-medium rounded-md transition-colors',
                            event.status === 'published'
                                ? 'border border-yellow-300 text-yellow-700 bg-yellow-50 hover:bg-yellow-100'
                                : 'border border-green-300 text-green-700 bg-green-50 hover:bg-green-100',
                            'disabled:opacity-50'
                        )}
                    >
                        {actionLoading ? (
                            <Loader2 className="animate-spin h-4 w-4" />
                        ) : event.status === 'published' ? (
                            <>
                                <XCircle className="mr-1.5 h-4 w-4" />
                                Concept
                            </>
                        ) : (
                            <>
                                <CheckCircle className="mr-1.5 h-4 w-4" />
                                Publiceer
                            </>
                        )}
                    </button>
                    <button
                        onClick={() => setShowDeleteConfirm(true)}
                        disabled={actionLoading}
                        className="w-full flex items-center justify-center px-3 py-2 border border-red-300 text-sm font-medium rounded-md text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50"
                    >
                        <Trash2 className="mr-1.5 h-4 w-4" />
                        Verwijderen
                    </button>
                </div>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 overflow-y-auto bg-gray-50">
                <div className="p-6">
                    <Outlet context={{ event, org, refreshEvent: fetchEvent }} />
                </div>
            </main>

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
