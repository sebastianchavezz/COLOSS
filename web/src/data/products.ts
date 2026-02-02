/**
 * Products Data Layer
 *
 * CRUD operations for products, variants, and restrictions.
 * Uses Supabase RPCs for write operations (RLS enforced).
 */

import { supabase } from '../lib/supabase'
import type {
    Product,
    ProductVariant,
    ProductTicketRestriction,
    ProductCategory,
    CreateProductRequest,
    UpdateProductRequest,
    CreateProductVariantRequest,
    UpdateProductVariantRequest,
    PublicProduct
} from '../types/products'

// =========================================
// PRODUCT CRUD
// =========================================

/**
 * List all products for an event (org member view)
 */
export async function listProducts(eventId: string) {
    const { data, error } = await supabase
        .from('products')
        .select(`
            *,
            product_variants (*),
            product_ticket_restrictions (
                ticket_type_id,
                ticket_types (id, name)
            )
        `)
        .eq('event_id', eventId)
        .is('deleted_at', null)
        .order('sort_order', { ascending: true })

    return { data: data as (Product & {
        product_variants: ProductVariant[],
        product_ticket_restrictions: (ProductTicketRestriction & { ticket_types: { id: string, name: string } })[]
    })[] | null, error }
}

/**
 * Get single product by ID
 */
export async function getProduct(productId: string) {
    const { data, error } = await supabase
        .from('products')
        .select(`
            *,
            product_variants (*),
            product_ticket_restrictions (
                ticket_type_id,
                ticket_types (id, name)
            )
        `)
        .eq('id', productId)
        .single()

    return { data: data as Product & {
        product_variants: ProductVariant[],
        product_ticket_restrictions: (ProductTicketRestriction & { ticket_types: { id: string, name: string } })[]
    } | null, error }
}

/**
 * Create a new product via RPC (with direct insert fallback for schema cache issues)
 */
export async function createProduct(
    eventId: string,
    payload: CreateProductRequest
) {
    // Try RPC first
    const { data: rpcData, error: rpcError } = await supabase.rpc('create_product', {
        _event_id: eventId,
        _category: payload.category,
        _name: payload.name,
        _description: payload.description || null,
        _instructions: payload.instructions || null,
        _image_url: payload.image_url || null,
        _price: payload.price,
        _vat_percentage: payload.vat_percentage ?? 21,
        _capacity_total: payload.capacity_total ?? null,
        _max_per_order: payload.max_per_order ?? 10,
        _sales_start: payload.sales_start || null,
        _sales_end: payload.sales_end || null,
        _sort_order: payload.sort_order ?? 0,
        _is_active: payload.is_active ?? true,
        _ticket_type_ids: payload.ticket_type_ids || null
    })

    // If RPC works, return result
    if (!rpcError) {
        if (rpcData?.error) {
            return { data: null, error: new Error(rpcData.message || rpcData.error) }
        }
        return { data: rpcData as { id: string }, error: null }
    }

    // Fallback: Direct insert if RPC not in schema cache (404/PGRST202)
    if (rpcError.code === 'PGRST202' || rpcError.message?.includes('schema cache')) {
        console.warn('[createProduct] RPC not in schema cache, using direct insert fallback')

        // First get org_id from event
        const { data: event } = await supabase
            .from('events')
            .select('org_id')
            .eq('id', eventId)
            .single()

        if (!event?.org_id) {
            return { data: null, error: new Error('Event not found') }
        }

        // Insert directly
        const { data: insertData, error: insertError } = await supabase
            .from('products')
            .insert({
                event_id: eventId,
                org_id: event.org_id,
                category: payload.category,
                name: payload.name,
                description: payload.description || null,
                instructions: payload.instructions || null,
                image_url: payload.image_url || null,
                price: payload.price,
                vat_percentage: payload.vat_percentage ?? 21,
                capacity_total: payload.capacity_total ?? null,
                max_per_order: payload.max_per_order ?? 10,
                sales_start: payload.sales_start || null,
                sales_end: payload.sales_end || null,
                sort_order: payload.sort_order ?? 0,
                is_active: payload.is_active ?? true
            })
            .select('id')
            .single()

        if (insertError) {
            return { data: null, error: insertError }
        }

        // Handle ticket restrictions separately if provided
        if (payload.ticket_type_ids?.length && insertData?.id) {
            const restrictions = payload.ticket_type_ids.map(ttId => ({
                product_id: insertData.id,
                ticket_type_id: ttId
            }))
            await supabase.from('product_ticket_restrictions').insert(restrictions)
        }

        return { data: { id: insertData.id }, error: null }
    }

    return { data: null, error: rpcError }
}

/**
 * Update product via RPC (with direct update fallback)
 */
export async function updateProduct(
    productId: string,
    payload: UpdateProductRequest
) {
    const { data, error } = await supabase.rpc('update_product', {
        _product_id: productId,
        _name: payload.name ?? null,
        _description: payload.description,
        _instructions: payload.instructions,
        _image_url: payload.image_url,
        _price: payload.price ?? null,
        _vat_percentage: payload.vat_percentage ?? null,
        _capacity_total: payload.capacity_total,
        _max_per_order: payload.max_per_order ?? null,
        _sales_start: payload.sales_start,
        _sales_end: payload.sales_end,
        _sort_order: payload.sort_order ?? null,
        _is_active: payload.is_active ?? null
    })

    if (!error) {
        if (data?.error) {
            return { data: null, error: new Error(data.message || data.error) }
        }
        return { data: data as { success: boolean }, error: null }
    }

    // Fallback: Direct update if RPC not in schema cache
    if (error.code === 'PGRST202' || error.message?.includes('schema cache')) {
        console.warn('[updateProduct] RPC not in schema cache, using direct update fallback')

        const updateData: Record<string, any> = {}
        if (payload.name !== undefined) updateData.name = payload.name
        if (payload.description !== undefined) updateData.description = payload.description
        if (payload.instructions !== undefined) updateData.instructions = payload.instructions
        if (payload.image_url !== undefined) updateData.image_url = payload.image_url
        if (payload.price !== undefined) updateData.price = payload.price
        if (payload.vat_percentage !== undefined) updateData.vat_percentage = payload.vat_percentage
        if (payload.capacity_total !== undefined) updateData.capacity_total = payload.capacity_total
        if (payload.max_per_order !== undefined) updateData.max_per_order = payload.max_per_order
        if (payload.sales_start !== undefined) updateData.sales_start = payload.sales_start
        if (payload.sales_end !== undefined) updateData.sales_end = payload.sales_end
        if (payload.sort_order !== undefined) updateData.sort_order = payload.sort_order
        if (payload.is_active !== undefined) updateData.is_active = payload.is_active

        const { error: updateError } = await supabase
            .from('products')
            .update(updateData)
            .eq('id', productId)

        if (updateError) {
            return { data: null, error: updateError }
        }

        return { data: { success: true }, error: null }
    }

    return { data: null, error }
}

/**
 * Soft delete product via RPC (with direct update fallback)
 */
export async function deleteProduct(productId: string) {
    const { data, error } = await supabase.rpc('delete_product', {
        _product_id: productId
    })

    if (!error) {
        if (data?.error) {
            return { success: false, error: new Error(data.message || data.error) }
        }
        return { success: true, error: null }
    }

    // Fallback: Direct soft delete if RPC not in schema cache
    if (error.code === 'PGRST202' || error.message?.includes('schema cache')) {
        console.warn('[deleteProduct] RPC not in schema cache, using direct update fallback')

        const { error: deleteError } = await supabase
            .from('products')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', productId)

        if (deleteError) {
            return { success: false, error: deleteError }
        }

        return { success: true, error: null }
    }

    return { success: false, error }
}

// =========================================
// VARIANT CRUD
// =========================================

/**
 * Create a product variant (with direct insert fallback)
 */
export async function createProductVariant(
    productId: string,
    payload: CreateProductVariantRequest
) {
    const { data, error } = await supabase.rpc('create_product_variant', {
        _product_id: productId,
        _name: payload.name,
        _capacity_total: payload.capacity_total ?? null,
        _sort_order: payload.sort_order ?? 0,
        _is_active: payload.is_active ?? true
    })

    if (!error) {
        if (data?.error) {
            return { data: null, error: new Error(data.message || data.error) }
        }
        return { data: data as { id: string }, error: null }
    }

    // Fallback: Direct insert if RPC not in schema cache
    if (error.code === 'PGRST202' || error.message?.includes('schema cache')) {
        console.warn('[createProductVariant] RPC not in schema cache, using direct insert fallback')

        const { data: insertData, error: insertError } = await supabase
            .from('product_variants')
            .insert({
                product_id: productId,
                name: payload.name,
                capacity_total: payload.capacity_total ?? null,
                sort_order: payload.sort_order ?? 0,
                is_active: payload.is_active ?? true
            })
            .select('id')
            .single()

        if (insertError) {
            return { data: null, error: insertError }
        }

        return { data: { id: insertData.id }, error: null }
    }

    return { data: null, error }
}

/**
 * Update a product variant (with direct update fallback)
 */
export async function updateProductVariant(
    variantId: string,
    payload: UpdateProductVariantRequest
) {
    const { data, error } = await supabase.rpc('update_product_variant', {
        _variant_id: variantId,
        _name: payload.name ?? null,
        _capacity_total: payload.capacity_total,
        _sort_order: payload.sort_order ?? null,
        _is_active: payload.is_active ?? null
    })

    if (!error) {
        if (data?.error) {
            return { data: null, error: new Error(data.message || data.error) }
        }
        return { data: data as { success: boolean }, error: null }
    }

    // Fallback: Direct update if RPC not in schema cache
    if (error.code === 'PGRST202' || error.message?.includes('schema cache')) {
        console.warn('[updateProductVariant] RPC not in schema cache, using direct update fallback')

        const updateData: Record<string, any> = {}
        if (payload.name !== undefined) updateData.name = payload.name
        if (payload.capacity_total !== undefined) updateData.capacity_total = payload.capacity_total
        if (payload.sort_order !== undefined) updateData.sort_order = payload.sort_order
        if (payload.is_active !== undefined) updateData.is_active = payload.is_active

        const { error: updateError } = await supabase
            .from('product_variants')
            .update(updateData)
            .eq('id', variantId)

        if (updateError) {
            return { data: null, error: updateError }
        }

        return { data: { success: true }, error: null }
    }

    return { data: null, error }
}

/**
 * Delete a product variant (with direct delete fallback)
 */
export async function deleteProductVariant(variantId: string) {
    const { data, error } = await supabase.rpc('delete_product_variant', {
        _variant_id: variantId
    })

    if (!error) {
        if (data?.error) {
            return { success: false, error: new Error(data.message || data.error) }
        }
        return { success: data?.deleted || data?.deactivated || false, error: null }
    }

    // Fallback: Direct delete if RPC not in schema cache
    if (error.code === 'PGRST202' || error.message?.includes('schema cache')) {
        console.warn('[deleteProductVariant] RPC not in schema cache, using direct delete fallback')

        const { error: deleteError } = await supabase
            .from('product_variants')
            .delete()
            .eq('id', variantId)

        if (deleteError) {
            return { success: false, error: deleteError }
        }

        return { success: true, error: null }
    }

    return { success: false, error }
}

// =========================================
// TICKET RESTRICTIONS
// =========================================

/**
 * Set which tickets can purchase this product (with direct operations fallback)
 */
export async function setProductTicketRestrictions(
    productId: string,
    ticketTypeIds: string[]
) {
    const { data, error } = await supabase.rpc('set_product_ticket_restrictions', {
        _product_id: productId,
        _ticket_type_ids: ticketTypeIds
    })

    if (!error) {
        if (data?.error) {
            return { success: false, error: new Error(data.message || data.error) }
        }
        return { success: true, error: null }
    }

    // Fallback: Direct delete + insert if RPC not in schema cache
    if (error.code === 'PGRST202' || error.message?.includes('schema cache')) {
        console.warn('[setProductTicketRestrictions] RPC not in schema cache, using direct operations fallback')

        // Delete existing
        await supabase
            .from('product_ticket_restrictions')
            .delete()
            .eq('product_id', productId)

        // Insert new
        if (ticketTypeIds.length > 0) {
            const restrictions = ticketTypeIds.map(ttId => ({
                product_id: productId,
                ticket_type_id: ttId
            }))
            const { error: insertError } = await supabase
                .from('product_ticket_restrictions')
                .insert(restrictions)

            if (insertError) {
                return { success: false, error: insertError }
            }
        }

        return { success: true, error: null }
    }

    return { success: false, error }
}

// =========================================
// PUBLIC API (for checkout)
// =========================================

/**
 * Get public products for checkout
 */
export async function getPublicProducts(eventId: string, ticketTypeIds?: string[]) {
    const { data, error } = await supabase.rpc('get_public_products', {
        _event_id: eventId,
        _ticket_type_ids: ticketTypeIds || null
    })

    if (error) {
        return { data: null, error }
    }

    if (data?.error) {
        return { data: null, error: new Error(data.message || data.error) }
    }

    return { data: data?.products as PublicProduct[] | null, error: null }
}

// =========================================
// STATS (from views)
// =========================================

/**
 * Get product stats for an event
 */
export async function getProductStats(eventId: string) {
    const { data, error } = await supabase
        .from('v_product_stats')
        .select('*')
        .eq('event_id', eventId)

    return { data, error }
}

/**
 * Get variant stats for a product
 */
export async function getVariantStats(productId: string) {
    const { data, error } = await supabase
        .from('v_product_variant_stats')
        .select('*')
        .eq('product_id', productId)

    return { data, error }
}

// =========================================
// HELPERS
// =========================================

/**
 * Format price for display
 */
export function formatPrice(price: number, currency = 'EUR'): string {
    return new Intl.NumberFormat('nl-NL', {
        style: 'currency',
        currency
    }).format(price)
}

/**
 * Get category label in Dutch
 */
export function getCategoryLabel(category: ProductCategory): string {
    return category === 'ticket_upgrade' ? 'Ticket upgrade' : 'Losstaand product'
}

/**
 * Check if product is currently on sale
 */
export function isOnSale(product: { sales_start: string | null; sales_end: string | null; is_active: boolean }): boolean {
    if (!product.is_active) return false

    const now = new Date()

    if (product.sales_start && new Date(product.sales_start) > now) {
        return false // Not started yet
    }

    if (product.sales_end && new Date(product.sales_end) < now) {
        return false // Already ended
    }

    return true
}
