/**
 * EventParticipants Page
 * 
 * Deelnemers tab voor event organisators.
 * Features:
 * - Lijst met alle ticket_instances (verkochte tickets)
 * - Status (issued/checked_in/void)
 * - Ticket type naam
 * - QR code
 * - Check-in timestamp
 */

import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Users, QrCode, CheckCircle, XCircle, Circle } from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../lib/supabase'
import type { AppEvent, Organization } from '../types/supabase'

// Context type van EventDetail
interface EventContext {
    event: AppEvent
    org: Organization
    refreshEvent: () => void
}

interface TicketInstance {
    id: string
    event_id: string
    ticket_type_id: string
    order_id: string
    owner_user_id: string | null
    qr_code: string
    status: string
    checked_in_at: string | null
    checked_in_by: string | null
    created_at: string
    // Joined data
    ticket_type_name?: string
    order_email?: string
}

export function EventParticipants() {
    const { event } = useOutletContext<EventContext>()

    const [participants, setParticipants] = useState<TicketInstance[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Fetch ticket instances
    useEffect(() => {
        async function fetchParticipants() {
            if (!event) return

            console.log('[EventParticipants] Fetching tickets for event:', event.id)

            // Use the helper view with explicit column selection
            // Note: We don't query auth.users directly - email comes from orders table
            const { data, error: fetchError } = await supabase
                .from('ticket_instances_with_payment')
                .select(`
                    id,
                    event_id,
                    ticket_type_id,
                    order_id,
                    owner_user_id,
                    qr_code,
                    status,
                    checked_in_at,
                    checked_in_by,
                    created_at,
                    order_email,
                    order_status,
                    ticket_type_name,
                    ticket_type_price,
                    event_name
                `)
                .eq('event_id', event.id)
                .order('created_at', { ascending: false })

            if (fetchError) {
                console.error('[EventParticipants] Error:', fetchError)
                setError(fetchError.message)
            } else {
                console.log('[EventParticipants] Loaded tickets:', data?.length)
                setParticipants(data || [])
            }

            setLoading(false)
        }

        fetchParticipants()
    }, [event?.id])

    if (loading) {
        return (
            <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
            </div>
        )
    }

    // Stats
    const totalTickets = participants.length
    const checkedInCount = participants.filter(p => p.status === 'checked_in').length
    const issuedCount = participants.filter(p => p.status === 'issued').length
    const voidCount = participants.filter(p => p.status === 'void').length

    return (
        <div>
            {/* Header */}
            <div className="mb-6 flex justify-between items-center">
                <div>
                    <h3 className="text-lg font-medium text-gray-900">Deelnemers</h3>
                    <p className="text-sm text-gray-500">Alle uitgegeven tickets voor dit evenement.</p>
                </div>
                <Link
                    to={`/scan/${event.slug}`}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700"
                >
                    <QrCode className="mr-2 h-4 w-4" />
                    Scan Tickets
                </Link>
            </div>

            {/* Stats */}
            {totalTickets > 0 && (
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-4 mb-6">
                    <div className="bg-white overflow-hidden shadow rounded-lg">
                        <div className="p-5">
                            <div className="flex items-center">
                                <div className="flex-shrink-0">
                                    <Users className="h-6 w-6 text-gray-400" />
                                </div>
                                <div className="ml-5 w-0 flex-1">
                                    <dl>
                                        <dt className="text-sm font-medium text-gray-500 truncate">Totaal</dt>
                                        <dd className="text-lg font-medium text-gray-900">{totalTickets}</dd>
                                    </dl>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white overflow-hidden shadow rounded-lg">
                        <div className="p-5">
                            <div className="flex items-center">
                                <div className="flex-shrink-0">
                                    <CheckCircle className="h-6 w-6 text-green-400" />
                                </div>
                                <div className="ml-5 w-0 flex-1">
                                    <dl>
                                        <dt className="text-sm font-medium text-gray-500 truncate">Ingecheckt</dt>
                                        <dd className="text-lg font-medium text-gray-900">{checkedInCount}</dd>
                                    </dl>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white overflow-hidden shadow rounded-lg">
                        <div className="p-5">
                            <div className="flex items-center">
                                <div className="flex-shrink-0">
                                    <Circle className="h-6 w-6 text-blue-400" />
                                </div>
                                <div className="ml-5 w-0 flex-1">
                                    <dl>
                                        <dt className="text-sm font-medium text-gray-500 truncate">Geldig</dt>
                                        <dd className="text-lg font-medium text-gray-900">{issuedCount}</dd>
                                    </dl>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white overflow-hidden shadow rounded-lg">
                        <div className="p-5">
                            <div className="flex items-center">
                                <div className="flex-shrink-0">
                                    <XCircle className="h-6 w-6 text-red-400" />
                                </div>
                                <div className="ml-5 w-0 flex-1">
                                    <dl>
                                        <dt className="text-sm font-medium text-gray-500 truncate">Ongeldig</dt>
                                        <dd className="text-lg font-medium text-gray-900">{voidCount}</dd>
                                    </dl>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Error */}
            {error && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3">
                    <p className="text-sm text-red-800">{error}</p>
                    <button onClick={() => setError(null)} className="text-sm text-red-600 underline">Sluiten</button>
                </div>
            )}

            {/* Participants List */}
            {participants.length === 0 ? (
                // Empty State
                <div className="text-center py-12 bg-gray-50 rounded-lg">
                    <Users className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">Geen deelnemers</h3>
                    <p className="mt-1 text-sm text-gray-500">Er zijn nog geen tickets uitgegeven voor dit event.</p>
                </div>
            ) : (
                // Participants Table
                <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 rounded-lg">
                    <table className="min-w-full divide-y divide-gray-300">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900">Email</th>
                                <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Ticket Type</th>
                                <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">QR Code</th>
                                <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Status</th>
                                <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Check-in</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                            {participants.map((ticket) => (
                                <tr key={ticket.id} className="hover:bg-gray-50">
                                    <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm">
                                        <div className="font-medium text-gray-900">{ticket.order_email || '–'}</div>
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">
                                        {ticket.ticket_type_name || '–'}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-4 text-sm font-mono text-gray-500">
                                        <div className="flex items-center">
                                            <QrCode className="mr-2 h-4 w-4" />
                                            {ticket.qr_code.slice(0, 8)}...
                                        </div>
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-4 text-sm">
                                        <TicketStatusBadge status={ticket.status} />
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                                        {ticket.checked_in_at ? (
                                            <span className="text-green-600">
                                                {new Date(ticket.checked_in_at).toLocaleDateString('nl-NL', {
                                                    day: 'numeric',
                                                    month: 'short',
                                                    hour: '2-digit',
                                                    minute: '2-digit'
                                                })}
                                            </span>
                                        ) : (
                                            '–'
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}

/**
 * Ticket Status Badge
 */
function TicketStatusBadge({ status }: { status: string }) {
    const config: Record<string, { bg: string; text: string; icon: any; label: string }> = {
        issued: {
            bg: 'bg-blue-100',
            text: 'text-blue-800',
            icon: Circle,
            label: 'Geldig'
        },
        checked_in: {
            bg: 'bg-green-100',
            text: 'text-green-800',
            icon: CheckCircle,
            label: 'Ingecheckt'
        },
        void: {
            bg: 'bg-red-100',
            text: 'text-red-800',
            icon: XCircle,
            label: 'Ongeldig'
        },
    }

    const { bg, text, icon: Icon, label } = config[status] || config.issued

    return (
        <span className={clsx('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', bg, text)}>
            <Icon className="mr-1 h-3 w-3" />
            {label}
        </span>
    )
}
