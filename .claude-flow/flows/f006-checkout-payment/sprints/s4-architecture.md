# S4 Architecture: Products Integration

## Overview

Integration of F015 Products module into F006 Checkout flow.

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Cart                               │
│  - Ticket items: [{ticket_type_id, quantity}]                   │
│  - Product items: [{product_id, variant_id?, quantity}]         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   create-order-public                            │
│                                                                  │
│  1. Validate input structure                                     │
│  2. Resolve user (optional auth)                                │
│  3. Verify event is published                                    │
│  4. Call validate_checkout_with_products RPC                     │
│     ├── Validate ticket capacity (FOR UPDATE SKIP LOCKED)       │
│     ├── Validate product capacity (FOR UPDATE SKIP LOCKED)      │
│     ├── Check variant capacity                                   │
│     ├── Enforce max_per_order                                    │
│     ├── Enforce ticket_upgrade restrictions                      │
│     └── Calculate total price server-side                        │
│  5. Create order                                                 │
│  6. Create order_items (tickets + products)                      │
│  7. Route: Free → issue tickets | Paid → Mollie                 │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. validate_checkout_with_products RPC

**Input:**
```sql
_event_id UUID
_ticket_items JSONB  -- [{ticket_type_id, quantity}]
_product_items JSONB -- [{product_id, variant_id?, quantity}]
```

**Output:**
```json
{
  "valid": true|false,
  "total_price": 123.45,
  "ticket_details": [...],
  "product_details": [...]
}
```

**Validations:**
- Sales window (sales_start ≤ now ≤ sales_end)
- Product/variant capacity (FOR UPDATE SKIP LOCKED)
- max_per_order limit
- ticket_upgrade restrictions (cart must contain allowed ticket_type)

### 2. Order Items Structure

```
order_items
├── ticket items: ticket_type_id != NULL, product_id = NULL
└── product items: ticket_type_id = NULL, product_id != NULL

Constraint: (ticket_type_id XOR product_id) - enforced by DB
```

### 3. Webhook Handling

The existing `handle_payment_webhook` automatically handles products:
- Filters by `ticket_type_id IS NOT NULL` when issuing tickets
- Product order_items are simply recorded (no "issuance" needed)
- Products are fulfilled via order confirmation (email includes product info)

## Security Enforcements

| Point | Enforcement |
|-------|-------------|
| Price | Server-calculated from DB, never from client |
| Capacity | Atomic locking with FOR UPDATE SKIP LOCKED |
| Event access | Event must be published |
| Product access | Product must be active, not deleted |
| Sales window | Checked for both tickets and products |
| Upgrade restriction | Cart must contain allowed ticket_type |
| max_per_order | Enforced per product |

## Backwards Compatibility

- If `product_items` is empty/null, only tickets are validated
- Falls back to old `validate_checkout_capacity` if new RPC not found
- Existing ticket-only checkouts continue to work

## Error Responses

### Product-specific errors:

```json
{
  "error": "VALIDATION_FAILED",
  "code": 409,
  "details": {
    "product_errors": [
      {
        "product_id": "...",
        "product_name": "T-Shirt",
        "reason": "Exceeds maximum per order limit"
      }
    ]
  }
}
```

### Upgrade restriction error:

```json
{
  "product_id": "...",
  "product_name": "VIP Upgrade",
  "category": "ticket_upgrade",
  "reason": "This upgrade requires a specific ticket type in your cart"
}
```

## Files Changed

| File | Changes |
|------|---------|
| `supabase/migrations/20260203100000_f006_s4_products_integration.sql` | New RPC |
| `supabase/functions/create-order-public/index.ts` | Accept products, call new RPC |

## Migration Applied

✅ `20260203100000_f006_s4_products_integration.sql`
- Creates `validate_checkout_with_products` RPC
- No schema changes (uses existing F015 tables)

---

*Created: 2026-02-03*
