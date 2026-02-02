# Sprint S1: Products Data Layer

**Flow**: F015 Products
**Sprint**: S1
**Focus**: Database + RPCs
**Status**: 🟢 Implementation Complete - Ready for Testing

## Deliverables

### 1. Database Tables

#### `products`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `event_id` | UUID | FK to events |
| `category` | ENUM | 'ticket_upgrade' or 'standalone' |
| `name` | TEXT | Product name |
| `description` | TEXT | Rich description |
| `instructions` | TEXT | Post-purchase instructions |
| `image_url` | TEXT | Product image URL |
| `price` | NUMERIC(10,2) | Base price |
| `vat_percentage` | NUMERIC(4,2) | VAT % (default 21) |
| `capacity_total` | INTEGER | Max quantity (NULL = unlimited) |
| `max_per_order` | INTEGER | Max per order (default 10) |
| `sales_start` | TIMESTAMPTZ | Sales window start |
| `sales_end` | TIMESTAMPTZ | Sales window end |
| `sort_order` | INTEGER | Display order |
| `is_active` | BOOLEAN | Active/inactive |
| `created_at` | TIMESTAMPTZ | Timestamp |
| `updated_at` | TIMESTAMPTZ | Timestamp |
| `deleted_at` | TIMESTAMPTZ | Soft delete |

#### `product_variants`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `product_id` | UUID | FK to products |
| `name` | TEXT | Variant name (e.g., "Maat M") |
| `capacity_total` | INTEGER | Variant capacity (NULL = unlimited) |
| `sort_order` | INTEGER | Display order |
| `is_active` | BOOLEAN | Active/inactive |
| `created_at` | TIMESTAMPTZ | Timestamp |

#### `product_ticket_restrictions`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `product_id` | UUID | FK to products |
| `ticket_type_id` | UUID | FK to ticket_types |
| `created_at` | TIMESTAMPTZ | Timestamp |

### 2. ENUM Type
```sql
CREATE TYPE product_category AS ENUM ('ticket_upgrade', 'standalone');
```

### 3. Extended order_items
Add `product_id` and `product_variant_id` columns to existing `order_items` table.

### 4. Views

#### `v_product_stats`
- Aggregated sales/capacity per product
- Used for dashboard

### 5. RPCs

| RPC | Purpose | Auth |
|-----|---------|------|
| `create_product` | Create new product | admin |
| `update_product` | Update product | admin |
| `delete_product` | Soft delete | admin |
| `list_products` | List products for event | org_member |
| `get_product` | Get single product | org_member |
| `get_public_products` | Public products for checkout | anon |
| `create_product_variant` | Add variant | admin |
| `update_product_variant` | Update variant | admin |
| `delete_product_variant` | Delete variant | admin |
| `set_product_ticket_restrictions` | Set allowed tickets | admin |

### 6. RLS Policies

| Policy | Table | Rule |
|--------|-------|------|
| Public view | products | Published events, is_active, in sales window |
| Org member view | products | User is org member |
| Admin manage | products | User is admin/owner |
| Similar for variants | product_variants | Inherit from product |
| Restrictions | product_ticket_restrictions | Admin only |

## Checkout Integration

The existing `create-order-public` Edge Function needs to be extended:
1. Accept `products` array in request body
2. Validate product availability
3. Validate ticket restrictions (upgrade products)
4. Reserve capacity with FOR UPDATE SKIP LOCKED
5. Add to order_items with product_id

## Migration File
`20260202100000_f015_products.sql`

## Test Scenarios

1. Create product (ticket_upgrade)
2. Create product (standalone)
3. Add variants to product
4. Set ticket restrictions
5. Anonymous cannot create products
6. Anonymous can view public products
7. Org member can view all products
8. Capacity tracking works
9. Sales window enforced
10. Checkout with product works

## Dependencies

- Events table exists ✅
- Ticket_types table exists ✅
- Orders/order_items tables exist ✅

## Estimated Work

| Component | Complexity |
|-----------|------------|
| Migration SQL | Medium |
| RPCs | Medium |
| RLS | Medium |
| Checkout extension | Low |
| Tests | Medium |

---
*Created: 2026-02-02*
