# S4: Products Integration - Plan

**Sprint**: S4
**Focus**: Integrate F015 Products into checkout flow
**Status**: 🟡 In Progress

## Overview

Upgrade the checkout flow to allow purchasing products (upgrades, merchandise) alongside tickets.

## Requirements

1. **Accept products in checkout request**
   - New item type: `{product_id, variant_id?, quantity}`
   - Existing ticket items still supported
   - Mixed cart (tickets + products) supported

2. **Validate products server-side**
   - Product must exist and be active
   - Product must belong to same event
   - Sales window check (sales_start/sales_end)
   - Capacity check (product-level and variant-level)
   - max_per_order limit respected
   - **ticket_upgrade** restriction: cart must contain allowed ticket_type

3. **Atomic capacity locking**
   - Products locked with FOR UPDATE SKIP LOCKED
   - Same pattern as ticket capacity validation

4. **Price calculation**
   - Server-calculated prices (never trust client)
   - Include VAT from product.vat_percentage

5. **Order items**
   - Product items stored with product_id + product_variant_id
   - Mutually exclusive with ticket_type_id (enforced by constraint)

## Implementation Tasks

### Database Migration

```sql
-- Extend validate_checkout_capacity to handle products
-- No new tables needed (F015 already added products tables)
```

New RPC: `validate_checkout_capacity_v2` that handles both tickets AND products.

### Edge Function Changes

Update `create-order-public`:
1. Accept `product_items` in request body
2. Validate product items
3. Call extended capacity validation
4. Insert product order_items

### Request Schema (Updated)

```typescript
interface CreateOrderPublicRequest {
  event_id?: string
  event_slug?: string
  items: TicketItem[]           // Ticket items (existing)
  product_items?: ProductItem[] // Product items (NEW)
  email: string
  purchaser_name?: string
}

interface TicketItem {
  ticket_type_id: string
  quantity: number
}

interface ProductItem {
  product_id: string
  variant_id?: string  // Optional: specific variant
  quantity: number
}
```

### Response Schema (Unchanged)

Same response structure - products are just additional order_items.

## Validation Rules

| Rule | Applies To | Enforcement |
|------|------------|-------------|
| Product exists & active | All products | RPC check |
| Same event | All products | RPC check |
| Sales window | All products | RPC check |
| Product capacity | All products | FOR UPDATE lock + count |
| Variant capacity | Products with variant | FOR UPDATE lock + count |
| max_per_order | All products | RPC check |
| Ticket restriction | ticket_upgrade only | RPC check against cart ticket_types |

## Test Scenarios

1. ✅ Checkout with tickets only (existing behavior)
2. ✅ Checkout with products only (standalone)
3. ✅ Checkout with mixed cart (tickets + products)
4. ✅ Checkout with ticket_upgrade product (requires matching ticket)
5. ❌ Checkout with ticket_upgrade without matching ticket → REJECT
6. ❌ Checkout with product over capacity → REJECT
7. ❌ Checkout with product over max_per_order → REJECT
8. ❌ Checkout with product outside sales window → REJECT
9. ✅ Free products (price = 0) in mixed cart
10. ✅ Products with variants

## Files to Modify

1. `supabase/migrations/YYYYMMDD_f006_s4_products_integration.sql`
2. `supabase/functions/create-order-public/index.ts`

## Dependencies

- F015 Products module (✅ DONE)
- F006 S1-S3 Checkout (✅ DONE)

---

*Created: 2026-02-03*
