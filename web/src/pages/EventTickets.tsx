/**
 * EventTickets Page
 * 
 * Tickets tab binnen event detail.
 * Features:
 * - Lijst met ticket types (naam, prijs, capaciteit, status)
 * - Empty state met CTA "Ticket toevoegen"
 * - Modal voor ticket create/edit
 * - Status toggle en delete
 */

import { useEffect, useState, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Plus, Ticket, Loader2, Trash2, CheckCircle, XCircle, Edit2 } from 'lucide-react'
import { clsx } from 'clsx'
import {
    listTickets,
    createTicket,
    updateTicket,
    setTicketStatus,
    softDeleteTicket,
    formatPrice,
    type CreateTicketPayload,
    type UpdateTicketPayload,
    type TicketStatus
} from '../data/tickets'
import type { TicketType, AppEvent, Organization } from '../types/supabase'

// Context type van EventDetail
interface EventContext {
    event: AppEvent
    org: Organization
    refreshEvent: () => void
}

export function EventTickets() {
    const { event } = useOutletContext<EventContext>()

    const [tickets, setTickets] = useState<TicketType[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Modal state
    const [showModal, setShowModal] = useState(false)
    const [editingTicket, setEditingTicket] = useState<TicketType | null>(null)
    const [actionLoading, setActionLoading] = useState<string | null>(null) // ticketId or 'create'

    // Fetch tickets
    const fetchTickets = useCallback(async () => {
        if (!event) return

        console.log('[EventTickets] Fetching tickets for event:', event.id)

        const { data, error: fetchError } = await listTickets(event.id)

        if (fetchError) {
            console.error('[EventTickets] Error:', fetchError)
            setError(fetchError.message)
        } else {
            console.log('[EventTickets] Loaded tickets:', data?.length)
            setTickets(data || [])
        }

        setLoading(false)
    }, [event?.id])

    useEffect(() => {
        fetchTickets()
    }, [fetchTickets])

    // Open create modal
    const handleCreate = () => {
        setEditingTicket(null)
        setShowModal(true)
    }

    // Open edit modal
    const handleEdit = (ticket: TicketType) => {
        setEditingTicket(ticket)
        setShowModal(true)
    }

    // Toggle status
    const handleToggleStatus = async (ticket: TicketType) => {
        const newStatus: TicketStatus = ticket.status === 'published' ? 'draft' : 'published'

        setActionLoading(ticket.id)

        const { data, error: updateError } = await setTicketStatus(ticket.id, newStatus)

        if (updateError) {
            setError(updateError.message)
        } else if (data) {
            setTickets(prev => prev.map(t => t.id === ticket.id ? data : t))
        }

        setActionLoading(null)
    }

    // Delete ticket
    const handleDelete = async (ticket: TicketType) => {
        if (!confirm(`Weet je zeker dat je "${ticket.name}" wilt verwijderen?`)) return

        setActionLoading(ticket.id)

        const { success, error: deleteError } = await softDeleteTicket(ticket.id)

        if (deleteError) {
            setError(deleteError.message)
        } else if (success) {
            setTickets(prev => prev.filter(t => t.id !== ticket.id))
        }

        setActionLoading(null)
    }

    // Handle form submit
    const handleFormSubmit = async (payload: CreateTicketPayload | UpdateTicketPayload) => {
        setActionLoading('create')

        if (editingTicket) {
            // Update existing
            const { data, error: updateError } = await updateTicket(editingTicket.id, payload as UpdateTicketPayload)

            if (updateError) {
                setError(updateError.message)
            } else if (data) {
                setTickets(prev => prev.map(t => t.id === editingTicket.id ? data : t))
                setShowModal(false)
            }
        } else {
            // Create new
            const { data, error: createError } = await createTicket(event.id, payload as CreateTicketPayload)

            if (createError) {
                setError(createError.message)
            } else if (data) {
                setTickets(prev => [...prev, data])
                setShowModal(false)
            }
        }

        setActionLoading(null)
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
            </div>
        )
    }

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h3 className="text-lg font-medium text-gray-900">Tickets</h3>
                    <p className="text-sm text-gray-500">Beheer de tickettypes voor dit evenement.</p>
                </div>
                <button
                    onClick={handleCreate}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700"
                >
                    <Plus className="mr-2 h-4 w-4" />
                    Ticket toevoegen
                </button>
            </div>

            {/* Error */}
            {error && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3">
                    <p className="text-sm text-red-800">{error}</p>
                    <button onClick={() => setError(null)} className="text-sm text-red-600 underline">Sluiten</button>
                </div>
            )}

            {/* Ticket List */}
            {tickets.length === 0 ? (
                // Empty State
                <div className="text-center py-12 bg-gray-50 rounded-lg">
                    <Ticket className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">Geen tickets</h3>
                    <p className="mt-1 text-sm text-gray-500">Begin met het aanmaken van een tickettype.</p>
                    <div className="mt-6">
                        <button
                            onClick={handleCreate}
                            className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
                        >
                            <Plus className="-ml-1 mr-2 h-5 w-5" />
                            Ticket toevoegen
                        </button>
                    </div>
                </div>
            ) : (
                // Ticket Table
                <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 rounded-lg">
                    <table className="min-w-full divide-y divide-gray-300">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900">Naam</th>
                                <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Prijs</th>
                                <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Capaciteit</th>
                                <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Verkocht</th>
                                <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Status</th>
                                <th className="relative py-3.5 pl-3 pr-4"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                            {tickets.map((ticket) => (
                                <TicketRow
                                    key={ticket.id}
                                    ticket={ticket}
                                    onEdit={handleEdit}
                                    onToggleStatus={handleToggleStatus}
                                    onDelete={handleDelete}
                                    actionLoading={actionLoading}
                                />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Create/Edit Modal */}
            {showModal && (
                <TicketModal
                    ticket={editingTicket}
                    loading={actionLoading === 'create'}
                    onSubmit={handleFormSubmit}
                    onClose={() => setShowModal(false)}
                />
            )}
        </div>
    )
}

/**
 * TicketRow Component with Issued Count
 * Fetches and displays how many tickets have been issued for this ticket type
 */
interface TicketRowProps {
    ticket: TicketType
    onEdit: (ticket: TicketType) => void
    onToggleStatus: (ticket: TicketType) => void
    onDelete: (ticket: TicketType) => void
    actionLoading: string | null
}

function TicketRow({ ticket, onEdit, onToggleStatus, onDelete, actionLoading }: TicketRowProps) {
    // Cast ticket to any to access 'sold' property from view
    const soldCount = (ticket as any).sold ?? 0

    return (
        <tr className="hover:bg-gray-50">
            <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm">
                <div className="font-medium text-gray-900">{ticket.name}</div>
                {ticket.description && (
                    <div className="text-gray-500 truncate max-w-xs">{ticket.description}</div>
                )}
            </td>
            <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">
                {ticket.price === 0 ? (
                    <span className="text-green-600 font-medium">Gratis</span>
                ) : (
                    formatPrice(ticket.price, ticket.currency)
                )}
            </td>
            <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                {ticket.capacity_total === 0 ? (
                    <span className="text-gray-400">Onbeperkt</span>
                ) : (
                    ticket.capacity_total
                )}
            </td>
            <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                <span className={clsx('font-medium', soldCount > 0 ? 'text-gray-900' : 'text-gray-400')}>
                    {soldCount}
                </span>
            </td>
            <td className="whitespace-nowrap px-3 py-4 text-sm">
                <StatusBadge status={ticket.status} />
            </td>
            <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium">
                <div className="flex items-center justify-end space-x-2">
                    {/* Toggle Status */}
                    <button
                        onClick={() => onToggleStatus(ticket)}
                        disabled={actionLoading === ticket.id}
                        className={clsx(
                            'p-1 rounded',
                            ticket.status === 'published'
                                ? 'text-yellow-600 hover:bg-yellow-50'
                                : 'text-green-600 hover:bg-green-50',
                            'disabled:opacity-50'
                        )}
                        title={ticket.status === 'published' ? 'Zet naar concept' : 'Publiceer'}
                    >
                        {actionLoading === ticket.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : ticket.status === 'published' ? (
                            <XCircle className="h-4 w-4" />
                        ) : (
                            <CheckCircle className="h-4 w-4" />
                        )}
                    </button>

                    {/* Edit */}
                    <button
                        onClick={() => onEdit(ticket)}
                        className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50"
                        title="Bewerken"
                    >
                        <Edit2 className="h-4 w-4" />
                    </button>

                    {/* Delete */}
                    <button
                        onClick={() => onDelete(ticket)}
                        disabled={actionLoading === ticket.id}
                        className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                        title="Verwijderen"
                    >
                        <Trash2 className="h-4 w-4" />
                    </button>
                </div>
            </td>
        </tr>
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
        <span className={clsx('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', bg, text)}>
            {label}
        </span>
    )
}

/**
 * Ticket Create/Edit Modal
 */
interface TicketModalProps {
    ticket: TicketType | null
    loading: boolean
    onSubmit: (payload: CreateTicketPayload | UpdateTicketPayload) => void
    onClose: () => void
}

function TicketModal({ ticket, loading, onSubmit, onClose }: TicketModalProps) {
    const isEdit = !!ticket

    const [name, setName] = useState(ticket?.name || '')
    const [description, setDescription] = useState(ticket?.description || '')
    const [price, setPrice] = useState(ticket?.price?.toString() || '0')
    const [capacity, setCapacity] = useState(ticket?.capacity_total?.toString() || '0')
    const [salesStart, setSalesStart] = useState(
        ticket?.sales_start ? ticket.sales_start.slice(0, 16) : ''
    )
    const [salesEnd, setSalesEnd] = useState(
        ticket?.sales_end ? ticket.sales_end.slice(0, 16) : ''
    )
    const [formError, setFormError] = useState<string | null>(null)

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        setFormError(null)

        // Validation
        if (!name.trim()) {
            setFormError('Naam is verplicht')
            return
        }

        const priceNum = parseFloat(price)
        if (isNaN(priceNum) || priceNum < 0) {
            setFormError('Prijs moet 0 of hoger zijn')
            return
        }

        const capacityNum = parseInt(capacity, 10)
        if (isNaN(capacityNum) || capacityNum < 0) {
            setFormError('Capaciteit moet 0 (onbeperkt) of hoger zijn')
            return
        }

        // Validate sales window
        if (salesStart && salesEnd) {
            if (new Date(salesEnd) < new Date(salesStart)) {
                setFormError('Einddatum verkoop moet na startdatum zijn')
                return
            }
        }

        onSubmit({
            name: name.trim(),
            description: description.trim() || null,
            price: priceNum,
            capacity_total: capacityNum,
            sales_start: salesStart ? new Date(salesStart).toISOString() : null,
            sales_end: salesEnd ? new Date(salesEnd).toISOString() : null,
        })
    }

    return (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
                <form onSubmit={handleSubmit}>
                    <div className="px-6 py-4 border-b border-gray-200">
                        <h3 className="text-lg font-medium text-gray-900">
                            {isEdit ? 'Ticket bewerken' : 'Nieuw ticket'}
                        </h3>
                    </div>

                    <div className="px-6 py-4 space-y-4">
                        {/* Naam */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700">
                                Naam <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Bijv. Early Bird, VIP, Standaard"
                                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                required
                            />
                        </div>

                        {/* Beschrijving */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Beschrijving</label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={2}
                                placeholder="Optionele beschrijving..."
                                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            />
                        </div>

                        {/* Prijs */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Prijs (EUR)</label>
                            <div className="mt-1 relative rounded-md shadow-sm">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <span className="text-gray-500 sm:text-sm">€</span>
                                </div>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={price}
                                    onChange={(e) => setPrice(e.target.value)}
                                    className="block w-full pl-7 border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                />
                            </div>
                            <p className="mt-1 text-xs text-gray-500">Gebruik 0 voor gratis tickets</p>
                        </div>

                        {/* Capaciteit */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Capaciteit</label>
                            <input
                                type="number"
                                min="0"
                                value={capacity}
                                onChange={(e) => setCapacity(e.target.value)}
                                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            />
                            <p className="mt-1 text-xs text-gray-500">Gebruik 0 voor onbeperkt</p>
                        </div>

                        {/* Sales Window */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Verkoop start</label>
                                <input
                                    type="datetime-local"
                                    value={salesStart}
                                    onChange={(e) => setSalesStart(e.target.value)}
                                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Verkoop einde</label>
                                <input
                                    type="datetime-local"
                                    value={salesEnd}
                                    onChange={(e) => setSalesEnd(e.target.value)}
                                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                />
                            </div>
                        </div>

                        {/* Error */}
                        {formError && (
                            <div className="bg-red-50 border border-red-200 rounded-md p-3">
                                <p className="text-sm text-red-800">{formError}</p>
                            </div>
                        )}
                    </div>

                    <div className="px-6 py-4 bg-gray-50 flex justify-end space-x-3 rounded-b-lg">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                        >
                            Annuleren
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4" />
                                    Opslaan...
                                </>
                            ) : (
                                isEdit ? 'Opslaan' : 'Toevoegen'
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
