/**
 * ParticipantProfile Component
 *
 * Sidebar/modal component showing detailed participant information.
 * Includes: contact info, registration, order, products, quick actions, history.
 */

import { useEffect, useState } from 'react'
import { X, Edit2, Save, MessageSquare, Mail, RefreshCw, CreditCard, CheckCircle, User, Package, Clock, ExternalLink } from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'
import { useNavigate } from 'react-router-dom'

interface ParticipantProfileProps {
    participantId: string
    eventId: string
    eventSlug: string
    orgSlug: string
    onClose: () => void
    onUpdate?: () => void
}

interface ProfileData {
    participant: {
        id: string
        first_name: string
        last_name: string
        email: string
        phone: string | null
        user_id: string | null
        created_at: string
    }
    registration: {
        id: string
        status: string
        created_at: string
        updated_at: string
        checked_in_at: string | null
        ticket_type: {
            id: string
            name: string
            price: number
        }
    } | null
    order: {
        id: string
        status: string
        total_amount: number
        created_at: string
    } | null
    tickets: Array<{
        id: string
        qr_code: string
        status: string
        checked_in_at: string | null
        ticket_type_name: string
    }> | null
    chat_thread: {
        id: string
        status: string
        last_message_at: string | null
        message_count: number
    } | null
    history: Array<{
        action: string
        resource_type: string
        created_at: string
        details: any
    }> | null
}

export function ParticipantProfile({
    participantId,
    eventId,
    eventSlug,
    orgSlug,
    onClose,
    onUpdate
}: ParticipantProfileProps) {
    const navigate = useNavigate()
    const [profile, setProfile] = useState<ProfileData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [editing, setEditing] = useState(false)
    const [saving, setSaving] = useState(false)
    const [editForm, setEditForm] = useState({
        first_name: '',
        last_name: '',
        email: '',
        phone: ''
    })

    useEffect(() => {
        fetchProfile()
    }, [participantId, eventId])

    const fetchProfile = async () => {
        setLoading(true)
        setError(null)

        try {
            const { data, error: rpcError } = await supabase.rpc('get_participant_profile', {
                _participant_id: participantId,
                _event_id: eventId
            })

            if (rpcError) throw rpcError

            setProfile(data)
            if (data?.participant) {
                setEditForm({
                    first_name: data.participant.first_name || '',
                    last_name: data.participant.last_name || '',
                    email: data.participant.email || '',
                    phone: data.participant.phone || ''
                })
            }
        } catch (err: any) {
            console.error('[ParticipantProfile] Error:', err)
            setError(err.message || 'Fout bij laden profiel')
        } finally {
            setLoading(false)
        }
    }

    const handleSave = async () => {
        setSaving(true)
        try {
            const { error: updateError } = await supabase.rpc('update_participant_profile', {
                _participant_id: participantId,
                _event_id: eventId,
                _first_name: editForm.first_name,
                _last_name: editForm.last_name,
                _email: editForm.email,
                _phone: editForm.phone || null
            })

            if (updateError) throw updateError

            setEditing(false)
            fetchProfile()
            onUpdate?.()
        } catch (err: any) {
            console.error('[ParticipantProfile] Save error:', err)
            setError(err.message || 'Fout bij opslaan')
        } finally {
            setSaving(false)
        }
    }

    const handleOpenChat = (e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()

        // Build URL from current path (most reliable)
        const currentPath = window.location.pathname
        // Current path: /org/{orgSlug}/events/{eventSlug}/participants
        const basePath = currentPath.replace('/participants', '')

        const targetUrl = profile?.chat_thread
            ? `${basePath}/messaging?thread=${profile.chat_thread.id}`
            : `${basePath}/messaging`

        console.log('[ParticipantProfile] handleOpenChat - navigating to:', targetUrl)

        // Close sidebar first
        onClose()

        // Use window.location for guaranteed navigation (navigate() may be blocked by component lifecycle)
        window.location.href = targetUrl
    }

    const formatPrice = (cents: number) => {
        return new Intl.NumberFormat('nl-NL', {
            style: 'currency',
            currency: 'EUR'
        }).format(cents / 100)
    }

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('nl-NL', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    if (loading) {
        return (
            <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white dark:bg-gray-800 shadow-xl z-50 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
        )
    }

    if (error || !profile) {
        return (
            <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white dark:bg-gray-800 shadow-xl z-50 p-6">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Fout</h2>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                <p className="text-red-600 dark:text-red-400">{error || 'Profiel niet gevonden'}</p>
            </div>
        )
    }

    const { participant, registration, order, tickets, chat_thread, history } = profile

    return (
        <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white dark:bg-gray-800 shadow-xl z-50 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-900">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center">
                        <User className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                        <h2 className="font-semibold text-gray-900 dark:text-white">
                            {participant.first_name} {participant.last_name}
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{participant.email}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {!editing && (
                        <button
                            onClick={() => setEditing(true)}
                            className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-600 dark:text-gray-400"
                            title="Bewerken"
                        >
                            <Edit2 className="h-4 w-4" />
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-600 dark:text-gray-400"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {/* Contact Info (Editable) */}
                <section>
                    <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                        Contact
                    </h3>
                    {editing ? (
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <input
                                    type="text"
                                    value={editForm.first_name}
                                    onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })}
                                    placeholder="Voornaam"
                                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                />
                                <input
                                    type="text"
                                    value={editForm.last_name}
                                    onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })}
                                    placeholder="Achternaam"
                                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                />
                            </div>
                            <input
                                type="email"
                                value={editForm.email}
                                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                                placeholder="Email"
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                            />
                            <input
                                type="tel"
                                value={editForm.phone}
                                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                                placeholder="Telefoon"
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                            />
                            <div className="flex gap-2">
                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="flex-1 px-3 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    <Save className="h-4 w-4" />
                                    {saving ? 'Opslaan...' : 'Opslaan'}
                                </button>
                                <button
                                    onClick={() => setEditing(false)}
                                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                                >
                                    Annuleren
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 space-y-2">
                            <div className="flex items-center gap-2 text-sm">
                                <Mail className="h-4 w-4 text-gray-400" />
                                <span className="text-gray-900 dark:text-white">{participant.email}</span>
                            </div>
                            {participant.phone && (
                                <div className="flex items-center gap-2 text-sm">
                                    <span className="h-4 w-4 text-gray-400 text-center">📱</span>
                                    <span className="text-gray-900 dark:text-white">{participant.phone}</span>
                                </div>
                            )}
                        </div>
                    )}
                </section>

                {/* Registration */}
                {registration && (
                    <section>
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                            Registratie
                        </h3>
                        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 space-y-2">
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-gray-600 dark:text-gray-400">Ticket</span>
                                <span className="text-sm font-medium text-gray-900 dark:text-white">
                                    {registration.ticket_type?.name}
                                </span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-gray-600 dark:text-gray-400">Prijs</span>
                                <span className="text-sm font-medium text-gray-900 dark:text-white">
                                    {formatPrice(registration.ticket_type?.price || 0)}
                                </span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-gray-600 dark:text-gray-400">Status</span>
                                <span className={clsx(
                                    'text-xs font-medium px-2 py-1 rounded',
                                    registration.status === 'confirmed' && 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
                                    registration.status === 'pending' && 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
                                    registration.status === 'cancelled' && 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                                )}>
                                    {registration.status === 'confirmed' && 'Bevestigd'}
                                    {registration.status === 'pending' && 'In afwachting'}
                                    {registration.status === 'cancelled' && 'Geannuleerd'}
                                </span>
                            </div>
                            {registration.checked_in_at && (
                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-gray-600 dark:text-gray-400">Ingecheckt</span>
                                    <span className="text-sm text-green-600 dark:text-green-400">
                                        {formatDate(registration.checked_in_at)}
                                    </span>
                                </div>
                            )}
                        </div>
                    </section>
                )}

                {/* Order */}
                {order && (
                    <section>
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                            Bestelling
                        </h3>
                        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 space-y-2">
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-gray-600 dark:text-gray-400">Order ID</span>
                                <span className="text-sm font-mono text-gray-900 dark:text-white">{order.id.slice(0, 8)}...</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-gray-600 dark:text-gray-400">Totaal</span>
                                <span className="text-sm font-medium text-gray-900 dark:text-white">
                                    {formatPrice(order.total_amount)}
                                </span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-gray-600 dark:text-gray-400">Status</span>
                                <span className={clsx(
                                    'text-xs font-medium px-2 py-1 rounded',
                                    order.status === 'paid' && 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
                                    order.status === 'pending' && 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
                                    order.status === 'cancelled' && 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                                )}>
                                    {order.status === 'paid' && 'Betaald'}
                                    {order.status === 'pending' && 'In afwachting'}
                                    {order.status === 'cancelled' && 'Geannuleerd'}
                                    {order.status === 'refunded' && 'Terugbetaald'}
                                </span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-gray-600 dark:text-gray-400">Datum</span>
                                <span className="text-sm text-gray-900 dark:text-white">
                                    {formatDate(order.created_at)}
                                </span>
                            </div>
                        </div>
                    </section>
                )}

                {/* Tickets */}
                {tickets && tickets.length > 0 && (
                    <section>
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                            Tickets
                        </h3>
                        <div className="space-y-2">
                            {tickets.map((ticket) => (
                                <div key={ticket.id} className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                                            {ticket.ticket_type_name}
                                        </p>
                                        <p className="text-xs font-mono text-gray-500">{ticket.qr_code?.slice(0, 8)}...</p>
                                    </div>
                                    <span className={clsx(
                                        'text-xs font-medium px-2 py-1 rounded',
                                        ticket.status === 'valid' && 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
                                        ticket.status === 'used' && 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
                                        ticket.status === 'cancelled' && 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                                    )}>
                                        {ticket.checked_in_at ? 'Gebruikt' : 'Geldig'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Chat */}
                {chat_thread && (
                    <section>
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                            Chat
                        </h3>
                        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 flex items-center justify-between">
                            <div>
                                <p className="text-sm text-gray-900 dark:text-white">
                                    {chat_thread.message_count} berichten
                                </p>
                                <p className="text-xs text-gray-500">
                                    Status: {chat_thread.status}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={(e) => handleOpenChat(e)}
                                className="px-3 py-1 text-sm bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 rounded hover:bg-indigo-200 dark:hover:bg-indigo-800 flex items-center gap-1"
                            >
                                <ExternalLink className="h-3 w-3" />
                                Bekijken
                            </button>
                        </div>
                    </section>
                )}

                {/* History */}
                {history && history.length > 0 && (
                    <section>
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                            Geschiedenis
                        </h3>
                        <div className="space-y-2">
                            {history.slice(0, 10).map((entry, i) => (
                                <div key={i} className="flex items-start gap-3 text-sm">
                                    <Clock className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                                    <div>
                                        <p className="text-gray-900 dark:text-white">
                                            {entry.action} {entry.resource_type}
                                        </p>
                                        <p className="text-xs text-gray-500">{formatDate(entry.created_at)}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </div>

            {/* Quick Actions Footer */}
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                <div className="grid grid-cols-2 gap-2">
                    <button
                        type="button"
                        onClick={(e) => handleOpenChat(e)}
                        className="flex items-center justify-center gap-2 px-3 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700"
                    >
                        <MessageSquare className="h-4 w-4" />
                        Stuur bericht
                    </button>
                    <button
                        className="flex items-center justify-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                        <Mail className="h-4 w-4" />
                        Resend ticket
                    </button>
                </div>
            </div>
        </div>
    )
}

export default ParticipantProfile
