/**
 * F015 Products Module Types
 *
 * TypeScript types for products, variants, and restrictions.
 * Generated from supabase/migrations/20260202100000_f015_products.sql
 */

// =========================================
// ENUMS
// =========================================

export type ProductCategory = 'ticket_upgrade' | 'standalone';

export type SalesStatus = 'not_started' | 'active' | 'ended';

// =========================================
// DATABASE MODELS
// =========================================

export interface Product {
  id: string;
  event_id: string;
  org_id: string;
  category: ProductCategory;
  name: string;
  description: string | null;
  instructions: string | null;
  image_url: string | null;
  price: number;
  vat_percentage: number;
  capacity_total: number | null;
  max_per_order: number;
  sales_start: string | null;
  sales_end: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  name: string;
  capacity_total: number | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface ProductTicketRestriction {
  id: string;
  product_id: string;
  ticket_type_id: string;
  created_at: string;
}

// =========================================
// VIEW MODELS
// =========================================

export interface ProductStats {
  product_id: string;
  event_id: string;
  org_id: string;
  name: string;
  category: ProductCategory;
  price: number;
  capacity_total: number | null;
  units_sold: number;
  total_quantity_sold: number;
  total_revenue: number;
  total_quantity_pending: number;
  available_capacity: number | null;
  sales_status: SalesStatus;
}

export interface ProductVariantStats {
  variant_id: string;
  product_id: string;
  variant_name: string;
  variant_capacity: number | null;
  units_sold: number;
  units_pending: number;
  available_capacity: number | null;
}

// =========================================
// API REQUEST/RESPONSE TYPES
// =========================================

export interface CreateProductRequest {
  category: ProductCategory;
  name: string;
  description?: string | null;
  instructions?: string | null;
  image_url?: string | null;
  price?: number;
  vat_percentage?: number;
  capacity_total?: number | null;
  max_per_order?: number;
  sales_start?: string | null;
  sales_end?: string | null;
  sort_order?: number;
  is_active?: boolean;
  ticket_type_ids?: string[];
}

export interface UpdateProductRequest {
  name?: string;
  description?: string | null;
  instructions?: string | null;
  image_url?: string | null;
  price?: number;
  vat_percentage?: number;
  capacity_total?: number | null;
  max_per_order?: number;
  sales_start?: string | null;
  sales_end?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export interface CreateProductVariantRequest {
  name: string;
  capacity_total?: number | null;
  sort_order?: number;
  is_active?: boolean;
}

export interface UpdateProductVariantRequest {
  name?: string;
  capacity_total?: number | null;
  is_active?: boolean;
  sort_order?: number;
}

export interface SetProductTicketRestrictionsRequest {
  product_id: string;
  ticket_type_ids: string[];
}

// =========================================
// PUBLIC API TYPES (get_public_products)
// =========================================

export interface PublicProductVariant {
  id: string;
  name: string;
  capacity_total: number | null;
  available_capacity: number | null;
  sort_order: number;
}

export interface PublicProduct {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  image_url: string | null;
  price: number;
  vat_percentage: number;
  category: ProductCategory;
  max_per_order: number;
  available_capacity: number | null;
  sales_start: string | null;
  sales_end: string | null;
  variants: PublicProductVariant[];
}

// =========================================
// CHECKOUT TYPES (extend existing)
// =========================================

export interface OrderItemProduct {
  product_id: string;
  product_variant_id?: string;
  quantity: number;
}

export interface OrderItemTicket {
  ticket_type_id: string;
  quantity: number;
}

export type OrderItem = OrderItemProduct | OrderItemTicket;

// Type guards
export function isProductOrderItem(item: OrderItem): item is OrderItemProduct {
  return 'product_id' in item;
}

export function isTicketOrderItem(item: OrderItem): item is OrderItemTicket {
  return 'ticket_type_id' in item;
}

// =========================================
// HELPER TYPES
// =========================================

export interface ProductFormData {
  name: string;
  description: string;
  instructions: string;
  category: ProductCategory;
  price: number;
  vat_percentage: number;
  capacity_total: number | null;
  max_per_order: number;
  sales_start: Date | null;
  sales_end: Date | null;
  image_url: string;
  ticket_type_ids: string[];
}

export interface ProductVariantFormData {
  name: string;
  capacity_total: number | null;
  sort_order: number;
}

// =========================================
// VALIDATION HELPERS
// =========================================

export function validateProductPrice(price: number): boolean {
  return price >= 0;
}

export function validateProductCapacity(capacity: number | null): boolean {
  return capacity === null || capacity >= 0;
}

export function validateSalesWindow(
  start: string | null,
  end: string | null
): boolean {
  if (!start || !end) return true;
  return new Date(start) < new Date(end);
}

export function isProductAvailable(product: PublicProduct): boolean {
  const now = new Date();

  // Check sales window
  if (product.sales_start && new Date(product.sales_start) > now) {
    return false;
  }

  if (product.sales_end && new Date(product.sales_end) < now) {
    return false;
  }

  // Check capacity
  if (
    product.available_capacity !== null &&
    product.available_capacity <= 0
  ) {
    return false;
  }

  return true;
}

export function getProductDisplayPrice(product: PublicProduct): string {
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
  }).format(product.price);
}

export function calculateProductLineTotal(
  price: number,
  quantity: number
): number {
  return Math.round(price * quantity * 100) / 100;
}
