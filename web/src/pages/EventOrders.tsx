/**
 * EventOrders Page
 * 
 * Bestellingen tab voor event organisators.
 * Features:
 * - Lijst met alle orders voor dit event
 * - Status badges (pending/paid/failed/cancelled/refunded)
 * - Totaalbedrag en datum
 * - Test knop: "Simuleer gratis bestelling" voor org members
 */

import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { ShoppingCart, Plus, Loader2, CheckCircle, XCircle, Clock } from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../lib/supabase'
import type { AppEvent, Organization } from '../types/supabase'

// Context type van EventDetail
interface EventContext {
    event: AppEvent
    org: Organization
    refreshEvent: () => void
}

interface Order {
    id: string
    event_id: string
    user_id: string | null
    email: string
    status: string
    total_amount: number
    currency: string
    created_at: string
    updated_at: string
}

export function EventOrders() {
    const { event } = useOutletContext<EventContext>()

    const [orders, setOrders] = useState<Order[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [simulating, setSimulating] = useState(false)
    const [fixingFreeOrders, setFixingFreeOrders] = useState(false)

    // Fetch orders
    useEffect(() => {
        async function fetchOrders() {
            if (!event) return

            console.log('[EventOrders] Fetching orders for event:', event.id)

            const { data, error: fetchError } = await supabase
                .from('orders')
                .select('*')
                .eq('event_id', event.id)
                .order('created_at', { ascending: false })

            if (fetchError) {
                console.error('[EventOrders] Error:', fetchError)
                setError(fetchError.message)
            } else {
                console.log('[EventOrders] Loaded orders:', data?.length)
                setOrders(data || [])
            }

            setLoading(false)
        }

        fetchOrders()
    }, [event?.id])

    // Simulate free order (test functie)
    const handleSimulateFreeOrder = async () => {
        if (!event) return

        setSimulating(true)
        setError(null)

        try {
            // Fetch first published ticket
            const { data: tickets } = await supabase
                .from('ticket_types')
                .select('id, name, price')
                .eq('event_id', event.id)
                .eq('status', 'published')
                .is('deleted_at', null)
                .limit(1)
                .single()

            if (!tickets) {
                setError('Geen gepubliceerde tickets gevonden')
                setSimulating(false)
                return
            }

            // Get current user
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) {
                setError('Niet ingelogd')
                setSimulating(false)
                return
            }

            // Call create-order Edge Function
            const { data, error: createError } = await supabase.functions.invoke('create-order', {
                body: {
                    event_id: event.id,
                    email: user.email,
                    items: [
                        {
                            ticket_type_id: tickets.id,
                            quantity: 1,
                        }
                    ]
                }
            })

            if (createError) {
                console.error('[EventOrders] Create order error:', createError)
                setError(createError.message)
            } else {
                console.log('[EventOrders] Order created:', data)
                // Refresh orders list
                const { data: refreshedOrders } = await supabase
                    .from('orders')
                    .select('*')
                    .eq('event_id', event.id)
                    .order('created_at', { ascending: false })
                setOrders(refreshedOrders || [])
            }
        } catch (err: any) {
            console.error('[EventOrders] Error:', err)
            setError(err.message)
        }

        setSimulating(false)
    }

    // Fix all free orders that are stuck on pending
    const handleFixFreeOrders = async () => {
        if (!event) return

        setFixingFreeOrders(true)
        setError(null)

        try {
            // Update all free pending orders to paid
            const { error: updateError, count } = await supabase
                .from('orders')
                .update({ status: 'paid', updated_at: new Date().toISOString() })
                .eq('event_id', event.id)
                .eq('status', 'pending')
                .eq('total_amount', 0)

            if (updateError) {
                console.error('[EventOrders] Fix free orders error:', updateError)
                setError(updateError.message)
            } else {
                console.log('[EventOrders] Fixed free orders:', count)
                // Refresh orders list
                const { data: refreshedOrders } = await supabase
                    .from('orders')
                    .select('*')
                    .eq('event_id', event.id)
                    .order('created_at', { ascending: false })
                setOrders(refreshedOrders || [])
            }
        } catch (err: any) {
            console.error('[EventOrders] Error:', err)
            setError(err.message)
        }

        setFixingFreeOrders(false)
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
                    <h3 className="text-lg font-medium text-gray-900">Bestellingen</h3>
                    <p className="text-sm text-gray-500">Alle orders voor dit evenement.</p>
                </div>
                <div className="flex gap-2">
                    {/* Fix Free Orders Button - only show if there are pending free orders */}
                    {orders.some(o => o.status === 'pending' && o.total_amount === 0) && (
                        <button
                            onClick={handleFixFreeOrders}
                            disabled={fixingFreeOrders}
                            className="inline-flex items-center px-3 py-2 border border-yellow-300 text-sm font-medium rounded-md text-yellow-700 bg-yellow-50 hover:bg-yellow-100 disabled:opacity-50"
                        >
                            {fixingFreeOrders ? 'Fixen...' : 'Fix gratis orders'}
                        </button>
                    )}
                    <button
                        onClick={handleSimulateFreeOrder}
                        disabled={simulating}
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                    >
                        {simulating ? (
                            <>
                                <Loader2 className="animate-spin mr-2 h-4 w-4" />
                                Simuleren...
                            </>
                        ) : (
                            <>
                                <Plus className="mr-2 h-4 w-4" />
                                Simuleer gratis bestelling
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3">
                    <p className="text-sm text-red-800">{error}</p>
                    <button onClick={() => setError(null)} className="text-sm text-red-600 underline">Sluiten</button>
                </div>
            )}

            {/* Orders List */}
            {orders.length === 0 ? (
                // Empty State
                <div className="text-center py-12 bg-gray-50 rounded-lg">
                    <ShoppingCart className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">Geen bestellingen</h3>
                    <p className="mt-1 text-sm text-gray-500">Er zijn nog geen orders voor dit event.</p>
                    <div className="mt-6">
                        <button
                            onClick={handleSimulateFreeOrder}
                            disabled={simulating}
                            className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
                        >
                            <Plus className="-ml-1 mr-2 h-5 w-5" />
                            Simuleer gratis bestelling
                        </button>
                    </div>
                </div>
            ) : (
                // Orders Table
                <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 rounded-lg">
                    <table className="min-w-full divide-y divide-gray-300">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900">Email</th>
                                <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Totaal</th>
                                <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Status</th>
                                <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Datum</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                            {orders.map((order) => (
                                <OrderRow
                                    key={order.id}
                                    order={order}
                                    onStatusUpdated={(newStatus) => {
                                        setOrders(prev => prev.map(o =>
                                            o.id === order.id ? { ...o, status: newStatus } : o
                                        ))
                                    }}
                                />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}

/**
 * Order Row Component with refresh capability
 */
function OrderRow({ order, onStatusUpdated }: { order: Order; onStatusUpdated: (status: string) => void }) {
    const [refreshing, setRefreshing] = useState(false)
    const [syncing, setSyncing] = useState(false)

    const handleRefreshStatus = async () => {
        if (order.status !== 'pending' || order.total_amount === 0) return

        setRefreshing(true)
        try {
            // Fetch payment for this order
            const { data: payment } = await supabase
                .from('payments')
                .select('provider_payment_id, status')
                .eq('order_id', order.id)
                .single()

            if (payment?.provider_payment_id) {
                // Trigger webhook manually by calling mollie-webhook
                const formData = new URLSearchParams()
                formData.append('id', payment.provider_payment_id)

                const response = await fetch(
                    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mollie-webhook`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: formData.toString()
                    }
                )

                if (response.ok) {
                    // Refetch order status
                    const { data: updatedOrder } = await supabase
                        .from('orders')
                        .select('status')
                        .eq('id', order.id)
                        .single()

                    if (updatedOrder?.status && updatedOrder.status !== order.status) {
                        onStatusUpdated(updatedOrder.status)
                    }
                }
            }
        } catch (err) {
            console.error('Failed to refresh status:', err)
        } finally {
            setRefreshing(false)
        }
    }

    // Force sync: update order to paid + call sync RPC
    const handleForceSync = async () => {
        setSyncing(true)
        try {
            // 1. Update order status directly to paid
            const { error: updateError } = await supabase
                .from('orders')
                .update({ status: 'paid', updated_at: new Date().toISOString() })
                .eq('id', order.id)

            if (updateError) {
                console.error('Failed to update order:', updateError)
                return
            }

            // 2. Update payment status to paid
            await supabase
                .from('payments')
                .update({ status: 'paid', updated_at: new Date().toISOString() })
                .eq('order_id', order.id)

            // 3. Call sync_registration_on_payment RPC
            const { data: syncResult, error: syncError } = await supabase
                .rpc('sync_registration_on_payment', { p_order_id: order.id })

            if (syncError) {
                console.error('Sync RPC failed:', syncError)
            } else {
                console.log('Sync result:', syncResult)
            }

            onStatusUpdated('paid')
        } catch (err) {
            console.error('Force sync failed:', err)
        } finally {
            setSyncing(false)
        }
    }

    return (
        <tr className="hover:bg-gray-50">
            <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm">
                <div className="font-medium text-gray-900">{order.email}</div>
                <div className="text-gray-500 text-xs">{order.id.slice(0, 8)}</div>
            </td>
            <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">
                {order.total_amount === 0 ? (
                    <span className="text-green-600 font-medium">Gratis</span>
                ) : (
                    `€${parseFloat(order.total_amount.toString()).toFixed(2)}`
                )}
            </td>
            <td className="whitespace-nowrap px-3 py-4 text-sm">
                <div className="flex items-center gap-2">
                    <OrderStatusBadge status={order.status} />
                    {order.status === 'pending' && order.total_amount > 0 && (
                        <>
                            <button
                                onClick={handleRefreshStatus}
                                disabled={refreshing || syncing}
                                className="text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                                title="Check payment status bij Mollie"
                            >
                                {refreshing ? '...' : '↻'}
                            </button>
                            <button
                                onClick={handleForceSync}
                                disabled={syncing || refreshing}
                                className="text-xs text-green-600 hover:text-green-800 disabled:opacity-50 ml-1"
                                title="Forceer sync naar betaald"
                            >
                                {syncing ? '...' : '✓ Fix'}
                            </button>
                        </>
                    )}
                </div>
            </td>
            <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                {new Date(order.created_at).toLocaleDateString('nl-NL', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                })}
            </td>
        </tr>
    )
}

/**
 * Order Status Badge
 */
function OrderStatusBadge({ status }: { status: string }) {
    const config: Record<string, { bg: string; text: string; icon: any; label: string }> = {
        pending: {
            bg: 'bg-yellow-100',
            text: 'text-yellow-800',
            icon: Clock,
            label: 'In behandeling'
        },
        paid: {
            bg: 'bg-green-100',
            text: 'text-green-800',
            icon: CheckCircle,
            label: 'Betaald'
        },
        failed: {
            bg: 'bg-red-100',
            text: 'text-red-800',
            icon: XCircle,
            label: 'Mislukt'
        },
        cancelled: {
            bg: 'bg-gray-100',
            text: 'text-gray-800',
            icon: XCircle,
            label: 'Geannuleerd'
        },
        refunded: {
            bg: 'bg-purple-100',
            text: 'text-purple-800',
            icon: XCircle,
            label: 'Terugbetaald'
        },
    }

    const { bg, text, icon: Icon, label } = config[status] || config.pending

    return (
        <span className={clsx('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', bg, text)}>
            <Icon className="mr-1 h-3 w-3" />
            {label}
        </span>
    )
}
