/**
 * EventDetail Page
 *
 * Detail pagina voor een specifiek event met sidebar navigatie.
 * Features:
 * - Dark minimalist sidebar met alle event categorieën
 * - Collapsible sidebar
 * - Full-width content area per categorie
 */

import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Link, Outlet } from 'react-router-dom'
import {
    ArrowLeft, Loader2, Trash2, CheckCircle, XCircle,
    LayoutDashboard, Ticket, ShoppingCart, Users, Route, Package,
    MessageSquare, Mail, HelpCircle, Settings, ChevronDown, CalendarDays, UserPlus,
    CreditCard, Building2
} from 'lucide-react'
import { clsx } from 'clsx'
import { useOrgSafe } from '../hooks/useOrg'
import { getEventBySlug, setEventStatus, softDeleteEvent, listEvents } from '../data/events'
import type { AppEvent } from '../types/supabase'
import {
    SidebarProvider,
    Sidebar,
    SidebarHeader,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupLabel,
    SidebarItem,
    SidebarLink,
    SidebarToggle,
    SidebarSeparator,
    SidebarMobileTrigger,
    useSidebar
} from '../components/ui/sidebar'

function EventSwitcher({
    event,
    allEvents,
    orgSlug
}: {
    event: AppEvent
    allEvents: AppEvent[]
    orgSlug: string
}) {
    const [showDropdown, setShowDropdown] = useState(false)
    const { isCollapsed, setIsMobileOpen, isMobile } = useSidebar()
    const navigate = useNavigate()

    const handleEventSelect = (e: AppEvent) => {
        navigate(`/org/${orgSlug}/events/${e.slug}`)
        setShowDropdown(false)
        if (isMobile) setIsMobileOpen(false)
    }

    if (isCollapsed) {
        return (
            <div className="px-2 py-3 border-b border-neutral-800">
                <div className="flex items-center justify-center">
                    <div className="w-10 h-10 bg-indigo-900/50 rounded-lg flex items-center justify-center">
                        <CalendarDays className="h-5 w-5 text-indigo-400" />
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="p-3 border-b border-neutral-800 relative">
            <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-neutral-900 transition-colors"
            >
                <div className="flex items-center min-w-0">
                    <div className="flex-shrink-0 w-10 h-10 bg-indigo-900/50 rounded-lg flex items-center justify-center">
                        <CalendarDays className="h-5 w-5 text-indigo-400" />
                    </div>
                    <div className="ml-3 text-left min-w-0">
                        <p className="text-sm font-medium text-white truncate">{event.name}</p>
                        <p className="text-xs text-neutral-400">
                            {new Date(event.start_time).toLocaleDateString('nl-NL', {
                                day: 'numeric',
                                month: 'short'
                            })}
                        </p>
                    </div>
                </div>
                <ChevronDown className={clsx(
                    'h-4 w-4 text-neutral-400 transition-transform flex-shrink-0',
                    showDropdown && 'rotate-180'
                )} />
            </button>

            {showDropdown && (
                <div className="absolute left-3 right-3 top-full mt-1 bg-neutral-900 border border-neutral-800 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                    <Link
                        to={`/org/${orgSlug}/events`}
                        className="flex items-center px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800 border-b border-neutral-800"
                        onClick={() => {
                            setShowDropdown(false)
                            if (isMobile) setIsMobileOpen(false)
                        }}
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Alle evenementen
                    </Link>
                    {allEvents.map((e) => (
                        <button
                            key={e.id}
                            onClick={() => handleEventSelect(e)}
                            className={clsx(
                                'w-full flex items-center px-3 py-2 text-sm text-left hover:bg-neutral-800',
                                e.id === event.id && 'bg-indigo-900/30'
                            )}
                        >
                            <div className="min-w-0 flex-1">
                                <p className={clsx(
                                    'truncate',
                                    e.id === event.id ? 'font-medium text-indigo-400' : 'text-neutral-300'
                                )}>
                                    {e.name}
                                </p>
                                <p className="text-xs text-neutral-500">
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
    )
}

function EventSidebar({
    event,
    allEvents,
    orgSlug,
    eventSlug,
    onToggleStatus,
    onDelete,
    actionLoading
}: {
    event: AppEvent
    allEvents: AppEvent[]
    orgSlug: string
    eventSlug: string
    onToggleStatus: () => void
    onDelete: () => void
    actionLoading: boolean
}) {
    const { isCollapsed } = useSidebar()

    const eventNavItems = [
        { name: 'Overzicht', href: '', icon: LayoutDashboard, end: true },
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

    const orgNavItems = [
        { name: 'Team', href: `/org/${orgSlug}/team`, icon: Users },
        { name: 'Finance', href: `/org/${orgSlug}/finance`, icon: CreditCard },
        { name: 'Organisatie', href: `/org/${orgSlug}/settings`, icon: Building2 },
    ]

    return (
        <Sidebar>
            <SidebarHeader className="justify-between">
                <Link to={`/org/${orgSlug}/events`}>
                    {isCollapsed ? (
                        <div className="h-8 w-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">
                            C
                        </div>
                    ) : (
                        <img src="/coloss-logo.png" alt="COLOSS" className="h-8 w-auto" />
                    )}
                </Link>
                <SidebarToggle />
            </SidebarHeader>

            <EventSwitcher event={event} allEvents={allEvents} orgSlug={orgSlug} />

            <SidebarContent>
                <SidebarGroup>
                    {eventNavItems.map((item) => {
                        const fullPath = item.href
                            ? `/org/${orgSlug}/events/${eventSlug}/${item.href}`
                            : `/org/${orgSlug}/events/${eventSlug}`

                        return (
                            <SidebarItem
                                key={item.name}
                                icon={item.icon}
                                label={item.name}
                                href={fullPath}
                                end={item.end}
                            />
                        )
                    })}
                </SidebarGroup>

                <SidebarSeparator />

                <SidebarGroup>
                    <SidebarGroupLabel>Administratie</SidebarGroupLabel>
                    {orgNavItems.map((item) => (
                        <SidebarLink
                            key={item.name}
                            icon={item.icon}
                            label={item.name}
                            href={item.href}
                        />
                    ))}
                </SidebarGroup>
            </SidebarContent>

            <SidebarFooter>
                {!isCollapsed && (
                    <div className="space-y-2">
                        <button
                            onClick={onToggleStatus}
                            disabled={actionLoading}
                            className={clsx(
                                'w-full flex items-center justify-center px-3 py-2 text-sm font-medium rounded-lg transition-colors',
                                event.status === 'published'
                                    ? 'bg-yellow-900/30 text-yellow-400 hover:bg-yellow-900/50'
                                    : 'bg-green-900/30 text-green-400 hover:bg-green-900/50',
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
                            onClick={onDelete}
                            disabled={actionLoading}
                            className="w-full flex items-center justify-center px-3 py-2 text-sm font-medium rounded-lg bg-red-900/30 text-red-400 hover:bg-red-900/50 disabled:opacity-50"
                        >
                            <Trash2 className="mr-1.5 h-4 w-4" />
                            Verwijderen
                        </button>
                    </div>
                )}
            </SidebarFooter>
        </Sidebar>
    )
}

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

    // Fetch event data
    const fetchEvent = useCallback(async () => {
        if (!org || !eventSlug) return

        const { data, error: fetchError } = await getEventBySlug(org.id, eventSlug)

        if (fetchError) {
            setError(fetchError.message)
        } else if (!data) {
            setError('Event niet gevonden')
        } else {
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

        const { data, error: updateError } = await setEventStatus(event.id, newStatus)

        if (updateError) {
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

        const { success, error: deleteError } = await softDeleteEvent(event.id)

        if (deleteError) {
            setError(deleteError.message)
            setActionLoading(false)
        } else if (success) {
            navigate(`/org/${org.slug}/events`)
        }
    }

    // Guards
    if (!org) {
        return <div className="p-4 text-gray-500">Organisatie laden...</div>
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-50">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
        )
    }

    if (error || !event) {
        return (
            <div className="text-center py-12 bg-gray-50 min-h-screen flex items-center justify-center">
                <div>
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
            </div>
        )
    }

    return (
        <SidebarProvider>
            <div className="flex h-screen">
                <SidebarMobileTrigger />

                <EventSidebar
                    event={event}
                    allEvents={allEvents}
                    orgSlug={org.slug}
                    eventSlug={eventSlug!}
                    onToggleStatus={handleToggleStatus}
                    onDelete={() => setShowDeleteConfirm(true)}
                    actionLoading={actionLoading}
                />

                {/* Main Content Area */}
                <main className="flex-1 overflow-y-auto bg-gray-50">
                    <div className="p-6 md:p-8">
                        <Outlet context={{ event, org, refreshEvent: fetchEvent }} />
                    </div>
                </main>

                {/* Delete Confirmation Modal */}
                {showDeleteConfirm && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
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
        </SidebarProvider>
    )
}

/**
 * Status Badge Component
 */
function StatusBadge({ status }: { status: string }) {
    const config = {
        draft: { bg: 'bg-yellow-900/30', text: 'text-yellow-400', label: 'Concept' },
        published: { bg: 'bg-green-900/30', text: 'text-green-400', label: 'Live' },
        closed: { bg: 'bg-neutral-700', text: 'text-neutral-300', label: 'Gesloten' },
    }

    const { bg, text, label } = config[status as keyof typeof config] || config.draft

    return (
        <span className={clsx(
            'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
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
                    <div key={stat} className="bg-white rounded-lg px-4 py-5 text-center shadow-sm border border-gray-200">
                        <p className="text-sm font-medium text-gray-500">{stat}</p>
                        <p className="mt-1 text-3xl font-semibold text-gray-900">–</p>
                    </div>
                ))}
            </div>
        </div>
    )
}

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
