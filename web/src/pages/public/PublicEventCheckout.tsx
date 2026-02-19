/**
 * PublicEventCheckout
 *
 * Checkout pagina - auth vereist
 * Route: /e/:eventSlug
 *
 * Features:
 * - Auth required (redirect naar login als niet ingelogd)
 * - Email automatisch van ingelogde user
 * - Toon event details
 * - Lijst published tickets met real-time availability
 * - Sold out states + max per participant limits
 * - Products section (F015 S3) - extra's & producten
 * - Standalone producten mogen los gekocht worden
 * - Pre-checkout validation via RPC
 * - Call create-order-public Edge Function
 * - Redirect naar Mollie of confirmation page
 */

import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation, Link, useSearchParams } from 'react-router-dom'
import { Calendar, MapPin, Ticket, Loader2, ShoppingCart, AlertCircle, ArrowLeft, Gift, CheckCircle, Package } from 'lucide-react'
import { getPublicEventBySlug } from '../../data/public_events'
import { getPublicProducts, formatPrice } from '../../data/products'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { validateEmailInvitation, type EmailInvitationValidation } from '../../data/invitations'
import { isProductAvailable, getProductStatusBadge, type PublicProduct } from '../../types/products'

// Ticket type with availability info from RPC
interface TicketWithAvailability {
    id: string
    name: string
    description: string | null
    price: number
    currency: string
    vat_percentage: number | null
    capacity_total: number
    sold_count: number
    available_count: number
    is_sold_out: boolean
    distance_value: number | null
    distance_unit: string | null
    ticket_category: string | null
    max_per_participant: number | null
    image_url: string | null
    sales_start: string | null
    sales_end: string | null
    on_sale: boolean
    sort_order: number | null
    time_slots: any[]
}

// Validation error from RPC
interface ValidationError {
    ticket_type_id?: string
    ticket_name?: string
    error: string
    requested?: number
    available?: number
    max_allowed?: number
    sales_start?: string
    sales_end?: string
}

// Product quantity state: productId -> { quantity, variantId? }
interface ProductSelection {
    quantity: number
    variantId?: string
}

export function PublicEventCheckout() {
    const { eventSlug } = useParams<{ eventSlug: string }>()
    const navigate = useNavigate()
    const location = useLocation()
    const [searchParams] = useSearchParams()
    const { user, loading: authLoading } = useAuth()

    // B008: Check for invitation token in URL
    const invitationToken = searchParams.get('invitation')

    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])
    const [event, setEvent] = useState<any>(null)
    const [tickets, setTickets] = useState<TicketWithAvailability[]>([])
    const [quantities, setQuantities] = useState<Record<string, number>>({})
    const [submitting, setSubmitting] = useState(false)
    const [validating, setValidating] = useState(false)

    // F015 S3: Products state
    const [products, setProducts] = useState<PublicProduct[]>([])
    const [productQuantities, setProductQuantities] = useState<Record<string, ProductSelection>>({})

    // B011: Invitation state (gives ACCESS, not discount)
    const [invitation, setInvitation] = useState<EmailInvitationValidation | null>(null)
    const [invitationLoading, setInvitationLoading] = useState(false)

    // Redirect to login if not authenticated
    useEffect(() => {
        if (!authLoading && !user) {
            navigate('/login', { state: { from: location }, replace: true })
        }
    }, [user, authLoading, navigate, location])

    useEffect(() => {
        async function fetchEvent() {
            if (!eventSlug) return

            setLoading(true)
            setError(null)

            // Fetch event (via public view)
            const { data: eventData, error: eventError } = await getPublicEventBySlug(eventSlug)

            if (eventError || !eventData) {
                console.error('[PublicEvent] Event error:', eventError)
                setError('Event niet gevonden of niet beschikbaar')
                setLoading(false)
                return
            }

            // Status check is redundant due to view, but kept for type safety
            if (eventData.status !== 'published') {
                setError('Dit evenement is niet beschikbaar voor inschrijving')
                setLoading(false)
                return
            }

            setEvent(eventData)

            // Fetch tickets with availability via RPC
            const { data: availabilityData, error: availabilityError } = await supabase
                .rpc('get_ticket_availability', { _event_id: eventData.id })

            if (availabilityError) {
                console.error('[PublicEvent] Availability error:', availabilityError)
                setError('Kon tickets niet ophalen')
            } else if (availabilityData?.error) {
                console.error('[PublicEvent] Availability RPC error:', availabilityData.error)
                setError('Kon tickets niet ophalen')
            } else {
                setTickets(availabilityData?.ticket_types || [])
            }

            setLoading(false)
        }

        fetchEvent()
    }, [eventSlug])

    // F015 S3: Fetch products (reactief op ticket selectie)
    useEffect(() => {
        async function fetchProducts() {
            if (!event?.id) return

            // Get selected ticket type IDs for ticket_upgrade filtering
            const selectedTicketTypeIds = Object.entries(quantities)
                .filter(([_, qty]) => qty > 0)
                .map(([ticketId]) => ticketId)

            const { data: productData, error: productError } = await getPublicProducts(
                event.id,
                selectedTicketTypeIds.length > 0 ? selectedTicketTypeIds : undefined
            )

            if (productError) {
                console.error('[Checkout] Products error:', productError)
            } else {
                setProducts(productData || [])
                // Clean up product quantities for products no longer available
                if (productData) {
                    const availableIds = new Set(productData.map(p => p.id))
                    setProductQuantities(prev => {
                        const cleaned: Record<string, ProductSelection> = {}
                        for (const [id, sel] of Object.entries(prev)) {
                            if (availableIds.has(id)) cleaned[id] = sel
                        }
                        return cleaned
                    })
                }
            }
        }

        fetchProducts()
    }, [event?.id, quantities])

    // B011: Load invitation data if token present (for pre-selecting ticket)
    useEffect(() => {
        async function loadInvitation() {
            if (!invitationToken) return

            setInvitationLoading(true)
            const { data, error: invError } = await validateEmailInvitation(invitationToken)

            if (invError || !data?.valid) {
                console.error('[Checkout] Invalid invitation:', invError || data?.error)
                // Don't block checkout, just show message
                setError(data?.error === 'ALREADY_CLAIMED'
                    ? 'Deze uitnodiging is al geclaimd'
                    : 'Uitnodiging niet geldig, maar je kunt nog wel tickets kopen')
            } else {
                setInvitation(data)
                // Auto-select the invited ticket with quantity 1
                if (data.ticket?.id) {
                    setQuantities({ [data.ticket.id]: 1 })
                }
            }
            setInvitationLoading(false)
        }

        loadInvitation()
    }, [invitationToken])

    const handleQuantityChange = (ticketId: string, delta: number) => {
        const ticket = tickets.find(t => t.id === ticketId)
        if (!ticket) return

        // Calculate max allowed quantity
        const maxAllowed = Math.min(
            ticket.available_count,
            ticket.max_per_participant ?? 99
        )

        setQuantities(prev => {
            const current = prev[ticketId] || 0
            const newQty = Math.max(0, Math.min(maxAllowed, current + delta))
            return { ...prev, [ticketId]: newQty }
        })

        // Clear validation errors when quantity changes
        setValidationErrors([])
    }

    // F015 S3: Product quantity handler
    const handleProductQuantityChange = (productId: string, delta: number, variantId?: string) => {
        const product = products.find(p => p.id === productId)
        if (!product) return

        setProductQuantities(prev => {
            const current = prev[productId]?.quantity || 0
            const maxAllowed = product.max_per_order
            const newQty = Math.max(0, Math.min(maxAllowed, current + delta))

            if (newQty === 0) {
                const { [productId]: _, ...rest } = prev
                return rest
            }

            return {
                ...prev,
                [productId]: {
                    quantity: newQty,
                    variantId: variantId ?? prev[productId]?.variantId
                }
            }
        })
    }

    // F015 S3: Product variant selection handler
    const handleProductVariantChange = (productId: string, variantId: string) => {
        setProductQuantities(prev => ({
            ...prev,
            [productId]: {
                quantity: prev[productId]?.quantity || 0,
                variantId
            }
        }))
    }

    // Get max quantity for a ticket
    const getMaxQuantity = (ticket: TicketWithAvailability): number => {
        return Math.min(
            ticket.available_count,
            ticket.max_per_participant ?? 99
        )
    }

    // Check if ticket can be selected
    const isTicketDisabled = (ticket: TicketWithAvailability): boolean => {
        return ticket.is_sold_out || !ticket.on_sale
    }

    // Get status badge for ticket
    const getTicketStatusBadge = (ticket: TicketWithAvailability): { text: string; className: string } | null => {
        if (ticket.is_sold_out) {
            return { text: 'Uitverkocht', className: 'bg-red-100 text-red-800' }
        }
        if (!ticket.on_sale && ticket.sales_start && new Date(ticket.sales_start) > new Date()) {
            return { text: 'Binnenkort', className: 'bg-yellow-100 text-yellow-800' }
        }
        if (!ticket.on_sale && ticket.sales_end && new Date(ticket.sales_end) < new Date()) {
            return { text: 'Verkoop gesloten', className: 'bg-gray-100 text-gray-800' }
        }
        if (ticket.available_count <= 5 && ticket.available_count > 0) {
            return { text: `Nog ${ticket.available_count}`, className: 'bg-orange-100 text-orange-800' }
        }
        return null
    }

    // Format distance badge
    const formatDistanceBadge = (ticket: TicketWithAvailability): string | null => {
        if (!ticket.distance_value) return null
        return `${ticket.distance_value} ${ticket.distance_unit || 'km'}`
    }

    // Ticket totals
    const totalTicketItems = Object.values(quantities).reduce((sum, qty) => sum + qty, 0)

    // F015 S3: Product totals
    const totalProductItems = Object.values(productQuantities).reduce((sum, sel) => sum + sel.quantity, 0)

    const totalItems = totalTicketItems + totalProductItems

    // Invitation gives ACCESS to buy, NOT a discount - user pays full price!
    const invitedTicketId = invitation?.ticket?.id

    const ticketSubtotal = tickets.reduce((sum, ticket) => {
        const qty = quantities[ticket.id] || 0
        return sum + (ticket.price * qty)
    }, 0)

    // F015 S3: Product subtotal
    const productSubtotal = products.reduce((sum, product) => {
        const sel = productQuantities[product.id]
        if (!sel) return sum
        return sum + (product.price * sel.quantity)
    }, 0)

    const subtotalPrice = ticketSubtotal + productSubtotal

    // NO DISCOUNT - user pays full price
    const totalPrice = subtotalPrice

    // Validate order before checkout
    const validateOrder = async (): Promise<boolean> => {
        if (!event) return false

        setValidating(true)
        setValidationErrors([])

        // Only validate ticket items (products validated by Edge Function)
        const items = Object.entries(quantities)
            .filter(([_, qty]) => qty > 0)
            .map(([ticketId, qty]) => ({
                ticket_type_id: ticketId,
                quantity: qty
            }))

        // Skip ticket validation if only products are ordered
        if (items.length === 0 && totalProductItems > 0) {
            setValidating(false)
            return true
        }

        if (items.length === 0) {
            setValidating(false)
            return true
        }

        const { data, error: rpcError } = await supabase
            .rpc('validate_ticket_order', {
                _event_id: event.id,
                _items: items
            })

        setValidating(false)

        if (rpcError) {
            console.error('[PublicEvent] Validation RPC error:', rpcError)
            setError('Kon bestelling niet valideren')
            return false
        }

        if (!data?.valid) {
            setValidationErrors(data?.errors || [])
            return false
        }

        return true
    }

    // Translate validation error codes
    const translateError = (err: ValidationError): string => {
        const ticketName = err.ticket_name || 'Ticket'
        switch (err.error) {
            case 'NO_ITEMS':
                return 'Selecteer minimaal één ticket'
            case 'EVENT_NOT_FOUND':
                return 'Event niet gevonden of niet beschikbaar'
            case 'TICKET_TYPE_NOT_FOUND':
                return `${ticketName}: Ticket type niet gevonden`
            case 'TICKET_NOT_PUBLISHED':
                return `${ticketName}: Ticket is niet beschikbaar`
            case 'TICKET_NOT_VISIBLE':
                return `${ticketName}: Ticket is niet beschikbaar`
            case 'SALES_NOT_STARTED':
                return `${ticketName}: Verkoop nog niet gestart`
            case 'SALES_ENDED':
                return `${ticketName}: Verkoop is gesloten`
            case 'INSUFFICIENT_CAPACITY':
                return `${ticketName}: Niet genoeg tickets beschikbaar (${err.available} over, ${err.requested} gevraagd)`
            case 'EXCEEDS_MAX_PER_PARTICIPANT':
                return `${ticketName}: Maximum ${err.max_allowed} per bestelling`
            default:
                return `${ticketName}: ${err.error}`
        }
    }

    const handleCheckout = async () => {
        if (!user) {
            navigate('/login', { state: { from: location }, replace: true })
            return
        }

        // F015 S3: Allow standalone products without tickets
        if (totalTicketItems === 0 && totalProductItems === 0) {
            setError('Selecteer minimaal één ticket of product')
            return
        }

        setSubmitting(true)
        setError(null)
        setValidationErrors([])

        try {
            // Pre-validate order (tickets only, products validated server-side)
            if (totalTicketItems > 0) {
                const isValid = await validateOrder()
                if (!isValid) {
                    setSubmitting(false)
                    return
                }
            }

            // Build ticket items array
            const items = Object.entries(quantities)
                .filter(([_, qty]) => qty > 0)
                .map(([ticketId, qty]) => ({
                    ticket_type_id: ticketId,
                    quantity: qty
                }))

            // F015 S3: Build product items array
            const productItems = Object.entries(productQuantities)
                .filter(([_, sel]) => sel.quantity > 0)
                .map(([productId, sel]) => ({
                    product_id: productId,
                    product_variant_id: sel.variantId || undefined,
                    quantity: sel.quantity
                }))

            // Call Edge Function with user email
            // B011: Include invitation token (gives ACCESS to buy, NOT a discount)
            const { data, error: createError } = await supabase.functions.invoke('create-order-public', {
                body: {
                    event_slug: eventSlug,
                    items,
                    product_items: productItems.length > 0 ? productItems : undefined,
                    email: user.email,
                    purchaser_name: user.user_metadata?.full_name || null,
                    invitation_token: invitationToken || undefined,
                }
            })

            if (createError) {
                console.error('[PublicEvent] Create order error:', createError)
                throw new Error(createError.message)
            }

            // Check for server-side error in response body
            if (data?.error) {
                console.error('[PublicEvent] Server error:', data.error, data.code)
                throw new Error(data.error)
            }

            // For paid orders (total > 0), we MUST have a checkout URL
            const isPaidOrder = totalPrice > 0

            // If there's a checkout URL (paid order), redirect to Mollie
            if (data?.checkout_url) {
                console.log('[PublicEvent] Redirecting to Mollie checkout:', data.checkout_url)
                window.location.href = data.checkout_url
                return
            }

            // Paid order without checkout URL = error
            if (isPaidOrder && !data?.checkout_url) {
                console.error('[PublicEvent] Paid order but no checkout URL!', data)
                throw new Error('Betaling kon niet worden gestart. Probeer het opnieuw.')
            }

            // Free order - redirect to confirmation
            if (data?.public_token) {
                navigate(`/e/${eventSlug}/confirm?token=${data.public_token}`, {
                    state: {
                        tickets: data.tickets,
                        order: data.order
                    }
                })
            } else {
                throw new Error('Geen token ontvangen')
            }
        } catch (err: any) {
            console.error('[PublicEvent] Error:', err)
            setError(err.message || 'Er ging iets mis bij het plaatsen van je bestelling')
        }

        setSubmitting(false)
    }

    if (loading || authLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
            </div>
        )
    }

    // Don't render if not authenticated (will redirect)
    if (!user) {
        return null
    }

    if (error && !event) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">Evenement niet gevonden</h2>
                    <p className="text-gray-600">{error}</p>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="bg-white border-b border-gray-200">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
                    <Link to="/events" className="flex items-center gap-2 text-gray-600 hover:text-black">
                        <ArrowLeft className="h-5 w-5" />
                        <span className="text-sm font-medium">Terug naar events</span>
                    </Link>
                    <Link to="/" className="text-xl font-bold tracking-tight">
                        COLOSS
                    </Link>
                    <Link to="/my" className="text-sm text-gray-600 hover:text-black">
                        Mijn Account
                    </Link>
                </div>
            </header>

            {/* Event Info */}
            <div className="bg-white border-b border-gray-100">
                <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
                    <h1 className="text-3xl font-bold text-gray-900">{event?.name}</h1>
                    <div className="mt-2 flex items-center space-x-4 text-sm text-gray-500">
                        {event?.start_time && (
                            <span className="flex items-center">
                                <Calendar className="mr-1 h-4 w-4" />
                                {new Date(event.start_time).toLocaleDateString('nl-NL', {
                                    day: 'numeric',
                                    month: 'long',
                                    year: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                })}
                            </span>
                        )}
                        {event?.location_name && (
                            <span className="flex items-center">
                                <MapPin className="mr-1 h-4 w-4" />
                                {event.location_name}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Tickets + Products */}
                    <div className="lg:col-span-2">
                        <h2 className="text-xl font-semibold text-gray-900 mb-4">Beschikbare tickets</h2>

                        {tickets.length === 0 ? (
                            <div className="bg-white rounded-lg shadow p-8 text-center">
                                <Ticket className="mx-auto h-12 w-12 text-gray-400" />
                                <p className="mt-2 text-gray-600">Momenteel geen tickets beschikbaar.</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {tickets.map(ticket => {
                                    const disabled = isTicketDisabled(ticket)
                                    const statusBadge = getTicketStatusBadge(ticket)
                                    const distanceBadge = formatDistanceBadge(ticket)
                                    const maxQty = getMaxQuantity(ticket)
                                    const currentQty = quantities[ticket.id] || 0

                                    return (
                                        <div
                                            key={ticket.id}
                                            className={`bg-white rounded-lg shadow p-6 ${disabled ? 'opacity-60' : ''}`}
                                        >
                                            <div className="flex items-start justify-between">
                                                <div className="flex-1">
                                                    {/* Title + badges */}
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <h3 className="text-lg font-medium text-gray-900">{ticket.name}</h3>
                                                        {distanceBadge && (
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                                                {distanceBadge}
                                                            </span>
                                                        )}
                                                        {ticket.ticket_category && (
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                                                                {ticket.ticket_category}
                                                            </span>
                                                        )}
                                                        {statusBadge && (
                                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusBadge.className}`}>
                                                                {statusBadge.text}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {ticket.description && (
                                                        <p className="mt-1 text-sm text-gray-500">{ticket.description}</p>
                                                    )}

                                                    {/* Availability info */}
                                                    {!disabled && (
                                                        <p className="mt-1 text-xs text-gray-400">
                                                            {ticket.available_count} van {ticket.capacity_total} beschikbaar
                                                            {ticket.max_per_participant && (
                                                                <span> · Max {ticket.max_per_participant} per bestelling</span>
                                                            )}
                                                        </p>
                                                    )}

                                                    <p className="mt-2 text-2xl font-bold text-indigo-600">
                                                        {ticket.price === 0 ? (
                                                            'Gratis'
                                                        ) : (
                                                            `€${ticket.price.toFixed(2)}`
                                                        )}
                                                    </p>
                                                </div>

                                                {/* Quantity selector */}
                                                <div className="flex items-center space-x-3">
                                                    <button
                                                        onClick={() => handleQuantityChange(ticket.id, -1)}
                                                        disabled={disabled || currentQty === 0}
                                                        className="w-8 h-8 rounded-full border-2 border-gray-300 flex items-center justify-center hover:border-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed"
                                                    >
                                                        −
                                                    </button>
                                                    <span className="w-8 text-center font-medium">
                                                        {currentQty}
                                                    </span>
                                                    <button
                                                        onClick={() => handleQuantityChange(ticket.id, 1)}
                                                        disabled={disabled || currentQty >= maxQty}
                                                        className="w-8 h-8 rounded-full border-2 border-indigo-600 bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                                    >
                                                        +
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}

                        {/* F015 S3: Products Section */}
                        {products.length > 0 && (
                            <>
                                <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4 flex items-center">
                                    <Package className="h-5 w-5 mr-2 text-indigo-600" />
                                    Extra's & producten
                                </h2>
                                <div className="space-y-4">
                                    {products.map(product => {
                                        const available = isProductAvailable(product)
                                        const badge = getProductStatusBadge(product)
                                        const disabled = !available
                                        const currentSel = productQuantities[product.id]
                                        const currentQty = currentSel?.quantity || 0
                                        const hasVariants = product.variants && product.variants.length > 0

                                        return (
                                            <div
                                                key={product.id}
                                                className={`bg-white rounded-lg shadow p-6 ${disabled ? 'opacity-60' : ''}`}
                                            >
                                                <div className="flex items-start justify-between">
                                                    <div className="flex-1">
                                                        {/* Title + badges */}
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <h3 className="text-lg font-medium text-gray-900">{product.name}</h3>
                                                            {product.category === 'ticket_upgrade' && (
                                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800">
                                                                    Ticket upgrade
                                                                </span>
                                                            )}
                                                            {badge && (
                                                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badge.className}`}>
                                                                    {badge.text}
                                                                </span>
                                                            )}
                                                        </div>

                                                        {product.description && (
                                                            <p className="mt-1 text-sm text-gray-500">{product.description}</p>
                                                        )}

                                                        {/* Variant selector */}
                                                        {hasVariants && !disabled && (
                                                            <div className="mt-2">
                                                                <select
                                                                    value={currentSel?.variantId || ''}
                                                                    onChange={(e) => handleProductVariantChange(product.id, e.target.value)}
                                                                    className="text-sm border border-gray-300 rounded-md px-2 py-1 focus:ring-indigo-500 focus:border-indigo-500"
                                                                >
                                                                    <option value="">Kies variant...</option>
                                                                    {product.variants.map(v => {
                                                                        const variantSoldOut = v.available_capacity !== null && v.available_capacity <= 0
                                                                        return (
                                                                            <option key={v.id} value={v.id} disabled={variantSoldOut}>
                                                                                {v.name}{variantSoldOut ? ' (uitverkocht)' : ''}
                                                                            </option>
                                                                        )
                                                                    })}
                                                                </select>
                                                            </div>
                                                        )}

                                                        <p className="mt-2 text-2xl font-bold text-indigo-600">
                                                            {product.price === 0 ? 'Gratis' : formatPrice(product.price)}
                                                        </p>
                                                    </div>

                                                    {/* Quantity selector */}
                                                    <div className="flex items-center space-x-3">
                                                        <button
                                                            onClick={() => handleProductQuantityChange(product.id, -1)}
                                                            disabled={disabled || currentQty === 0}
                                                            className="w-8 h-8 rounded-full border-2 border-gray-300 flex items-center justify-center hover:border-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed"
                                                        >
                                                            −
                                                        </button>
                                                        <span className="w-8 text-center font-medium">
                                                            {currentQty}
                                                        </span>
                                                        <button
                                                            onClick={() => handleProductQuantityChange(product.id, 1, hasVariants ? currentSel?.variantId : undefined)}
                                                            disabled={disabled || currentQty >= product.max_per_order || (hasVariants && !currentSel?.variantId)}
                                                            className="w-8 h-8 rounded-full border-2 border-indigo-600 bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                                        >
                                                            +
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </>
                        )}
                    </div>

                    {/* Checkout Sidebar */}
                    <div className="lg:col-span-1">
                        <div className="bg-white rounded-lg shadow p-6 sticky top-8">
                            <h3 className="text-lg font-semibold text-gray-900 mb-4">Bestelling</h3>

                            {/* Invitation notice - NO DISCOUNT, just access */}
                            {invitation && (
                                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
                                    <div className="flex items-center">
                                        <Gift className="h-5 w-5 text-blue-600 mr-2" />
                                        <div>
                                            <p className="text-sm font-medium text-blue-800">
                                                Je bent uitgenodigd!
                                            </p>
                                            <p className="text-xs text-blue-600">
                                                {invitation.ticket?.name} is voor jou geselecteerd
                                            </p>
                                        </div>
                                        <CheckCircle className="h-5 w-5 text-blue-600 ml-auto" />
                                    </div>
                                </div>
                            )}

                            <div className="space-y-2 mb-4 text-sm">
                                {/* Ticket line items */}
                                {tickets.filter(t => (quantities[t.id] || 0) > 0).map(ticket => (
                                    <div key={ticket.id} className="flex justify-between">
                                        <span className="text-gray-600">{quantities[ticket.id]}x {ticket.name}</span>
                                        <span className="font-medium">{ticket.price === 0 ? 'Gratis' : `€${(ticket.price * quantities[ticket.id]).toFixed(2)}`}</span>
                                    </div>
                                ))}

                                {/* Product line items */}
                                {products.filter(p => (productQuantities[p.id]?.quantity || 0) > 0).map(product => {
                                    const sel = productQuantities[product.id]
                                    const variant = sel?.variantId ? product.variants.find(v => v.id === sel.variantId) : null
                                    return (
                                        <div key={product.id} className="flex justify-between">
                                            <span className="text-gray-600">
                                                {sel.quantity}x {product.name}
                                                {variant && <span className="text-gray-400"> ({variant.name})</span>}
                                            </span>
                                            <span className="font-medium">
                                                {product.price === 0 ? 'Gratis' : `€${(product.price * sel.quantity).toFixed(2)}`}
                                            </span>
                                        </div>
                                    )
                                })}

                                {totalItems === 0 && (
                                    <p className="text-gray-400 italic">Nog niets geselecteerd</p>
                                )}

                                <div className="flex justify-between text-lg font-bold pt-2 border-t border-gray-100">
                                    <span>Totaal:</span>
                                    <span className="text-indigo-600">
                                        {totalPrice === 0 && totalItems > 0 ? 'Gratis' : totalItems === 0 ? '€0,00' : `€${totalPrice.toFixed(2)}`}
                                    </span>
                                </div>
                            </div>

                            {/* User info */}
                            {user && (
                                <div className="mb-4 p-3 bg-gray-50 rounded-md">
                                    <p className="text-xs text-gray-500 mb-1">Ingelogd als</p>
                                    <p className="text-sm font-medium text-gray-900">{user.email}</p>
                                </div>
                            )}

                            {/* Validation errors */}
                            {validationErrors.length > 0 && (
                                <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4">
                                    <div className="flex items-start">
                                        <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 mr-2 flex-shrink-0" />
                                        <div className="text-sm text-red-800">
                                            {validationErrors.map((err, idx) => (
                                                <p key={idx}>{translateError(err)}</p>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {error && (
                                <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4">
                                    <p className="text-sm text-red-800">{error}</p>
                                </div>
                            )}

                            <button
                                onClick={handleCheckout}
                                disabled={submitting || validating || totalItems === 0}
                                className="w-full py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {submitting || validating ? (
                                    <>
                                        <Loader2 className="inline animate-spin mr-2 h-4 w-4" />
                                        {validating ? 'Valideren...' : 'Bezig met bestellen...'}
                                    </>
                                ) : (
                                    <>
                                        <ShoppingCart className="inline mr-2 h-4 w-4" />
                                        {totalPrice === 0 && totalItems > 0 ? 'Gratis bestellen' : 'Afrekenen'}
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
