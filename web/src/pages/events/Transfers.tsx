import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { StatusBadge } from '../../components/StatusBadge'
import { DataTable } from '../../components/DataTable'

interface Transfer {
    id: string
    status: string
    created_at: string
    accepted_at: string | null
    cancelled_at?: string | null
    rejected_at?: string | null
    to_email: string | null
    ticket_instances: {
        qr_code: string
        ticket_types: {
            name: string
        } | null
    } | null
    from_participant: {
        email: string
        first_name: string
        last_name: string
    } | null
    to_participant: {
        email: string
        first_name: string
        last_name: string
    } | null
}

export default function Transfers() {
    const { eventId } = useParams<{ eventId: string }>()
    const [transfers, setTransfers] = useState<Transfer[]>([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState<'all' | 'pending' | 'accepted' | 'cancelled' | 'rejected'>('all')
    const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null)
    const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null)
    const [role, setRole] = useState<string | null>(null)
    const [actionLoading, setActionLoading] = useState(false)

    useEffect(() => {
        if (eventId) {
            checkRole()
            fetchTransfers()
        }
    }, [eventId, filter])

    const checkRole = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user || !eventId) return

        setCurrentUserEmail(user.email || null)

        const { data: event } = await supabase
            .from('events')
            .select('org_id')
            .eq('id', eventId)
            .single()

        if (event) {
            const { data: member } = await supabase
                .from('org_members')
                .select('role')
                .eq('org_id', event.org_id)
                .eq('user_id', user.id)
                .single()

            setRole(member?.role || null)
        }
    }

    const fetchTransfers = async (background = false) => {
        if (!eventId) return
        if (!background) setLoading(true)

        let query = supabase
            .from('ticket_transfers')
            .select(`
        id,
        status,
        created_at,
        accepted_at,
        cancelled_at,
        rejected_at,
        to_email,
        ticket_instances (
          qr_code,
          ticket_types (
            name
          )
        ),
        from_participant:from_participant_id (
          email,
          first_name,
          last_name
        ),
        to_participant:to_participant_id (
          email,
          first_name,
          last_name
        )
      `)
            .eq('event_id', eventId)
            .order('created_at', { ascending: false })

        if (filter !== 'all') {
            query = query.eq('status', filter)
        }

        const { data, error } = await query

        if (error) {
            console.error('Error fetching transfers:', error)
        } else {
            setTransfers(data as any)
        }
        if (!background) setLoading(false)
    }

    const handleCancel = async (transferId: string) => {
        // TEMPORARY DEBUG: Skip confirm
        // if (!confirm('Are you sure you want to cancel this transfer?')) return
        console.log('[Transfers] handleCancel START for:', transferId)

        setActionLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) {
                alert('Please log in to cancel transfers.')
                return
            }

            // Log before cancel
            const beforeTransfer = transfers.find(t => t.id === transferId)
            console.log('[Transfers] Before cancel:', {
                transferId,
                eventId,
                userEmail: user.email,
                role,
                currentStatus: beforeTransfer?.status
            })

            const { data, error } = await supabase.rpc('cancel_ticket_transfer', {
                _transfer_id: transferId
            })

            if (error) {
                console.error('[Transfers] RPC Error:', error)
                throw new Error(error.message || 'RPC failed')
            }

            console.log('[Transfers] RPC Result:', data)

            // Require explicit confirmation that row was updated
            if (!data.success || data.updated !== 1) {
                throw new Error(data.message || `Cancel failed: updated=${data.updated}`)
            }

            // Success UI
            alert('Transfer cancelled successfully')

            const cancelledAt = new Date().toISOString()

            // 1. Optimistic update with deduplication
            setTransfers(prev => {
                const updated = prev.map(t =>
                    t.id === transferId
                        ? { ...t, status: 'cancelled', cancelled_at: cancelledAt }
                        : t
                )
                // Deduplicate by id (safety)
                const dedup = Array.from(new Map(updated.map(t => [t.id, t])).values())
                // If filtering by 'pending', remove the cancelled item from view
                const result = filter === 'pending' ? dedup.filter(t => t.id !== transferId) : dedup
                console.log('[Transfers] After optimistic update:', {
                    transferId,
                    newStatus: result.find(t => t.id === transferId)?.status ?? '(removed from view)'
                })
                return result
            })

            // 2. Update modal state if open
            if (selectedTransfer?.id === transferId) {
                setSelectedTransfer({ ...selectedTransfer, status: 'cancelled', cancelled_at: cancelledAt })
            }

            // 3. Background revalidation from DB (await to ensure it completes)
            await fetchTransfers(true)

            // 4. Log after refetch
            console.log('[Transfers] After refetch - transfers state updated from DB')

        } catch (err: any) {
            console.error('[Transfers] Exception:', err)
            alert('Error cancelling transfer: ' + (err.message || 'Unknown error'))
        } finally {
            setActionLoading(false)
        }
    }

    const handleAccept = async (transferId: string) => {
        console.log('[Transfers] handleAccept START for:', transferId)

        setActionLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) {
                alert('Please log in to accept transfers.')
                setActionLoading(false)
                return
            }

            console.log('[Transfers] Calling accept RPC...')
            const { data, error } = await supabase.rpc('accept_ticket_transfer', {
                _transfer_id: transferId
            })

            console.log('[Transfers] Accept RPC result:', { error, data })

            if (error) {
                console.error('[Transfers] Accept RPC Error:', error)
                throw new Error(error.message || 'Accept RPC failed')
            }

            if (!data.success) {
                throw new Error(data.message || `Accept failed: updated=${data.updated}`)
            }

            alert('Transfer accepted successfully!')

            const acceptedAt = new Date().toISOString()

            // Optimistic update
            setTransfers(prev => {
                const updated = prev.map(t =>
                    t.id === transferId
                        ? { ...t, status: 'accepted', accepted_at: acceptedAt }
                        : t
                )
                const dedup = Array.from(new Map(updated.map(t => [t.id, t])).values())
                const result = filter === 'pending' ? dedup.filter(t => t.id !== transferId) : dedup
                return result
            })

            if (selectedTransfer?.id === transferId) {
                setSelectedTransfer({ ...selectedTransfer, status: 'accepted', accepted_at: acceptedAt })
            }

            await fetchTransfers(true)
            console.log('[Transfers] After accept refetch complete')

        } catch (err: any) {
            console.error('[Transfers] Accept exception:', err)
            alert('Error accepting transfer: ' + (err.message || 'Unknown error'))
        } finally {
            setActionLoading(false)
        }
    }

    const handleReject = async (transferId: string) => {
        console.log('[Transfers] handleReject START for:', transferId)

        setActionLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) {
                alert('Please log in to reject transfers.')
                setActionLoading(false)
                return
            }

            console.log('[Transfers] Calling reject RPC...')
            const { data, error } = await supabase.rpc('reject_ticket_transfer', {
                _transfer_id: transferId
            })

            console.log('[Transfers] Reject RPC result:', { error, data })

            if (error) {
                console.error('[Transfers] Reject RPC Error:', error)
                throw new Error(error.message || 'Reject RPC failed')
            }

            if (!data.success) {
                throw new Error(data.message || `Reject failed: updated=${data.updated}`)
            }

            alert('Transfer rejected')

            const rejectedAt = new Date().toISOString()

            // Optimistic update
            setTransfers(prev => {
                const updated = prev.map(t =>
                    t.id === transferId
                        ? { ...t, status: 'rejected', rejected_at: rejectedAt }
                        : t
                )
                const dedup = Array.from(new Map(updated.map(t => [t.id, t])).values())
                const result = filter === 'pending' ? dedup.filter(t => t.id !== transferId) : dedup
                return result
            })

            if (selectedTransfer?.id === transferId) {
                setSelectedTransfer({ ...selectedTransfer, status: 'rejected', rejected_at: rejectedAt })
            }

            await fetchTransfers(true)
            console.log('[Transfers] After reject refetch complete')

        } catch (err: any) {
            console.error('[Transfers] Reject exception:', err)
            alert('Error rejecting transfer: ' + (err.message || 'Unknown error'))
        } finally {
            setActionLoading(false)
        }
    }

    const canCancel = (status: string) => {
        return status === 'pending' && role && ['owner', 'admin', 'support'].includes(role)
    }

    const canAcceptOrReject = (transfer: Transfer) => {
        if (transfer.status !== 'pending') return false
        // User is the recipient OR is an org admin/support
        return (
            currentUserEmail === transfer.to_email ||
            (transfer.to_participant?.email === currentUserEmail) ||
            (role && ['owner', 'admin', 'support'].includes(role))
        )
    }

    const columns = [
        {
            header: 'Ticket',
            accessor: (t: Transfer) => (
                <div>
                    <div className="font-medium text-gray-900">
                        {t.ticket_instances?.ticket_types?.name || 'Unknown Type'}
                    </div>
                    <div className="text-xs text-gray-500 font-mono">
                        {t.ticket_instances?.qr_code?.substring(0, 8)}...
                    </div>
                </div>
            )
        },
        {
            header: 'From',
            accessor: (t: Transfer) => (
                <div>
                    <div className="text-sm text-gray-900">
                        {t.from_participant?.first_name} {t.from_participant?.last_name}
                    </div>
                    <div className="text-xs text-gray-500">{t.from_participant?.email}</div>
                </div>
            )
        },
        {
            header: 'To',
            accessor: (t: Transfer) => {
                const email = t.to_participant?.email || t.to_email
                const name = t.to_participant ? `${t.to_participant.first_name} ${t.to_participant.last_name}` : 'Pending...'
                return (
                    <div>
                        <div className="text-sm text-gray-900">{name}</div>
                        <div className="text-xs text-gray-500">{email}</div>
                    </div>
                )
            }
        },
        {
            header: 'Status',
            accessor: (t: Transfer) => <StatusBadge status={t.status} />
        },
        {
            header: 'Created',
            accessor: (t: Transfer) => new Date(t.created_at).toLocaleDateString()
        },
        {
            header: 'Actions',
            accessor: (t: Transfer) => {
                // Show nothing if not pending
                if (t.status !== 'pending') return null

                // If user can accept/reject (recipient or org admin)
                if (canAcceptOrReject(t)) {
                    return (
                        <div className="flex gap-2">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation()
                                    handleAccept(t.id)
                                }}
                                disabled={actionLoading}
                                className={`text-xs font-medium ${actionLoading
                                    ? 'text-gray-400 cursor-not-allowed'
                                    : 'text-green-600 hover:text-green-800 cursor-pointer'
                                    }`}
                            >
                                {actionLoading ? '...' : 'Accept'}
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation()
                                    handleReject(t.id)
                                }}
                                disabled={actionLoading}
                                className={`text-xs font-medium ${actionLoading
                                    ? 'text-gray-400 cursor-not-allowed'
                                    : 'text-orange-600 hover:text-orange-800 cursor-pointer'
                                    }`}
                            >
                                {actionLoading ? '...' : 'Reject'}
                            </button>
                        </div>
                    )
                }

                // If user can cancel (org admin/support)
                if (canCancel(t.status)) {
                    return (
                        <button
                            onClick={(e) => {
                                e.stopPropagation()
                                handleCancel(t.id)
                            }}
                            disabled={actionLoading}
                            className={`text-xs font-medium ${actionLoading
                                ? 'text-gray-400 cursor-not-allowed'
                                : 'text-red-600 hover:text-red-800 cursor-pointer'
                                }`}
                        >
                            {actionLoading ? 'Cancelling...' : 'Cancel'}
                        </button>
                    )
                }

                return null
            }
        }
    ]

    return (
        <div className="max-w-6xl mx-auto p-6">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold text-gray-900">Ticket Transfers</h1>

                {/* Filters */}
                <div className="flex space-x-2 bg-white p-1 rounded-lg border border-gray-200">
                    {(['all', 'pending', 'accepted', 'rejected', 'cancelled'] as const).map((f) => (
                        <button
                            key={f}
                            onClick={() => setFilter(f as any)}
                            className={`px-4 py-2 text-sm font-medium rounded-md capitalize transition-colors ${filter === f
                                ? 'bg-blue-100 text-blue-700'
                                : 'text-gray-600 hover:bg-gray-50'
                                }`}
                        >
                            {f}
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="text-center py-12">Loading transfers...</div>
            ) : (
                <DataTable
                    data={transfers}
                    columns={columns}
                    keyExtractor={(t) => t.id}
                    onRowClick={(t) => setSelectedTransfer(t)}
                />
            )}

            {/* Detail Modal */}
            {selectedTransfer && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg max-w-lg w-full p-6 shadow-xl">
                        <div className="flex justify-between items-start mb-4">
                            <h2 className="text-xl font-bold">Transfer Details</h2>
                            <button
                                onClick={() => setSelectedTransfer(null)}
                                className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                            >
                                &times;
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-gray-500 uppercase">Status</label>
                                <StatusBadge status={selectedTransfer.status} className="mt-1" />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 uppercase">From</label>
                                    <div className="mt-1 font-medium">{selectedTransfer.from_participant?.email}</div>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 uppercase">To</label>
                                    <div className="mt-1 font-medium">
                                        {selectedTransfer.to_participant?.email || selectedTransfer.to_email}
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-500 uppercase">Ticket</label>
                                <div className="mt-1 border p-3 rounded bg-gray-50">
                                    <div className="font-medium">{selectedTransfer.ticket_instances?.ticket_types?.name}</div>
                                    <div className="text-xs font-mono text-gray-500 mt-1">
                                        QR: {selectedTransfer.ticket_instances?.qr_code}
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <span className="text-gray-500">Created:</span>{' '}
                                    {new Date(selectedTransfer.created_at).toLocaleString()}
                                </div>
                                {selectedTransfer.accepted_at && (
                                    <div>
                                        <span className="text-gray-500">Accepted:</span>{' '}
                                        {new Date(selectedTransfer.accepted_at).toLocaleString()}
                                    </div>
                                )}
                                {selectedTransfer.cancelled_at && (
                                    <div>
                                        <span className="text-gray-500">Cancelled:</span>{' '}
                                        {new Date(selectedTransfer.cancelled_at).toLocaleString()}
                                    </div>
                                )}
                                {selectedTransfer.rejected_at && (
                                    <div>
                                        <span className="text-gray-500">Rejected:</span>{' '}
                                        {new Date(selectedTransfer.rejected_at).toLocaleString()}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="mt-6 flex justify-between items-center">
                            {canCancel(selectedTransfer.status) ? (
                                <button
                                    onClick={() => handleCancel(selectedTransfer.id)}
                                    disabled={actionLoading}
                                    className="px-4 py-2 bg-red-50 text-red-700 rounded hover:bg-red-100 border border-red-200"
                                >
                                    {actionLoading ? 'Cancelling...' : 'Cancel Transfer'}
                                </button>
                            ) : <div></div>}

                            <button
                                onClick={() => setSelectedTransfer(null)}
                                className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
