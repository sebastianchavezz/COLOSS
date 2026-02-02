/**
 * EventProducts Page
 *
 * Products tab within event detail.
 * Features:
 * - Product list (ticket upgrades + standalone)
 * - Empty state with CTA
 * - Modal for product create/edit with tabs
 * - Variant management
 * - Ticket restrictions for upgrades
 */

import { useEffect, useState, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
    Plus, Package, Loader2, Trash2, CheckCircle, XCircle, Edit2,
    Tag, Layers, Settings2
} from 'lucide-react'
import { clsx } from 'clsx'
import {
    listProducts,
    createProduct,
    updateProduct,
    deleteProduct,
    createProductVariant,
    deleteProductVariant,
    setProductTicketRestrictions,
    formatPrice,
    isOnSale
} from '../data/products'
import { listTickets } from '../data/tickets'
import type { AppEvent, Organization, TicketType } from '../types/supabase'
import type {
    Product,
    ProductVariant,
    ProductCategory,
    CreateProductRequest,
    UpdateProductRequest
} from '../types/products'

// Context type from EventDetail
interface EventContext {
    event: AppEvent
    org: Organization
    refreshEvent: () => void
}

// Extended product with relations
interface ProductWithRelations extends Product {
    product_variants: ProductVariant[]
    product_ticket_restrictions: {
        ticket_type_id: string
        ticket_types: { id: string; name: string }
    }[]
}

export function EventProducts() {
    const { event } = useOutletContext<EventContext>()

    const [products, setProducts] = useState<ProductWithRelations[]>([])
    const [ticketTypes, setTicketTypes] = useState<TicketType[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Modal state
    const [showModal, setShowModal] = useState(false)
    const [editingProduct, setEditingProduct] = useState<ProductWithRelations | null>(null)
    const [actionLoading, setActionLoading] = useState<string | null>(null)

    // Fetch products
    const fetchProducts = useCallback(async () => {
        if (!event) return

        const { data, error: fetchError } = await listProducts(event.id)

        if (fetchError) {
            console.error('[EventProducts] Error:', fetchError)
            setError(fetchError.message)
        } else {
            setProducts(data || [])
        }

        setLoading(false)
    }, [event?.id])

    // Fetch ticket types (for restrictions)
    const fetchTicketTypes = useCallback(async () => {
        if (!event) return

        const { data } = await listTickets(event.id)
        if (data) {
            setTicketTypes(data)
        }
    }, [event?.id])

    useEffect(() => {
        fetchProducts()
        fetchTicketTypes()
    }, [fetchProducts, fetchTicketTypes])

    // Open create modal
    const handleCreate = () => {
        setEditingProduct(null)
        setShowModal(true)
    }

    // Open edit modal
    const handleEdit = (product: ProductWithRelations) => {
        setEditingProduct(product)
        setShowModal(true)
    }

    // Toggle active status
    const handleToggleActive = async (product: ProductWithRelations) => {
        setActionLoading(product.id)

        const { error: updateError } = await updateProduct(product.id, {
            is_active: !product.is_active
        })

        if (updateError) {
            setError(updateError.message)
        } else {
            await fetchProducts()
        }

        setActionLoading(null)
    }

    // Delete product
    const handleDelete = async (product: ProductWithRelations) => {
        if (!confirm(`Weet je zeker dat je "${product.name}" wilt verwijderen?`)) return

        setActionLoading(product.id)

        const { error: deleteError } = await deleteProduct(product.id)

        if (deleteError) {
            setError(deleteError.message)
        } else {
            setProducts(prev => prev.filter(p => p.id !== product.id))
        }

        setActionLoading(null)
    }

    // Handle form submit
    const handleFormSubmit = async (payload: CreateProductRequest | UpdateProductRequest, ticketRestrictions?: string[]) => {
        setActionLoading('create')

        if (editingProduct) {
            // Update existing
            const { error: updateError } = await updateProduct(editingProduct.id, payload as UpdateProductRequest)

            if (updateError) {
                setError(updateError.message)
                setActionLoading(null)
                return
            }

            // Update ticket restrictions if provided
            if (ticketRestrictions !== undefined) {
                await setProductTicketRestrictions(editingProduct.id, ticketRestrictions)
            }

            await fetchProducts()
            setShowModal(false)
        } else {
            // Create new
            const createPayload = payload as CreateProductRequest
            createPayload.ticket_type_ids = ticketRestrictions

            const { data, error: createError } = await createProduct(event.id, createPayload)

            if (createError) {
                setError(createError.message)
            } else if (data) {
                await fetchProducts()
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

    // Group products by category
    const ticketUpgrades = products.filter(p => p.category === 'ticket_upgrade')
    const standaloneProducts = products.filter(p => p.category === 'standalone')

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-medium text-gray-900">Producten</h3>
                    <p className="text-sm text-gray-500">Extra's en merchandise voor je evenement.</p>
                </div>
                <button
                    onClick={handleCreate}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700"
                >
                    <Plus className="mr-2 h-4 w-4" />
                    Product toevoegen
                </button>
            </div>

            {/* Error */}
            {error && (
                <div className="bg-red-50 border border-red-200 rounded-md p-3">
                    <p className="text-sm text-red-800">{error}</p>
                    <button onClick={() => setError(null)} className="text-sm text-red-600 underline">Sluiten</button>
                </div>
            )}

            {products.length === 0 ? (
                // Empty State
                <div className="text-center py-12 bg-gray-50 rounded-lg">
                    <Package className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">Geen producten</h3>
                    <p className="mt-1 text-sm text-gray-500">Voeg extra's toe zoals lunch, shirts, of VIP upgrades.</p>
                    <div className="mt-6">
                        <button
                            onClick={handleCreate}
                            className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
                        >
                            <Plus className="-ml-1 mr-2 h-5 w-5" />
                            Product toevoegen
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    {/* Ticket Upgrades Section */}
                    {ticketUpgrades.length > 0 && (
                        <ProductSection
                            title="Ticket upgrades"
                            description="Extra's die alleen bij een ticket gekocht kunnen worden"
                            products={ticketUpgrades}
                            onEdit={handleEdit}
                            onToggleActive={handleToggleActive}
                            onDelete={handleDelete}
                            actionLoading={actionLoading}
                        />
                    )}

                    {/* Standalone Products Section */}
                    {standaloneProducts.length > 0 && (
                        <ProductSection
                            title="Losstaande producten"
                            description="Kunnen los gekocht worden zonder ticket"
                            products={standaloneProducts}
                            onEdit={handleEdit}
                            onToggleActive={handleToggleActive}
                            onDelete={handleDelete}
                            actionLoading={actionLoading}
                        />
                    )}
                </>
            )}

            {/* Create/Edit Modal */}
            {showModal && (
                <ProductModal
                    product={editingProduct}
                    ticketTypes={ticketTypes}
                    loading={actionLoading === 'create'}
                    onSubmit={handleFormSubmit}
                    onClose={() => setShowModal(false)}
                    onRefresh={fetchProducts}
                />
            )}
        </div>
    )
}

// =========================================
// Product Section Component
// =========================================

interface ProductSectionProps {
    title: string
    description: string
    products: ProductWithRelations[]
    onEdit: (product: ProductWithRelations) => void
    onToggleActive: (product: ProductWithRelations) => void
    onDelete: (product: ProductWithRelations) => void
    actionLoading: string | null
}

function ProductSection({
    title,
    description,
    products,
    onEdit,
    onToggleActive,
    onDelete,
    actionLoading
}: ProductSectionProps) {
    return (
        <div>
            <div className="mb-4">
                <h4 className="text-md font-medium text-gray-900">{title}</h4>
                <p className="text-sm text-gray-500">{description}</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {products.map((product) => (
                    <ProductCard
                        key={product.id}
                        product={product}
                        onEdit={() => onEdit(product)}
                        onToggleActive={() => onToggleActive(product)}
                        onDelete={() => onDelete(product)}
                        actionLoading={actionLoading === product.id}
                    />
                ))}
            </div>
        </div>
    )
}

// =========================================
// Product Card Component
// =========================================

interface ProductCardProps {
    product: ProductWithRelations
    onEdit: () => void
    onToggleActive: () => void
    onDelete: () => void
    actionLoading: boolean
}

function ProductCard({ product, onEdit, onToggleActive, onDelete, actionLoading }: ProductCardProps) {
    const onSale = isOnSale(product)
    const variantCount = product.product_variants?.length || 0
    const restrictionCount = product.product_ticket_restrictions?.length || 0

    return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
            {/* Image or Placeholder */}
            <div className="h-32 bg-gray-100 flex items-center justify-center">
                {product.image_url ? (
                    <img
                        src={product.image_url}
                        alt={product.name}
                        className="h-full w-full object-cover"
                    />
                ) : (
                    <Package className="h-12 w-12 text-gray-300" />
                )}
            </div>

            {/* Content */}
            <div className="p-4">
                <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                        <h5 className="text-sm font-medium text-gray-900 truncate">{product.name}</h5>
                        <p className="text-lg font-semibold text-indigo-600">
                            {product.price === 0 ? 'Gratis' : formatPrice(product.price)}
                        </p>
                    </div>
                    <StatusBadge active={product.is_active} onSale={onSale} />
                </div>

                {/* Meta */}
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                    {product.capacity_total !== null && (
                        <span>Capaciteit: {product.capacity_total}</span>
                    )}
                    {variantCount > 0 && (
                        <span className="flex items-center">
                            <Layers className="h-3 w-3 mr-1" />
                            {variantCount} varianten
                        </span>
                    )}
                    {restrictionCount > 0 && (
                        <span className="flex items-center">
                            <Tag className="h-3 w-3 mr-1" />
                            {restrictionCount} ticket types
                        </span>
                    )}
                </div>

                {/* Actions */}
                <div className="mt-4 flex items-center justify-end space-x-2">
                    <button
                        onClick={onToggleActive}
                        disabled={actionLoading}
                        className={clsx(
                            'p-1.5 rounded',
                            product.is_active
                                ? 'text-yellow-600 hover:bg-yellow-50'
                                : 'text-green-600 hover:bg-green-50',
                            'disabled:opacity-50'
                        )}
                        title={product.is_active ? 'Deactiveren' : 'Activeren'}
                    >
                        {actionLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : product.is_active ? (
                            <XCircle className="h-4 w-4" />
                        ) : (
                            <CheckCircle className="h-4 w-4" />
                        )}
                    </button>
                    <button
                        onClick={onEdit}
                        className="p-1.5 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50"
                        title="Bewerken"
                    >
                        <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                        onClick={onDelete}
                        disabled={actionLoading}
                        className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                        title="Verwijderen"
                    >
                        <Trash2 className="h-4 w-4" />
                    </button>
                </div>
            </div>
        </div>
    )
}

// =========================================
// Status Badge
// =========================================

function StatusBadge({ active, onSale }: { active: boolean; onSale: boolean }) {
    if (!active) {
        return (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                Inactief
            </span>
        )
    }

    if (!onSale) {
        return (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                Niet te koop
            </span>
        )
    }

    return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
            Te koop
        </span>
    )
}

// =========================================
// Product Modal (Create/Edit)
// =========================================

interface ProductModalProps {
    product: ProductWithRelations | null
    ticketTypes: TicketType[]
    loading: boolean
    onSubmit: (payload: CreateProductRequest | UpdateProductRequest, ticketRestrictions?: string[]) => void
    onClose: () => void
    onRefresh: () => void
}

function ProductModal({ product, ticketTypes, loading, onSubmit, onClose, onRefresh }: ProductModalProps) {
    const isEdit = !!product

    // Active tab
    const [activeTab, setActiveTab] = useState<'basic' | 'pricing' | 'variants' | 'restrictions'>('basic')

    // Form state
    const [category, setCategory] = useState<ProductCategory>(product?.category || 'standalone')
    const [name, setName] = useState(product?.name || '')
    const [description, setDescription] = useState(product?.description || '')
    const [instructions, setInstructions] = useState(product?.instructions || '')
    const [imageUrl, setImageUrl] = useState(product?.image_url || '')
    const [price, setPrice] = useState(product?.price?.toString() || '0')
    const [vatPercentage, setVatPercentage] = useState(product?.vat_percentage?.toString() || '21')
    const [capacityTotal, setCapacityTotal] = useState(product?.capacity_total?.toString() || '')
    const [maxPerOrder, setMaxPerOrder] = useState(product?.max_per_order?.toString() || '10')
    const [salesStart, setSalesStart] = useState(
        product?.sales_start ? product.sales_start.slice(0, 16) : ''
    )
    const [salesEnd, setSalesEnd] = useState(
        product?.sales_end ? product.sales_end.slice(0, 16) : ''
    )
    const [isActive, setIsActive] = useState(product?.is_active ?? true)

    // Ticket restrictions
    const [selectedTicketTypes, setSelectedTicketTypes] = useState<string[]>(
        product?.product_ticket_restrictions?.map(r => r.ticket_type_id) || []
    )

    // Variants
    const [variants, setVariants] = useState<ProductVariant[]>(product?.product_variants || [])
    const [newVariantName, setNewVariantName] = useState('')
    const [newVariantCapacity, setNewVariantCapacity] = useState('')
    const [variantLoading, setVariantLoading] = useState<string | null>(null)

    const [formError, setFormError] = useState<string | null>(null)

    const tabs = [
        { id: 'basic', label: 'Basisinformatie', icon: Package },
        { id: 'pricing', label: 'Prijzen', icon: Tag },
        { id: 'variants', label: 'Varianten', icon: Layers },
        ...(category === 'ticket_upgrade' ? [{ id: 'restrictions', label: 'Beperkingen', icon: Settings2 }] : [])
    ] as const

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

        const vatNum = parseFloat(vatPercentage)
        if (isNaN(vatNum) || vatNum < 0 || vatNum > 100) {
            setFormError('BTW moet tussen 0 en 100% zijn')
            return
        }

        // Validate sales window
        if (salesStart && salesEnd) {
            if (new Date(salesEnd) < new Date(salesStart)) {
                setFormError('Einddatum verkoop moet na startdatum zijn')
                return
            }
        }

        const payload: CreateProductRequest | UpdateProductRequest = {
            category,
            name: name.trim(),
            description: description.trim() || null,
            instructions: instructions.trim() || null,
            image_url: imageUrl.trim() || null,
            price: priceNum,
            vat_percentage: vatNum,
            capacity_total: capacityTotal ? parseInt(capacityTotal, 10) : null,
            max_per_order: parseInt(maxPerOrder, 10) || 10,
            sales_start: salesStart ? new Date(salesStart).toISOString() : null,
            sales_end: salesEnd ? new Date(salesEnd).toISOString() : null,
            is_active: isActive
        }

        onSubmit(payload, category === 'ticket_upgrade' ? selectedTicketTypes : undefined)
    }

    // Add variant
    const handleAddVariant = async () => {
        if (!product || !newVariantName.trim()) return

        setVariantLoading('add')

        const { data, error } = await createProductVariant(product.id, {
            name: newVariantName.trim(),
            capacity_total: newVariantCapacity ? parseInt(newVariantCapacity, 10) : null
        })

        if (error) {
            setFormError(error.message)
        } else if (data) {
            setNewVariantName('')
            setNewVariantCapacity('')
            onRefresh()
        }

        setVariantLoading(null)
    }

    // Delete variant
    const handleDeleteVariant = async (variantId: string) => {
        if (!confirm('Weet je zeker dat je deze variant wilt verwijderen?')) return

        setVariantLoading(variantId)

        const { error } = await deleteProductVariant(variantId)

        if (error) {
            setFormError(error.message)
        } else {
            setVariants(prev => prev.filter(v => v.id !== variantId))
            onRefresh()
        }

        setVariantLoading(null)
    }

    return (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-medium text-gray-900">
                        {isEdit ? 'Product bewerken' : 'Nieuw product'}
                    </h3>
                </div>

                {/* Tabs */}
                <div className="border-b border-gray-200">
                    <nav className="flex -mb-px px-6">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as any)}
                                className={clsx(
                                    'py-3 px-4 text-sm font-medium border-b-2 flex items-center',
                                    activeTab === tab.id
                                        ? 'border-indigo-500 text-indigo-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                )}
                            >
                                <tab.icon className="h-4 w-4 mr-2" />
                                {tab.label}
                            </button>
                        ))}
                    </nav>
                </div>

                {/* Content */}
                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
                    <div className="px-6 py-4">
                        {/* Basic Tab */}
                        {activeTab === 'basic' && (
                            <div className="space-y-4">
                                {/* Category */}
                                {!isEdit && (
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Type</label>
                                        <select
                                            value={category}
                                            onChange={(e) => setCategory(e.target.value as ProductCategory)}
                                            className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                        >
                                            <option value="standalone">Losstaand product</option>
                                            <option value="ticket_upgrade">Ticket upgrade</option>
                                        </select>
                                        <p className="mt-1 text-xs text-gray-500">
                                            {category === 'ticket_upgrade'
                                                ? 'Kan alleen gekocht worden met een ticket'
                                                : 'Kan los gekocht worden zonder ticket'}
                                        </p>
                                    </div>
                                )}

                                {/* Name */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">
                                        Naam <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder="Bijv. Event T-shirt, VIP Upgrade, Lunch pakket"
                                        className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                        required
                                    />
                                </div>

                                {/* Description */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Beschrijving</label>
                                    <textarea
                                        value={description}
                                        onChange={(e) => setDescription(e.target.value)}
                                        rows={3}
                                        placeholder="Beschrijf het product..."
                                        className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                    />
                                </div>

                                {/* Instructions */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Instructies</label>
                                    <textarea
                                        value={instructions}
                                        onChange={(e) => setInstructions(e.target.value)}
                                        rows={2}
                                        placeholder="Instructies na aankoop (bijv. afhaallocatie, maat doorgeven)"
                                        className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                    />
                                </div>

                                {/* Image URL */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Afbeelding URL</label>
                                    <div className="mt-1 flex items-center space-x-3">
                                        <input
                                            type="url"
                                            value={imageUrl}
                                            onChange={(e) => setImageUrl(e.target.value)}
                                            placeholder="https://..."
                                            className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                        />
                                        {imageUrl && (
                                            <img
                                                src={imageUrl}
                                                alt="Preview"
                                                className="h-10 w-10 rounded object-cover"
                                                onError={(e) => (e.currentTarget.style.display = 'none')}
                                            />
                                        )}
                                    </div>
                                </div>

                                {/* Active */}
                                <div className="flex items-center">
                                    <input
                                        type="checkbox"
                                        checked={isActive}
                                        onChange={(e) => setIsActive(e.target.checked)}
                                        className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                                    />
                                    <label className="ml-2 block text-sm text-gray-900">
                                        Product is actief
                                    </label>
                                </div>
                            </div>
                        )}

                        {/* Pricing Tab */}
                        {activeTab === 'pricing' && (
                            <div className="space-y-4">
                                {/* Price */}
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
                                </div>

                                {/* VAT */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">BTW percentage</label>
                                    <div className="mt-1 relative rounded-md shadow-sm">
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            max="100"
                                            value={vatPercentage}
                                            onChange={(e) => setVatPercentage(e.target.value)}
                                            className="block w-full pr-8 border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                        />
                                        <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                            <span className="text-gray-500 sm:text-sm">%</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Capacity */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Capaciteit</label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={capacityTotal}
                                        onChange={(e) => setCapacityTotal(e.target.value)}
                                        placeholder="Leeg = onbeperkt"
                                        className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                    />
                                    <p className="mt-1 text-xs text-gray-500">Laat leeg voor onbeperkte voorraad</p>
                                </div>

                                {/* Max per order */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Max per bestelling</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={maxPerOrder}
                                        onChange={(e) => setMaxPerOrder(e.target.value)}
                                        className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                    />
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
                            </div>
                        )}

                        {/* Variants Tab */}
                        {activeTab === 'variants' && (
                            <div className="space-y-4">
                                <p className="text-sm text-gray-500">
                                    Voeg varianten toe zoals maten (S, M, L, XL) of kleuren.
                                    Elke variant kan een eigen capaciteit hebben.
                                </p>

                                {/* Existing Variants */}
                                {variants.length > 0 && (
                                    <div className="space-y-2">
                                        {variants.map((variant) => (
                                            <div
                                                key={variant.id}
                                                className="flex items-center justify-between p-3 bg-gray-50 rounded-md"
                                            >
                                                <div>
                                                    <span className="text-sm font-medium text-gray-900">{variant.name}</span>
                                                    {variant.capacity_total !== null && (
                                                        <span className="ml-2 text-xs text-gray-500">
                                                            (capaciteit: {variant.capacity_total})
                                                        </span>
                                                    )}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteVariant(variant.id)}
                                                    disabled={variantLoading === variant.id}
                                                    className="text-red-600 hover:text-red-800 disabled:opacity-50"
                                                >
                                                    {variantLoading === variant.id ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <Trash2 className="h-4 w-4" />
                                                    )}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Add Variant (only for existing products) */}
                                {isEdit && (
                                    <div className="flex items-end space-x-3 pt-4 border-t border-gray-200">
                                        <div className="flex-1">
                                            <label className="block text-sm font-medium text-gray-700">Naam</label>
                                            <input
                                                type="text"
                                                value={newVariantName}
                                                onChange={(e) => setNewVariantName(e.target.value)}
                                                placeholder="Bijv. Maat M"
                                                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                            />
                                        </div>
                                        <div className="w-32">
                                            <label className="block text-sm font-medium text-gray-700">Capaciteit</label>
                                            <input
                                                type="number"
                                                min="0"
                                                value={newVariantCapacity}
                                                onChange={(e) => setNewVariantCapacity(e.target.value)}
                                                placeholder="Leeg"
                                                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleAddVariant}
                                            disabled={!newVariantName.trim() || variantLoading === 'add'}
                                            className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                                        >
                                            {variantLoading === 'add' ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <Plus className="h-4 w-4" />
                                            )}
                                        </button>
                                    </div>
                                )}

                                {!isEdit && (
                                    <p className="text-sm text-yellow-600 bg-yellow-50 p-3 rounded">
                                        Sla eerst het product op, daarna kun je varianten toevoegen.
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Restrictions Tab (only for ticket_upgrade) */}
                        {activeTab === 'restrictions' && category === 'ticket_upgrade' && (
                            <div className="space-y-4">
                                <p className="text-sm text-gray-500">
                                    Selecteer welke ticket types dit product kunnen kopen.
                                    Als er geen tickets zijn geselecteerd, kan niemand dit product kopen.
                                </p>

                                {ticketTypes.length === 0 ? (
                                    <p className="text-sm text-yellow-600 bg-yellow-50 p-3 rounded">
                                        Maak eerst ticket types aan voordat je restricties kunt instellen.
                                    </p>
                                ) : (
                                    <div className="space-y-2">
                                        {ticketTypes.map((ticket) => (
                                            <label
                                                key={ticket.id}
                                                className="flex items-center p-3 bg-gray-50 rounded-md cursor-pointer hover:bg-gray-100"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedTicketTypes.includes(ticket.id)}
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            setSelectedTicketTypes(prev => [...prev, ticket.id])
                                                        } else {
                                                            setSelectedTicketTypes(prev => prev.filter(id => id !== ticket.id))
                                                        }
                                                    }}
                                                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                                                />
                                                <span className="ml-3 text-sm text-gray-900">{ticket.name}</span>
                                                <span className="ml-2 text-xs text-gray-500">
                                                    ({formatPrice(ticket.price)})
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Error */}
                        {formError && (
                            <div className="mt-4 bg-red-50 border border-red-200 rounded-md p-3">
                                <p className="text-sm text-red-800">{formError}</p>
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="px-6 py-4 bg-gray-50 flex justify-end space-x-3">
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
