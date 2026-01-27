/**
 * PublicConfirmPage
 * 
 * Order confirmation page - accessible via public token
 * Route: /e/:eventSlug/confirm?token=xxx
 * 
 * Features:
 * - Load order via get-order-public Edge Function
 * - Show order details + ticket instances
 * - No authentication required
 */

import { useEffect, useState } from 'react'
import { useParams, useSearchParams, Link, useLocation } from 'react-router-dom'
import { CheckCircle, Loader2, Calendar, MapPin, Ticket, Mail } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { QRCodeSVG } from 'qrcode.react'

interface OrderData {
    order: {
        id: string
        email: string
        purchaser_name: string | null
        status: string
        total_amount: number
        currency: string
        created_at: string
    }
    event: {
        slug: string
        name: string
        start_time: string | null
        location_name: string | null
    }
    items: Array<{
        ticket_name: string
        ticket_description: string | null
        quantity: number
        unit_price: number
        total_price: number
    }>
    tickets: Array<{
        id: string
        qr_code: string
        status: string
        ticket_name: string
    }> | null
}

export function PublicConfirm() {
    const { eventSlug } = useParams<{ eventSlug: string }>()
    const [searchParams] = useSearchParams()
    const token = searchParams.get('token')

    const [orderData, setOrderData] = useState<OrderData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Check for state passed from checkout
    const location = useLocation()
    const stateTickets = location.state?.tickets
    const stateOrder = location.state?.order

    useEffect(() => {
        async function fetchOrder() {
            if (!token) {
                setError('Geen token gevonden')
                setLoading(false)
                return
            }

            // If we have state from checkout, use it!
            if (stateTickets && stateOrder) {
                console.log('[PublicConfirm] Using state data')
                // We still need event details, so we might need to fetch or construct
                // But get-order-public returns everything nicely structure.
                // If we have state, we likely have the raw tickets.
                // But we need the full OrderData structure.
                // Let's fetch the order data anyway to get event info, 
                // BUT overwrite the tickets with our raw tokens if available.
            }

            console.log('[PublicConfirm] Fetching order with token:', token.slice(0, 8) + '...')

            try {
                const { data, error: fetchError } = await supabase.functions.invoke('get-order-public', {
                    body: { public_token: token }
                })

                if (fetchError) {
                    console.error('[PublicConfirm] Error:', fetchError)
                    throw new Error(fetchError.message)
                }

                if (!data) {
                    throw new Error('Geen data ontvangen')
                }

                // If we have raw tickets in state, use them instead of the DB previews
                if (stateTickets && stateTickets.length > 0) {
                    // Map raw tokens to the fetched tickets structure
                    // We assume the order matches.
                    // The fetched tickets have 'qr_code' which is the preview.
                    // The state tickets have 'token' which is the raw token.
                    // We want to display the raw token.

                    const mergedTickets = data.tickets?.map((t: any) => {
                        const raw = stateTickets.find((st: any) => st.id === t.id)
                        return raw ? { ...t, qr_code: raw.token } : t
                    })

                    setOrderData({ ...data, tickets: mergedTickets })
                } else {
                    setOrderData(data)
                }
            } catch (err: any) {
                console.error('[PublicConfirm] Error:', err)
                setError(err.message || 'Kon bestelling niet ophalen')
            }

            setLoading(false)
        }

        fetchOrder()
    }, [token, stateTickets])

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <Loader2 className="mx-auto h-12 w-12 text-indigo-600 animate-spin" />
                    <p className="mt-4 text-gray-600">Bestelling laden...</p>
                </div>
            </div>
        )
    }

    if (error || !orderData) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center max-w-md">
                    <div className="bg-red-50 rounded-full h-16 w-16 flex items-center justify-center mx-auto mb-4">
                        <span className="text-2xl">⚠️</span>
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">Bestelling niet gevonden</h2>
                    <p className="text-gray-600 mb-6">{error || 'Ongeldige of verlopen link'}</p>
                    {eventSlug && (
                        <Link
                            to={`/e/${eventSlug}`}
                            className="inline-block px-6 py-3 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                        >
                            Terug naar evenement
                        </Link>
                    )}
                </div>
            </div>
        )
    }

    const isPaid = orderData.order.status === 'paid'

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Success Header */}
            <div className="bg-white shadow">
                <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6 lg:px-8 text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
                        <CheckCircle className="h-10 w-10 text-green-600" />
                    </div>
                    <h1 className="text-3xl font-bold text-gray-900">Bestelling bevestigd!</h1>
                    <p className="mt-2 text-gray-600">
                        {isPaid
                            ? 'Je tickets zijn uitgegeven en verstuurd naar je email.'
                            : 'Je bestelling is ontvangen. Je ontvangt verdere instructies per email.'}
                    </p>
                </div>
            </div>

            {/* Order Details */}
            <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
                <div className="bg-white shadow rounded-lg overflow-hidden">
                    {/* Event Info */}
                    <div className="px-6 py-5 border-b border-gray-200">
                        <h3 className="text-lg font-medium text-gray-900">{orderData.event.name}</h3>
                        <div className="mt-2 flex flex-col space-y-1 text-sm text-gray-500">
                            {orderData.event.start_time && (
                                <span className="flex items-center">
                                    <Calendar className="mr-2 h-4 w-4" />
                                    {new Date(orderData.event.start_time).toLocaleDateString('nl-NL', {
                                        day: 'numeric',
                                        month: 'long',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit'
                                    })}
                                </span>
                            )}
                            {orderData.event.location_name && (
                                <span className="flex items-center">
                                    <MapPin className="mr-2 h-4 w-4" />
                                    {orderData.event.location_name}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Purchaser Info */}
                    <div className="px-6 py-5 border-b border-gray-200">
                        <h4 className="text-sm font-medium text-gray-900 mb-3">Bestelgegevens</h4>
                        <dl className="grid grid-cols-1 gap-3 text-sm">
                            {orderData.order.purchaser_name && (
                                <div>
                                    <dt className="text-gray-500">Naam</dt>
                                    <dd className="text-gray-900 font-medium">{orderData.order.purchaser_name}</dd>
                                </div>
                            )}
                            <div>
                                <dt className="text-gray-500 flex items-center">
                                    <Mail className="mr-1 h-4 w-4" />
                                    Email
                                </dt>
                                <dd className="text-gray-900 font-medium">{orderData.order.email}</dd>
                            </div>
                            <div>
                                <dt className="text-gray-500">Bestelnummer</dt>
                                <dd className="text-gray-900 font-mono text-xs">{orderData.order.id.slice(0, 8)}</dd>
                            </div>
                        </dl>
                    </div>

                    {/* Order Items */}
                    <div className="px-6 py-5 border-b border-gray-200">
                        <h4 className="text-sm font-medium text-gray-900 mb-3">Bestelde tickets</h4>
                        <div className="space-y-3">
                            {orderData.items.map((item, idx) => (
                                <div key={idx} className="flex justify-between items-start">
                                    <div className="flex-1">
                                        <p className="font-medium text-gray-900">{item.ticket_name}</p>
                                        {item.ticket_description && (
                                            <p className="text-sm text-gray-500">{item.ticket_description}</p>
                                        )}
                                        <p className="text-sm text-gray-500">Aantal: {item.quantity}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-medium text-gray-900">
                                            {item.total_price === 0 ? 'Gratis' : `€${item.total_price.toFixed(2)}`}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="mt-4 pt-4 border-t border-gray-200 flex justify-between items-center">
                            <span className="text-base font-medium text-gray-900">Totaal</span>
                            <span className="text-lg font-bold text-indigo-600">
                                {orderData.order.total_amount === 0
                                    ? 'Gratis'
                                    : `€${orderData.order.total_amount.toFixed(2)}`}
                            </span>
                        </div>
                    </div>

                    {/* Issued Tickets */}
                    {isPaid && orderData.tickets && orderData.tickets.length > 0 && (
                        <div className="px-6 py-5">
                            <h4 className="text-sm font-medium text-gray-900 mb-3 flex items-center">
                                <Ticket className="mr-2 h-4 w-4" />
                                Je tickets ({orderData.tickets.length})
                            </h4>
                            <div className="space-y-4">
                                {orderData.tickets.map((ticket) => (
                                    <div
                                        key={ticket.id}
                                        className="flex items-start justify-between p-4 bg-gray-50 rounded-md border border-gray-200"
                                    >
                                        <div>
                                            <p className="text-sm font-medium text-gray-900">{ticket.ticket_name}</p>
                                            <p className="text-xs text-gray-500 font-mono mt-1 break-all">{ticket.qr_code}</p>
                                            <div className="mt-2">
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                                    Geldig
                                                </span>
                                            </div>
                                        </div>
                                        <div className="bg-white p-2 rounded border border-gray-100">
                                            {ticket.qr_code.length > 20 ? (
                                                <QRCodeSVG value={ticket.qr_code} size={96} />
                                            ) : (
                                                <div className="h-24 w-24 bg-gray-100 flex items-center justify-center text-xs text-gray-400 text-center p-1">
                                                    Zie email
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <p className="mt-4 text-sm text-gray-500">
                                💡 Je ontvangt je tickets ook per email. Bewaar deze goed!
                            </p>
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="mt-6 text-center">
                    <Link
                        to={`/e/${orderData.event.slug}`}
                        className="text-indigo-600 hover:text-indigo-500 text-sm font-medium"
                    >
                        ← Terug naar evenement
                    </Link>
                </div>
            </div>
        </div>
    )
}
