/**
 * EventParticipants Page
 *
 * Deelnemers/Registraties tab voor event organisators.
 * Features:
 * - Gefilterde lijst met registraties (Atleta-style)
 * - Filters: ticket type, status, payment, assignment
 * - Search by email/name
 * - CSV export
 * - Pagination
 */

import { useEffect, useState, useCallback } from 'react'
import { useOutletContext, Link, useSearchParams } from 'react-router-dom'
import {
    Users,
    QrCode,
    CheckCircle,
    XCircle,
    Circle,
    Download,
    Search,
    Filter,
    ChevronLeft,
    ChevronRight,
    Loader2,
    FileSpreadsheet,
    CheckSquare,
    Square,
    X,
    Eye
} from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../lib/supabase'
import type { AppEvent, Organization } from '../types/supabase'
import { ParticipantProfile } from '../components/participants/ParticipantProfile'

// Context type from EventDetail
interface EventContext {
    event: AppEvent
    org: Organization
    refreshEvent: () => void
}

// Registration from view
interface RegistrationRow {
    id: string
    event_id: string
    participant_id: string
    registration_status: string
    ticket_type_id: string | null
    order_item_id: string | null
    bib_number: string | null
    created_at: string
    updated_at: string
    // Participant
    email: string
    first_name: string
    last_name: string
    phone: string | null
    // Ticket Type
    ticket_type_name: string | null
    ticket_type_price: number | null
    // Order
    order_id: string | null
    order_status: string | null
    payment_status: string
    has_discount: boolean
    // Ticket Instance
    ticket_instance_id: string | null
    qr_code: string | null
    ticket_status: string | null
    checked_in_at: string | null
    assignment_status: string
}

interface TicketType {
    id: string
    name: string
}

interface Filters {
    ticket_type_id?: string
    registration_status?: string
    payment_status?: string
    assignment_status?: string
    search?: string
}

interface ListResponse {
    total: number
    page: number
    page_size: number
    pages: number
    data: RegistrationRow[]
    error?: string
}

export function EventParticipants() {
    const { event, org } = useOutletContext<EventContext>()
    const [searchParams, setSearchParams] = useSearchParams()

    // Profile sidebar state
    const selectedProfileId = searchParams.get('profile')

    const openProfile = (participantId: string) => {
        setSearchParams({ profile: participantId })
    }

    const closeProfile = () => {
        setSearchParams({})
    }

    // Data state
    const [registrations, setRegistrations] = useState<RegistrationRow[]>([])
    const [ticketTypes, setTicketTypes] = useState<TicketType[]>([])
    const [total, setTotal] = useState(0)
    const [pages, setPages] = useState(0)

    // Selection state for bulk actions
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [bulkLoading, setBulkLoading] = useState(false)
    const [exportingExcel, setExportingExcel] = useState(false)

    // UI state
    const [loading, setLoading] = useState(true)
    const [exporting, setExporting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Filter state
    const [filters, setFilters] = useState<Filters>({})
    const [page, setPage] = useState(1)
    const [pageSize] = useState(50)
    const [searchInput, setSearchInput] = useState('')

    // Fetch ticket types for filter dropdown
    useEffect(() => {
        async function fetchTicketTypes() {
            if (!event) return
            const { data } = await supabase
                .from('ticket_types')
                .select('id, name')
                .eq('event_id', event.id)
                .is('deleted_at', null)
                .order('sort_order')
            setTicketTypes(data || [])
        }
        fetchTicketTypes()
    }, [event?.id])

    // Fetch registrations
    const fetchRegistrations = useCallback(async () => {
        if (!event) return

        setLoading(true)
        setError(null)

        console.log('[EventParticipants] Fetching with filters:', filters)

        const { data, error: fetchError } = await supabase.rpc('get_registrations_list', {
            _event_id: event.id,
            _filters: filters,
            _page: page,
            _page_size: pageSize,
            _sort_by: 'created_at',
            _sort_order: 'desc'
        })

        if (fetchError) {
            console.error('[EventParticipants] RPC Error:', fetchError)
            setError(fetchError.message)
            setLoading(false)
            return
        }

        const result = data as ListResponse

        if (result.error) {
            setError(result.error)
        } else {
            setRegistrations(result.data || [])
            setTotal(result.total || 0)
            setPages(result.pages || 0)
        }

        setLoading(false)
    }, [event?.id, filters, page, pageSize])

    useEffect(() => {
        fetchRegistrations()
    }, [fetchRegistrations])

    // Handle search with debounce
    useEffect(() => {
        const timer = setTimeout(() => {
            if (searchInput !== (filters.search || '')) {
                setFilters(prev => ({
                    ...prev,
                    search: searchInput || undefined
                }))
                setPage(1)
            }
        }, 300)
        return () => clearTimeout(timer)
    }, [searchInput])

    // Handle filter change
    const handleFilterChange = (key: keyof Filters, value: string | undefined) => {
        setFilters(prev => ({
            ...prev,
            [key]: value || undefined
        }))
        setPage(1)
    }

    // Export CSV
    const handleExport = async () => {
        if (!event) return

        setExporting(true)
        setError(null)

        try {
            const { data, error: exportError } = await supabase.rpc('export_registrations_csv', {
                _event_id: event.id,
                _filters: filters
            })

            if (exportError) throw exportError

            // Create CSV file and download
            const csvContent = (data as { csv_row: string }[])
                .map(row => row.csv_row)
                .join('\n')

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = `registrations-${event.slug}-${new Date().toISOString().split('T')[0]}.csv`
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
            URL.revokeObjectURL(url)
        } catch (err: any) {
            console.error('[EventParticipants] Export error:', err)
            setError(err.message || 'Export failed')
        }

        setExporting(false)
    }

    // Export Excel
    const handleExportExcel = async () => {
        if (!event) return

        setExportingExcel(true)
        setError(null)

        try {
            const { data, error: exportError } = await supabase.rpc('export_registrations_xlsx_data', {
                _event_id: event.id,
                _filters: filters
            })

            if (exportError) throw exportError
            if (data?.error) throw new Error(data.message || data.error)

            // Dynamic import of xlsx library
            const XLSX = await import('xlsx')

            // Create worksheet from data
            const ws = XLSX.utils.json_to_sheet(data.rows || [])

            // Create workbook
            const wb = XLSX.utils.book_new()
            XLSX.utils.book_append_sheet(wb, ws, 'Registraties')

            // Download
            XLSX.writeFile(wb, `registrations-${event.slug}-${new Date().toISOString().split('T')[0]}.xlsx`)
        } catch (err: any) {
            console.error('[EventParticipants] Excel export error:', err)
            setError(err.message || 'Excel export failed')
        }

        setExportingExcel(false)
    }

    // Bulk Check-in
    const handleBulkCheckIn = async () => {
        if (!event || selected.size === 0) return

        setBulkLoading(true)
        setError(null)

        try {
            // Get ticket_instance_ids for selected registrations
            const ticketIds = registrations
                .filter(r => selected.has(r.id) && r.ticket_instance_id)
                .map(r => r.ticket_instance_id!)

            if (ticketIds.length === 0) {
                setError('Geen tickets geselecteerd met een toegewezen ticket')
                setBulkLoading(false)
                return
            }

            const { data, error: bulkError } = await supabase.rpc('bulk_checkin_participants', {
                _event_id: event.id,
                _ticket_instance_ids: ticketIds
            })

            if (bulkError) throw bulkError
            if (data?.error) throw new Error(data.message || data.error)

            // Show result
            const successCount = data?.success_count || 0
            const failedCount = data?.failed_count || 0

            if (failedCount > 0) {
                setError(`${successCount} ingecheckt, ${failedCount} mislukt`)
            }

            // Clear selection and refresh
            setSelected(new Set())
            fetchRegistrations()
        } catch (err: any) {
            console.error('[EventParticipants] Bulk check-in error:', err)
            setError(err.message || 'Bulk check-in failed')
        }

        setBulkLoading(false)
    }

    // Toggle selection
    const toggleSelect = (id: string) => {
        const newSelected = new Set(selected)
        if (newSelected.has(id)) {
            newSelected.delete(id)
        } else {
            newSelected.add(id)
        }
        setSelected(newSelected)
    }

    // Select all on current page
    const toggleSelectAll = () => {
        if (selected.size === registrations.length) {
            setSelected(new Set())
        } else {
            setSelected(new Set(registrations.map(r => r.id)))
        }
    }

    // Stats
    const paidCount = registrations.filter(r => r.payment_status === 'paid').length
    const assignedCount = registrations.filter(r => r.assignment_status === 'assigned').length

    if (!event) {
        return <div className="p-4 text-gray-500">Event laden...</div>
    }

    return (
        <div>
            {/* Header */}
            <div className="mb-6 flex justify-between items-center">
                <div>
                    <h3 className="text-lg font-medium text-gray-900">Registraties</h3>
                    <p className="text-sm text-gray-500">
                        {total} registratie{total !== 1 ? 's' : ''} totaal
                    </p>
                </div>
                <div className="flex items-center space-x-3">
                    {/* Export Dropdown */}
                    <div className="relative inline-block">
                        <button
                            onClick={handleExport}
                            disabled={exporting || exportingExcel || total === 0}
                            className={clsx(
                                'inline-flex items-center px-4 py-2 border text-sm font-medium rounded-l-md',
                                'border-gray-300 text-gray-700 bg-white hover:bg-gray-50',
                                'disabled:opacity-50 disabled:cursor-not-allowed'
                            )}
                        >
                            {exporting ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Download className="mr-2 h-4 w-4" />
                            )}
                            CSV
                        </button>
                        <button
                            onClick={handleExportExcel}
                            disabled={exporting || exportingExcel || total === 0}
                            className={clsx(
                                'inline-flex items-center px-4 py-2 border-t border-b border-r text-sm font-medium rounded-r-md',
                                'border-gray-300 text-gray-700 bg-white hover:bg-gray-50',
                                'disabled:opacity-50 disabled:cursor-not-allowed'
                            )}
                        >
                            {exportingExcel ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <FileSpreadsheet className="mr-2 h-4 w-4" />
                            )}
                            Excel
                        </button>
                    </div>
                    <Link
                        to={`/scan/${event.slug}`}
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700"
                    >
                        <QrCode className="mr-2 h-4 w-4" />
                        Scan Tickets
                    </Link>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 mb-6">
                <StatCard
                    icon={<Users className="h-5 w-5 text-gray-400" />}
                    label="Totaal"
                    value={total}
                />
                <StatCard
                    icon={<CheckCircle className="h-5 w-5 text-green-400" />}
                    label="Betaald"
                    value={paidCount}
                />
                <StatCard
                    icon={<Circle className="h-5 w-5 text-blue-400" />}
                    label="Toegewezen"
                    value={assignedCount}
                />
                <StatCard
                    icon={<XCircle className="h-5 w-5 text-yellow-400" />}
                    label="Niet toegewezen"
                    value={total - assignedCount}
                />
            </div>

            {/* Filters */}
            <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <div className="flex items-center mb-3">
                    <Filter className="h-4 w-4 text-gray-500 mr-2" />
                    <span className="text-sm font-medium text-gray-700">Filters</span>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Zoek op email/naam..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            className="pl-9 w-full rounded-md border-gray-300 text-sm"
                        />
                    </div>

                    {/* Ticket Type Filter */}
                    <select
                        value={filters.ticket_type_id || ''}
                        onChange={(e) => handleFilterChange('ticket_type_id', e.target.value)}
                        className="rounded-md border-gray-300 text-sm"
                    >
                        <option value="">Alle tickets</option>
                        {ticketTypes.map(tt => (
                            <option key={tt.id} value={tt.id}>{tt.name}</option>
                        ))}
                    </select>

                    {/* Registration Status Filter */}
                    <select
                        value={filters.registration_status || ''}
                        onChange={(e) => handleFilterChange('registration_status', e.target.value)}
                        className="rounded-md border-gray-300 text-sm"
                    >
                        <option value="">Alle statussen</option>
                        <option value="confirmed">Bevestigd</option>
                        <option value="pending">In afwachting</option>
                        <option value="cancelled">Geannuleerd</option>
                        <option value="waitlist">Wachtlijst</option>
                    </select>

                    {/* Payment Status Filter */}
                    <select
                        value={filters.payment_status || ''}
                        onChange={(e) => handleFilterChange('payment_status', e.target.value)}
                        className="rounded-md border-gray-300 text-sm"
                    >
                        <option value="">Alle betalingen</option>
                        <option value="paid">Betaald</option>
                        <option value="unpaid">Niet betaald</option>
                        <option value="refunded">Terugbetaald</option>
                    </select>

                    {/* Assignment Status Filter */}
                    <select
                        value={filters.assignment_status || ''}
                        onChange={(e) => handleFilterChange('assignment_status', e.target.value)}
                        className="rounded-md border-gray-300 text-sm"
                    >
                        <option value="">Alle toewijzingen</option>
                        <option value="assigned">Toegewezen</option>
                        <option value="unassigned">Niet toegewezen</option>
                    </select>
                </div>

                {/* Active filters indicator */}
                {Object.values(filters).some(v => v) && (
                    <div className="mt-3 flex items-center">
                        <span className="text-xs text-gray-500 mr-2">
                            Filters actief
                        </span>
                        <button
                            onClick={() => {
                                setFilters({})
                                setSearchInput('')
                                setPage(1)
                            }}
                            className="text-xs text-indigo-600 hover:text-indigo-800"
                        >
                            Wis alle filters
                        </button>
                    </div>
                )}
            </div>

            {/* Error */}
            {error && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3">
                    <p className="text-sm text-red-800">{error}</p>
                    <button onClick={() => setError(null)} className="text-sm text-red-600 underline">
                        Sluiten
                    </button>
                </div>
            )}

            {/* Loading */}
            {loading ? (
                <div className="flex items-center justify-center h-32">
                    <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
                </div>
            ) : registrations.length === 0 ? (
                /* Empty State */
                <div className="text-center py-12 bg-gray-50 rounded-lg">
                    <Users className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">Geen registraties</h3>
                    <p className="mt-1 text-sm text-gray-500">
                        {Object.values(filters).some(v => v)
                            ? 'Geen registraties gevonden met deze filters.'
                            : 'Er zijn nog geen registraties voor dit event.'
                        }
                    </p>
                </div>
            ) : (
                <>
                    {/* Bulk Action Bar */}
                    {selected.size > 0 && (
                        <div className="mb-4 bg-indigo-50 border border-indigo-200 rounded-lg p-3 flex items-center justify-between">
                            <div className="flex items-center">
                                <CheckSquare className="h-5 w-5 text-indigo-600 mr-2" />
                                <span className="text-sm font-medium text-indigo-900">
                                    {selected.size} geselecteerd
                                </span>
                            </div>
                            <div className="flex items-center space-x-3">
                                <button
                                    onClick={handleBulkCheckIn}
                                    disabled={bulkLoading}
                                    className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
                                >
                                    {bulkLoading ? (
                                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                                    ) : (
                                        <CheckCircle className="mr-1 h-4 w-4" />
                                    )}
                                    Check-in
                                </button>
                                <button
                                    onClick={() => setSelected(new Set())}
                                    className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                                >
                                    <X className="mr-1 h-4 w-4" />
                                    Annuleren
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Table */}
                    <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 rounded-lg">
                        <table className="min-w-full divide-y divide-gray-300">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="py-3.5 pl-4 pr-2 text-left">
                                        <button
                                            onClick={toggleSelectAll}
                                            className="text-gray-400 hover:text-gray-600"
                                        >
                                            {selected.size === registrations.length && registrations.length > 0 ? (
                                                <CheckSquare className="h-5 w-5 text-indigo-600" />
                                            ) : (
                                                <Square className="h-5 w-5" />
                                            )}
                                        </button>
                                    </th>
                                    <th className="py-3.5 pl-2 pr-3 text-left text-sm font-semibold text-gray-900">
                                        Deelnemer
                                    </th>
                                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                                        Ticket
                                    </th>
                                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                                        Status
                                    </th>
                                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                                        Betaling
                                    </th>
                                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                                        Toewijzing
                                    </th>
                                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                                        Datum
                                    </th>
                                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                                        Acties
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 bg-white">
                                {registrations.map((reg) => (
                                    <tr key={reg.id} className={clsx(
                                        'hover:bg-gray-50',
                                        selected.has(reg.id) && 'bg-indigo-50'
                                    )}>
                                        <td className="whitespace-nowrap py-4 pl-4 pr-2">
                                            <button
                                                onClick={() => toggleSelect(reg.id)}
                                                className="text-gray-400 hover:text-gray-600"
                                            >
                                                {selected.has(reg.id) ? (
                                                    <CheckSquare className="h-5 w-5 text-indigo-600" />
                                                ) : (
                                                    <Square className="h-5 w-5" />
                                                )}
                                            </button>
                                        </td>
                                        <td className="whitespace-nowrap py-4 pl-2 pr-3 text-sm">
                                            <div className="font-medium text-gray-900">
                                                {reg.first_name} {reg.last_name}
                                            </div>
                                            <div className="text-gray-500">{reg.email}</div>
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">
                                            {reg.ticket_type_name || '–'}
                                            {reg.has_discount && (
                                                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                                    Korting
                                                </span>
                                            )}
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-4 text-sm">
                                            <StatusBadge status={reg.registration_status} />
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-4 text-sm">
                                            <PaymentBadge status={reg.payment_status} />
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-4 text-sm">
                                            <AssignmentBadge status={reg.assignment_status} />
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                                            {new Date(reg.created_at).toLocaleDateString('nl-NL', {
                                                day: 'numeric',
                                                month: 'short',
                                                year: 'numeric'
                                            })}
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-4 text-sm">
                                            <button
                                                onClick={() => openProfile(reg.participant_id)}
                                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-indigo-600 hover:text-indigo-900 hover:bg-indigo-50 rounded"
                                            >
                                                <Eye className="h-4 w-4" />
                                                Bekijk
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    {pages > 1 && (
                        <div className="flex items-center justify-between border-t border-gray-200 bg-white px-4 py-3 sm:px-6 mt-4 rounded-lg">
                            <div className="flex flex-1 justify-between sm:hidden">
                                <button
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page === 1}
                                    className="relative inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                >
                                    Vorige
                                </button>
                                <button
                                    onClick={() => setPage(p => Math.min(pages, p + 1))}
                                    disabled={page === pages}
                                    className="relative ml-3 inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                >
                                    Volgende
                                </button>
                            </div>
                            <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
                                <div>
                                    <p className="text-sm text-gray-700">
                                        Toont <span className="font-medium">{(page - 1) * pageSize + 1}</span> tot{' '}
                                        <span className="font-medium">{Math.min(page * pageSize, total)}</span> van{' '}
                                        <span className="font-medium">{total}</span> resultaten
                                    </p>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <button
                                        onClick={() => setPage(p => Math.max(1, p - 1))}
                                        disabled={page === 1}
                                        className="relative inline-flex items-center rounded-md border border-gray-300 bg-white p-2 text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                                    >
                                        <ChevronLeft className="h-5 w-5" />
                                    </button>
                                    <span className="text-sm text-gray-700">
                                        Pagina {page} van {pages}
                                    </span>
                                    <button
                                        onClick={() => setPage(p => Math.min(pages, p + 1))}
                                        disabled={page === pages}
                                        className="relative inline-flex items-center rounded-md border border-gray-300 bg-white p-2 text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                                    >
                                        <ChevronRight className="h-5 w-5" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* Participant Profile Sidebar */}
            {selectedProfileId && event && org && (
                <ParticipantProfile
                    participantId={selectedProfileId}
                    eventId={event.id}
                    eventSlug={event.slug}
                    orgSlug={org.slug}
                    onClose={closeProfile}
                    onUpdate={fetchRegistrations}
                />
            )}
        </div>
    )
}

// Stat Card Component
function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
    return (
        <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-4">
                <div className="flex items-center">
                    <div className="flex-shrink-0">{icon}</div>
                    <div className="ml-4">
                        <p className="text-sm font-medium text-gray-500">{label}</p>
                        <p className="text-xl font-semibold text-gray-900">{value}</p>
                    </div>
                </div>
            </div>
        </div>
    )
}

// Status Badge
function StatusBadge({ status }: { status: string }) {
    const config: Record<string, { bg: string; text: string; label: string }> = {
        confirmed: { bg: 'bg-green-100', text: 'text-green-800', label: 'Bevestigd' },
        pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'In afwachting' },
        cancelled: { bg: 'bg-red-100', text: 'text-red-800', label: 'Geannuleerd' },
        waitlist: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Wachtlijst' },
    }
    const { bg, text, label } = config[status] || config.pending
    return (
        <span className={clsx('inline-flex px-2 py-0.5 rounded-full text-xs font-medium', bg, text)}>
            {label}
        </span>
    )
}

// Payment Badge
function PaymentBadge({ status }: { status: string }) {
    const config: Record<string, { bg: string; text: string; label: string }> = {
        paid: { bg: 'bg-green-100', text: 'text-green-800', label: 'Betaald' },
        unpaid: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Niet betaald' },
        refunded: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Terugbetaald' },
        cancelled: { bg: 'bg-red-100', text: 'text-red-800', label: 'Geannuleerd' },
    }
    const { bg, text, label } = config[status] || config.unpaid
    return (
        <span className={clsx('inline-flex px-2 py-0.5 rounded-full text-xs font-medium', bg, text)}>
            {label}
        </span>
    )
}

// Assignment Badge
function AssignmentBadge({ status }: { status: string }) {
    const config: Record<string, { bg: string; text: string; label: string }> = {
        assigned: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Toegewezen' },
        unassigned: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Niet toegewezen' },
    }
    const { bg, text, label } = config[status] || config.unassigned
    return (
        <span className={clsx('inline-flex px-2 py-0.5 rounded-full text-xs font-medium', bg, text)}>
            {label}
        </span>
    )
}
