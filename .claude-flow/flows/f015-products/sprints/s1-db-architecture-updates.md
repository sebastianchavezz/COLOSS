# Database Architecture Updates for F015 Products

**To be merged into**: `.claude-flow/memory/db-architecture.md`
**After**: Migration successfully applied

---

## Table Overview - ADD TO LAYER 4.5

Add new section between Layer 4 (Tickets) and Layer 5 (Orders):

### Layer 4.5: Products & Merchandise

| Table | Purpose | RLS |
|-------|---------|-----|
| `products` | Product definitions (upgrades + standalone) | public read (published), org write |
| `product_variants` | Size/color variants with capacity | inherit from product |
| `product_ticket_restrictions` | Upgrade product rules | public read, admin write |

---

## Entity Relationship Diagram - UPDATE

Add to existing ERD:

```
┌─────────────┐      ┌─────────────┐
│    orgs     │──1:N─│   events    │
└─────────────┘      └─────────────┘
       │                    │
       │                    ├── ticket_types (1:N)
       │                    │         │
       │                    │         └── ticket_instances (1:N)
       │                    │                    │
       │                    ├── products (1:N) ──┤        <--- NEW
       │                    │      │             │
       │                    │      └── product_variants (1:N)  <--- NEW
       │                    │      │
       │                    │      └── product_ticket_restrictions (N:M with ticket_types) <--- NEW
       │                    │
       │                    ├── orders (1:N)─────┤
       │                    │      │             │
       │                    │      └── order_items (1:N)  <--- EXTENDED
       │                    │             │
       │                    │             ├── ticket_instances (link)
       │                    │             └── products (link)  <--- NEW
```

---

## Key RPC Functions - ADD

Add to existing RPC section:

### F015 Products

| Function | Purpose | Auth |
|----------|---------|------|
| `create_product(...)` | Create product | admin |
| `update_product(...)` | Update product | admin |
| `delete_product(id)` | Soft delete product | admin |
| `get_public_products(event_id, cart_tickets)` | Public product list for checkout | anon |
| `create_product_variant(...)` | Add variant | admin |
| `update_product_variant(...)` | Update variant | admin |
| `delete_product_variant(id)` | Delete variant | admin |
| `set_product_ticket_restrictions(product_id, ticket_ids)` | Set upgrade rules | admin |
| `validate_checkout_capacity(...)` | **EXTENDED** - now supports products | anon/auth |

---

## Enum Types - ADD

| Type | Values |
|------|--------|
| `product_category` | standalone, ticket_upgrade |

---

## Key Constraints - ADD

### Unique Constraints

| Table | Constraint | Purpose |
|-------|------------|---------|
| `product_variants` | `(product_id, name)` | No duplicate variant names per product |
| `product_ticket_restrictions` | `(product_id, ticket_type_id)` | One restriction per product-ticket pair |

### Foreign Keys

| Child | Parent | On Delete |
|-------|--------|-----------|
| `products.event_id` | `events` | CASCADE |
| `products.org_id` | `orgs` | CASCADE |
| `product_variants.product_id` | `products` | CASCADE |
| `product_ticket_restrictions.product_id` | `products` | CASCADE |
| `product_ticket_restrictions.ticket_type_id` | `ticket_types` | CASCADE |
| `order_items.product_id` | `products` | RESTRICT |
| `order_items.product_variant_id` | `product_variants` | RESTRICT |

### Check Constraints

| Table | Constraint | Rule |
|-------|------------|------|
| `products` | `products_price_check` | price >= 0 |
| `products` | `products_capacity_check` | capacity_total >= 0 OR NULL |
| `product_variants` | `product_variants_capacity_check` | capacity_total >= 0 OR NULL |
| `order_items` | `order_items_item_type_check` | ticket_type_id XOR product_id |

---

**End of Updates**

*@backend: Merge these sections into db-architecture.md after migration is applied and tested.*

