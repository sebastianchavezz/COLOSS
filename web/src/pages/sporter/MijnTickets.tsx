/**
 * MijnTickets - Ticket overview for sporters
 *
 * Shows all tickets with:
 * - QR code for scanning
 * - Event info
 * - Ticket status
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { QrCode, Calendar, MapPin, CheckCircle, XCircle, Clock, MessageSquare, Map, HelpCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

interface TicketWithEvent {
    id: string
    qr_code: string
    status: 'issued' | 'void' | 'checked_in'
    checked_in_at: string | null
    ticket_type: {
        name: string
        price: number
    }
    order: {
        event: {
            id: string
            name: string
            slug: string
            start_time: string
            location_name: string
        }
    }
}

export function MijnTickets() {
    const { user } = useAuth()
    const [tickets, setTickets] = useState<TicketWithEvent[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedTicket, setSelectedTicket] = useState<TicketWithEvent | null>(null)

    useEffect(() => {
        if (!user) return

        async function fetchTickets() {
            if (!user) return // TypeScript guard

            const { data, error } = await supabase
                .from('ticket_instances')
                .select(`
                    id,
                    qr_code,
                    status,
                    checked_in_at,
                    ticket_type:ticket_types(name, price),
                    order:orders!inner(
                        user_id,
                        event:events(id, name, slug, start_time, location_name)
                    )
                `)
                .eq('order.user_id', user.id)
                .order('created_at', { ascending: false })

            if (error) {
                console.error('Error fetching tickets:', error)
                setLoading(false)
                return
            }

            setTickets((data || []) as unknown as TicketWithEvent[])
            setLoading(false)
        }

        fetchTickets()
    }, [user])

    function formatDate(dateString: string) {
        return new Date(dateString).toLocaleDateString('nl-NL', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
        })
    }

    function getStatusBadge(status: string, checkedInAt: string | null) {
        // Status enum: 'issued', 'void', 'checked_in'
        if (status === 'checked_in' || checkedInAt) {
            return (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-800">
                    <CheckCircle className="h-3 w-3" />
                    Ingecheckt
                </span>
            )
        }

        switch (status) {
            case 'issued':
                return (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800">
                        <Clock className="h-3 w-3" />
                        Geldig
                    </span>
                )
            case 'void':
                return (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-800">
                        <XCircle className="h-3 w-3" />
                        Ongeldig
                    </span>
                )
            default:
                return null
        }
    }

    // Generate QR code URL (using a free QR service)
    function getQRCodeUrl(token: string) {
        return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(token)}`
    }

    if (loading) {
        return (
            <div className="text-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400 mx-auto"></div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-gray-900">Mijn Tickets</h1>
                <p className="text-gray-600 mt-1">
                    {tickets.length} ticket{tickets.length !== 1 ? 's' : ''}
                </p>
            </div>

            {tickets.length === 0 ? (
                <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
                    <QrCode className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">
                        Geen tickets
                    </h3>
                    <p className="text-gray-500 mb-6">
                        Je hebt nog geen tickets gekocht.
                    </p>
                    <Link
                        to="/events"
                        className="inline-block px-6 py-3 bg-black text-white rounded-lg font-medium hover:bg-gray-800"
                    >
                        Ontdek events
                    </Link>
                </div>
            ) : (
                <div className="grid gap-4">
                    {tickets.map((ticket) => (
                        <div
                            key={ticket.id}
                            className="bg-white rounded-lg border border-gray-200 overflow-hidden"
                        >
                            <div className="p-4">
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <h3 className="font-semibold text-gray-900">
                                            {ticket.order.event.name}
                                        </h3>
                                        <p className="text-sm text-gray-600 mt-1">
                                            {ticket.ticket_type?.name}
                                        </p>
                                        <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
                                            <span className="flex items-center gap-1">
                                                <Calendar className="h-4 w-4" />
                                                {formatDate(ticket.order.event.start_time)}
                                            </span>
                                            {ticket.order.event.location_name && (
                                                <span className="flex items-center gap-1">
                                                    <MapPin className="h-4 w-4" />
                                                    {ticket.order.event.location_name}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="ml-4">
                                        {getStatusBadge(ticket.status, ticket.checked_in_at)}
                                    </div>
                                </div>

                                {/* Quick Actions */}
                                <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-100">
                                    <button
                                        onClick={() => setSelectedTicket(ticket)}
                                        className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-black bg-gray-100 rounded hover:bg-gray-200"
                                    >
                                        <QrCode className="h-4 w-4" />
                                        QR Code
                                    </button>
                                    <Link
                                        to={`/e/${ticket.order.event.slug}/route`}
                                        className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-black"
                                    >
                                        <Map className="h-4 w-4" />
                                        Route
                                    </Link>
                                    <Link
                                        to={`/e/${ticket.order.event.slug}/faq`}
                                        className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-black"
                                    >
                                        <HelpCircle className="h-4 w-4" />
                                        FAQ
                                    </Link>
                                    <Link
                                        to={`/e/${ticket.order.event.slug}/chat`}
                                        className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-black"
                                    >
                                        <MessageSquare className="h-4 w-4" />
                                        Contact
                                    </Link>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* QR Code Modal */}
            {selectedTicket && (
                <div
                    className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
                    onClick={() => setSelectedTicket(null)}
                >
                    <div
                        className="bg-white rounded-2xl p-6 max-w-sm w-full"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="text-center">
                            <h3 className="font-semibold text-lg text-gray-900 mb-1">
                                {selectedTicket.order.event.name}
                            </h3>
                            <p className="text-sm text-gray-500 mb-6">
                                {selectedTicket.ticket_type?.name}
                            </p>

                            <div className="bg-white p-4 rounded-xl border-2 border-gray-100 inline-block">
                                <img
                                    src={getQRCodeUrl(selectedTicket.qr_code)}
                                    alt="Ticket QR Code"
                                    className="w-48 h-48"
                                />
                            </div>

                            <p className="text-xs text-gray-400 mt-4 font-mono">
                                {selectedTicket.qr_code.slice(0, 8)}...{selectedTicket.qr_code.slice(-8)}
                            </p>

                            <button
                                onClick={() => setSelectedTicket(null)}
                                className="mt-6 w-full py-3 bg-black text-white rounded-lg font-medium hover:bg-gray-800"
                            >
                                Sluiten
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default MijnTickets
