# Architecture: Products Module (F015 S1)

**Date**: 2026-02-02
**Architect**: @architect
**Status**: Design Complete - Ready for Implementation

---

## Overview

Products module allows organizations to sell additional items beyond tickets. Supports two categories:
- **Ticket upgrades**: Extras that can only be purchased alongside specific ticket types
- **Standalone products**: Items sold independently (merchandise, supporter packages)

Products support variants (sizes, colors) with independent capacity tracking.

---

## Architecture Decision Record (ADR)

### Context

Organizations need ability to sell extra products:
- VIP upgrades tied to specific ticket types
- Merchandise (t-shirts with size variants) 
- Lunch packages, photo packages, etc.
- Each with own capacity, pricing, and sales windows

### Decision

Build Products as Layer 4.5 (between Tickets and Orders):
1. **products** table with dual-category support (upgrade vs standalone)
2. **product_variants** for size/color options
3. **product_ticket_restrictions** junction table for upgrade enforcement
4. Extend existing **order_items** to support both ticket_type_id AND product_id
5. Capacity reservation uses same atomic locking pattern as tickets

### Consequences

**Positive**:
- Reuses proven checkout flow patterns (capacity locking, RLS)
- Clean separation: products are first-class entities, not ticket attributes
- Variants enable rich product catalogs without schema bloat
- Backward compatible: existing checkout works unchanged

**Negative**:
- checkout flow needs extension (validate products + ticket restrictions)
- RPC complexity increases (need product-aware capacity checks)
- order_items becomes polymorphic (ticket OR product)

---

## Component Structure

```
supabase/migrations/
├── 20260202100000_f015_products.sql          # Schema + RLS + RPCs

supabase/functions/
├── create-order-public/                      # Extend for products
│   └── index.ts                              # Add product validation
└── _shared/
    └── product-validation.ts                 # Shared validation logic
```

---

## Database Schema

### 1. ENUM Type

```sql
CREATE TYPE product_category AS ENUM (
    'ticket_upgrade',    -- Only purchasable with specific tickets
    'standalone'         -- Independently purchasable
);
```

### 2. products Table

```sql
CREATE TABLE public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
    
    -- Categorization
    category product_category NOT NULL DEFAULT 'standalone',
    
    -- Basic Info
    name TEXT NOT NULL,
    description TEXT,                    -- Rich text, shown in detail
    instructions TEXT,                   -- Post-purchase instructions
    image_url TEXT,                      -- Product image
    
    -- Pricing
    price NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    vat_percentage NUMERIC(4,2) NOT NULL DEFAULT 21.00,
    
    -- Capacity & Limits
    capacity_total INTEGER,              -- NULL = unlimited
    max_per_order INTEGER NOT NULL DEFAULT 10,
    
    -- Sales Window
    sales_start TIMESTAMPTZ,
    sales_end TIMESTAMPTZ,
    
    -- Display
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,              -- Soft delete
    
    -- Constraints
    CONSTRAINT products_price_check CHECK (price >= 0),
    CONSTRAINT products_capacity_check CHECK (capacity_total IS NULL OR capacity_total >= 0),
    CONSTRAINT products_max_per_order_check CHECK (max_per_order > 0)
);

CREATE INDEX idx_products_event_id ON public.products(event_id);
CREATE INDEX idx_products_org_id ON public.products(org_id);
CREATE INDEX idx_products_category ON public.products(category);
CREATE INDEX idx_products_active ON public.products(is_active, deleted_at);

COMMENT ON TABLE public.products IS 'Extra products beyond tickets (upgrades, merchandise)';
COMMENT ON COLUMN public.products.category IS 'ticket_upgrade = tied to tickets, standalone = independent';
COMMENT ON COLUMN public.products.capacity_total IS 'NULL means unlimited capacity';
```

### 3. product_variants Table

```sql
CREATE TABLE public.product_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    
    -- Variant Details
    name TEXT NOT NULL,                  -- "Maat M", "Kleur Rood"
    capacity_total INTEGER,              -- NULL = inherit from product or unlimited
    
    -- Display
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT product_variants_capacity_check CHECK (capacity_total IS NULL OR capacity_total >= 0),
    CONSTRAINT product_variants_unique UNIQUE (product_id, name)
);

CREATE INDEX idx_product_variants_product_id ON public.product_variants(product_id);
CREATE INDEX idx_product_variants_active ON public.product_variants(is_active);

COMMENT ON TABLE public.product_variants IS 'Product variations (sizes, colors) with own capacity';
COMMENT ON COLUMN public.product_variants.capacity_total IS 'NULL = no variant-specific limit';
```

### 4. product_ticket_restrictions Table

```sql
CREATE TABLE public.product_ticket_restrictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    ticket_type_id UUID NOT NULL REFERENCES public.ticket_types(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraint: one restriction entry per product-ticket pair
    CONSTRAINT product_ticket_restrictions_unique UNIQUE (product_id, ticket_type_id)
);

CREATE INDEX idx_product_ticket_restrictions_product_id ON public.product_ticket_restrictions(product_id);
CREATE INDEX idx_product_ticket_restrictions_ticket_type_id ON public.product_ticket_restrictions(ticket_type_id);

COMMENT ON TABLE public.product_ticket_restrictions IS 'Junction table: which tickets allow buying which products (for upgrades)';
```

### 5. Extended order_items Table

```sql
-- Extend existing order_items table
ALTER TABLE public.order_items
    ADD COLUMN product_id UUID REFERENCES public.products(id) ON DELETE RESTRICT,
    ADD COLUMN product_variant_id UUID REFERENCES public.product_variants(id) ON DELETE RESTRICT;

CREATE INDEX idx_order_items_product_id ON public.order_items(product_id);
CREATE INDEX idx_order_items_product_variant_id ON public.order_items(product_variant_id);

-- Add constraint: must have either ticket_type_id OR product_id (not both, not neither)
ALTER TABLE public.order_items
    ADD CONSTRAINT order_items_item_type_check CHECK (
        (ticket_type_id IS NOT NULL AND product_id IS NULL) OR
        (ticket_type_id IS NULL AND product_id IS NOT NULL)
    );

COMMENT ON COLUMN public.order_items.product_id IS 'Link to product (mutually exclusive with ticket_type_id)';
COMMENT ON COLUMN public.order_items.product_variant_id IS 'Optional: specific variant within product';
```

### 6. Views

#### v_product_stats

Aggregated product sales and capacity.

```sql
CREATE OR REPLACE VIEW public.v_product_stats AS
SELECT
    p.id AS product_id,
    p.event_id,
    p.org_id,
    p.name,
    p.category,
    p.price,
    p.capacity_total,
    
    -- Aggregated Sales (only from paid orders)
    COUNT(DISTINCT oi.id) FILTER (WHERE o.status = 'paid') AS units_sold,
    COALESCE(SUM(oi.quantity) FILTER (WHERE o.status = 'paid'), 0) AS total_quantity_sold,
    COALESCE(SUM(oi.total_price) FILTER (WHERE o.status = 'paid'), 0) AS total_revenue,
    
    -- Pending (reserved but not paid)
    COALESCE(SUM(oi.quantity) FILTER (WHERE o.status = 'pending'), 0) AS total_quantity_pending,
    
    -- Availability
    CASE
        WHEN p.capacity_total IS NULL THEN NULL -- Unlimited
        ELSE p.capacity_total - COALESCE(SUM(oi.quantity) FILTER (WHERE o.status IN ('paid', 'pending')), 0)
    END AS available_capacity,
    
    -- Sales Window Status
    CASE
        WHEN p.sales_start IS NOT NULL AND NOW() < p.sales_start THEN 'not_started'
        WHEN p.sales_end IS NOT NULL AND NOW() > p.sales_end THEN 'ended'
        ELSE 'active'
    END AS sales_status

FROM public.products p
LEFT JOIN public.order_items oi ON oi.product_id = p.id
LEFT JOIN public.orders o ON o.id = oi.order_id

WHERE p.deleted_at IS NULL

GROUP BY p.id;

COMMENT ON VIEW public.v_product_stats IS 'Aggregated product sales and availability';
```

#### v_product_variant_stats

Per-variant capacity tracking.

```sql
CREATE OR REPLACE VIEW public.v_product_variant_stats AS
SELECT
    pv.id AS variant_id,
    pv.product_id,
    pv.name AS variant_name,
    pv.capacity_total AS variant_capacity,
    
    -- Sold
    COALESCE(SUM(oi.quantity) FILTER (WHERE o.status = 'paid'), 0) AS units_sold,
    
    -- Pending
    COALESCE(SUM(oi.quantity) FILTER (WHERE o.status = 'pending'), 0) AS units_pending,
    
    -- Available
    CASE
        WHEN pv.capacity_total IS NULL THEN NULL
        ELSE pv.capacity_total - COALESCE(SUM(oi.quantity) FILTER (WHERE o.status IN ('paid', 'pending')), 0)
    END AS available_capacity

FROM public.product_variants pv
LEFT JOIN public.order_items oi ON oi.product_variant_id = pv.id
LEFT JOIN public.orders o ON o.id = oi.order_id

WHERE pv.is_active = true

GROUP BY pv.id;

COMMENT ON VIEW public.v_product_variant_stats IS 'Per-variant sales and capacity';
```

---

## RLS Policies

### products Table

```sql
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Public: view published event products in sales window
CREATE POLICY "Public can view active products"
    ON public.products
    FOR SELECT
    USING (
        deleted_at IS NULL
        AND is_active = true
        AND EXISTS (
            SELECT 1 FROM public.events e
            WHERE e.id = products.event_id
            AND e.status = 'published'
            AND e.deleted_at IS NULL
        )
        AND (sales_start IS NULL OR NOW() >= sales_start)
        AND (sales_end IS NULL OR NOW() <= sales_end)
    );

-- Org members: view all products for their events
CREATE POLICY "Org members can view products"
    ON public.products
    FOR SELECT
    USING (
        public.is_org_member(org_id)
    );

-- Admins/Owners: full CRUD
CREATE POLICY "Admins can manage products"
    ON public.products
    FOR ALL
    USING (
        public.has_role(org_id, 'admin') OR public.has_role(org_id, 'owner')
    )
    WITH CHECK (
        public.has_role(org_id, 'admin') OR public.has_role(org_id, 'owner')
    );
```

### product_variants Table

```sql
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

-- Public: inherit from product
CREATE POLICY "Public can view active variants"
    ON public.product_variants
    FOR SELECT
    USING (
        is_active = true
        AND EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = product_variants.product_id
            AND p.deleted_at IS NULL
            AND p.is_active = true
            AND EXISTS (
                SELECT 1 FROM public.events e
                WHERE e.id = p.event_id
                AND e.status = 'published'
                AND e.deleted_at IS NULL
            )
        )
    );

-- Org members: view via product
CREATE POLICY "Org members can view variants"
    ON public.product_variants
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = product_variants.product_id
            AND public.is_org_member(p.org_id)
        )
    );

-- Admins: manage variants
CREATE POLICY "Admins can manage variants"
    ON public.product_variants
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = product_variants.product_id
            AND (public.has_role(p.org_id, 'admin') OR public.has_role(p.org_id, 'owner'))
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = product_variants.product_id
            AND (public.has_role(p.org_id, 'admin') OR public.has_role(p.org_id, 'owner'))
        )
    );
```

### product_ticket_restrictions Table

```sql
ALTER TABLE public.product_ticket_restrictions ENABLE ROW LEVEL SECURITY;

-- Public: view restrictions (needed for checkout validation)
CREATE POLICY "Public can view restrictions"
    ON public.product_ticket_restrictions
    FOR SELECT
    USING (true);

-- Admins: manage restrictions
CREATE POLICY "Admins can manage restrictions"
    ON public.product_ticket_restrictions
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = product_ticket_restrictions.product_id
            AND (public.has_role(p.org_id, 'admin') OR public.has_role(p.org_id, 'owner'))
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = product_ticket_restrictions.product_id
            AND (public.has_role(p.org_id, 'admin') OR public.has_role(p.org_id, 'owner'))
        )
    );
```

---

## RPC Functions

### 1. validate_checkout_capacity (EXTEND)

**Purpose**: Extend existing RPC to support products in addition to tickets.

**Signature**:
```sql
CREATE OR REPLACE FUNCTION public.validate_checkout_capacity(
    _event_id UUID,
    _items JSONB  -- Now accepts both tickets and products
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public;
```

**Logic**:
1. Parse items array: each item has `ticket_type_id` OR `product_id` + optional `product_variant_id`
2. Lock ticket_types with `FOR UPDATE SKIP LOCKED`
3. Lock products with `FOR UPDATE SKIP LOCKED`
4. If variant specified: lock variant with `FOR UPDATE SKIP LOCKED`
5. Validate:
   - Ticket capacity (existing logic)
   - Product capacity (total and variant-specific)
   - Product sales window
   - Product ticket restrictions (if upgrade: check cart has allowed ticket)
6. Calculate total price (tickets + products)
7. Return validation result with line items

**Returns**:
```json
{
  "valid": true,
  "total_price": 125.00,
  "details": [
    { "ticket_type_id": "...", "quantity": 2, "price": 50.00, "line_total": 100.00 },
    { "product_id": "...", "product_variant_id": "...", "quantity": 1, "price": 25.00, "line_total": 25.00 }
  ]
}
```

### 2. get_public_products

**Purpose**: Public API for fetching products during checkout.

**Signature**:
```sql
CREATE OR REPLACE FUNCTION public.get_public_products(
    _event_id UUID,
    _cart_ticket_type_ids UUID[] DEFAULT ARRAY[]::UUID[]
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    description TEXT,
    image_url TEXT,
    price NUMERIC,
    category product_category,
    max_per_order INTEGER,
    available_capacity INTEGER,
    variants JSONB
)
SECURITY DEFINER
SET search_path = public;
```

**Logic**:
1. Filter products: event_id, published, active, in sales window
2. If category = 'ticket_upgrade': check restrictions match cart tickets
3. Join with variants (active only)
4. Return with aggregated variant JSON

### 3. create_product

**Purpose**: Admin RPC for creating products.

**Signature**:
```sql
CREATE OR REPLACE FUNCTION public.create_product(
    _event_id UUID,
    _category product_category,
    _name TEXT,
    _description TEXT DEFAULT NULL,
    _instructions TEXT DEFAULT NULL,
    _image_url TEXT DEFAULT NULL,
    _price NUMERIC DEFAULT 0.00,
    _vat_percentage NUMERIC DEFAULT 21.00,
    _capacity_total INTEGER DEFAULT NULL,
    _max_per_order INTEGER DEFAULT 10,
    _sales_start TIMESTAMPTZ DEFAULT NULL,
    _sales_end TIMESTAMPTZ DEFAULT NULL,
    _ticket_type_ids UUID[] DEFAULT ARRAY[]::UUID[]
)
RETURNS UUID
SECURITY DEFINER
SET search_path = public;
```

**Logic**:
1. Verify auth: user is admin/owner of event's org
2. Resolve org_id from event
3. INSERT product
4. If ticket_type_ids provided: INSERT restrictions
5. Audit log
6. Return product.id

### 4. update_product

**Purpose**: Update existing product.

**Signature**:
```sql
CREATE OR REPLACE FUNCTION public.update_product(
    _product_id UUID,
    _name TEXT DEFAULT NULL,
    _description TEXT DEFAULT NULL,
    _instructions TEXT DEFAULT NULL,
    _image_url TEXT DEFAULT NULL,
    _price NUMERIC DEFAULT NULL,
    _vat_percentage NUMERIC DEFAULT NULL,
    _capacity_total INTEGER DEFAULT NULL,
    _max_per_order INTEGER DEFAULT NULL,
    _sales_start TIMESTAMPTZ DEFAULT NULL,
    _sales_end TIMESTAMPTZ DEFAULT NULL,
    _is_active BOOLEAN DEFAULT NULL
)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public;
```

**Logic**: Auth check → UPDATE with COALESCE for optional fields → Audit log

### 5. delete_product

**Purpose**: Soft delete product.

**Signature**:
```sql
CREATE OR REPLACE FUNCTION public.delete_product(
    _product_id UUID
)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public;
```

**Logic**: Auth check → UPDATE deleted_at → Audit log

### 6. create_product_variant

**Purpose**: Add variant to product.

**Signature**:
```sql
CREATE OR REPLACE FUNCTION public.create_product_variant(
    _product_id UUID,
    _name TEXT,
    _capacity_total INTEGER DEFAULT NULL,
    _sort_order INTEGER DEFAULT 0
)
RETURNS UUID
SECURITY DEFINER
SET search_path = public;
```

### 7. update_product_variant

**Purpose**: Update variant.

**Signature**:
```sql
CREATE OR REPLACE FUNCTION public.update_product_variant(
    _variant_id UUID,
    _name TEXT DEFAULT NULL,
    _capacity_total INTEGER DEFAULT NULL,
    _is_active BOOLEAN DEFAULT NULL
)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public;
```

### 8. delete_product_variant

**Purpose**: Delete variant (hard delete if no orders, else deactivate).

**Signature**:
```sql
CREATE OR REPLACE FUNCTION public.delete_product_variant(
    _variant_id UUID
)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public;
```

### 9. set_product_ticket_restrictions

**Purpose**: Replace ticket restrictions for a product.

**Signature**:
```sql
CREATE OR REPLACE FUNCTION public.set_product_ticket_restrictions(
    _product_id UUID,
    _ticket_type_ids UUID[]
)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public;
```

**Logic**:
1. Auth check
2. DELETE existing restrictions for product
3. INSERT new restrictions (if array not empty)
4. Audit log

---

## Implementation Notes for @backend

### File Organization

1. **Migration**: Single file `20260202100000_f015_products.sql`
   - Create ENUM
   - Create tables (products, product_variants, product_ticket_restrictions)
   - Alter order_items (add product_id, product_variant_id, constraint)
   - Create indexes
   - Enable RLS
   - Create policies
   - Create views
   - Create RPCs (all 9 functions)
   - Add triggers (updated_at)
   - Add comments

2. **Extend Edge Function**: `supabase/functions/create-order-public/index.ts`
   - Modify interface `OrderItem` to support products:
     ```typescript
     interface OrderItem {
         ticket_type_id?: string
         product_id?: string
         product_variant_id?: string
         quantity: number
     }
     ```
   - Update validation logic: check exactly one of ticket_type_id OR product_id
   - Update RPC call: pass products to validate_checkout_capacity
   - Update order_items insert: include product_id, product_variant_id

### Implementation Order

1. Create migration skeleton (tables + indexes)
2. Add RLS policies
3. Implement views
4. Implement RPCs (start with simple ones: create_product, update_product)
5. Extend validate_checkout_capacity (complex!)
6. Implement get_public_products
7. Extend create-order-public Edge Function
8. Test each RPC individually
9. Integration test: full checkout with products

### Critical: Atomic Capacity Locking

In `validate_checkout_capacity`, lock order matters:

```sql
-- Lock in consistent order to prevent deadlocks
-- 1. Lock ticket types
SELECT * FROM ticket_types WHERE id = ANY(_ticket_ids) ORDER BY id FOR UPDATE SKIP LOCKED;

-- 2. Lock products
SELECT * FROM products WHERE id = ANY(_product_ids) ORDER BY id FOR UPDATE SKIP LOCKED;

-- 3. Lock variants
SELECT * FROM product_variants WHERE id = ANY(_variant_ids) ORDER BY id FOR UPDATE SKIP LOCKED;
```

### Ticket Restriction Validation

For `category = 'ticket_upgrade'`:
```sql
-- Check cart has at least one allowed ticket
SELECT EXISTS (
    SELECT 1
    FROM product_ticket_restrictions ptr
    WHERE ptr.product_id = _product_id
    AND ptr.ticket_type_id = ANY(_cart_ticket_type_ids)
)
```

If no restrictions exist for upgrade product → deny purchase (explicit opt-in required).

---

## Test Requirements for @supabase-tester

### Unit Tests (SQL)

1. **Products CRUD**
   - Admin can create product (both categories)
   - Non-admin cannot create
   - Capacity validation (>= 0)
   - Price validation (>= 0)
   - Soft delete works

2. **Variants**
   - Create variants for product
   - Unique name constraint enforced
   - Inherit product visibility

3. **Ticket Restrictions**
   - Set restrictions on upgrade product
   - Cannot set restrictions on standalone product (logic check)
   - Public can read restrictions

4. **RLS Policies**
   - Anonymous sees only published, active, in-window products
   - Anonymous cannot see draft/inactive products
   - Org members see all their products
   - Other orgs cannot see products

5. **Views**
   - v_product_stats aggregates correctly
   - Capacity calculation: total - (sold + pending)
   - v_product_variant_stats tracks per-variant

### Integration Tests (Edge Function)

6. **Checkout with Standalone Product**
   - Add standalone product to empty cart
   - Verify order_items.product_id populated
   - Verify price calculated correctly

7. **Checkout with Ticket + Upgrade Product**
   - Add ticket + upgrade product
   - Verify restriction enforced (allowed ticket in cart)
   - Verify order_items has both ticket and product

8. **Checkout Fails: Upgrade Without Ticket**
   - Try to buy upgrade product without allowed ticket
   - Expect validation failure

9. **Checkout Fails: Product Out of Stock**
   - Product with capacity_total = 0
   - Expect validation failure

10. **Checkout Fails: Outside Sales Window**
    - Product with sales_end in past
    - Expect validation failure

11. **Variant Capacity**
    - Product with variant (capacity = 5)
    - Buy 5 units → success
    - Buy 6th → fail (out of stock)

### Edge Cases

12. **Concurrent Orders** (stress test)
    - 10 simultaneous checkouts for last 3 units
    - Exactly 3 succeed, 7 fail
    - No overselling (FOR UPDATE SKIP LOCKED)

13. **Free Product**
    - Product with price = 0.00
    - Order should complete without payment

14. **Product with NULL capacity**
    - Unlimited stock
    - Allow >1000 purchases

---

## Edge Cases & Failure Scenarios

| Scenario | Expected Behavior |
|----------|-------------------|
| Product deleted during checkout | Validation fails (deleted_at check) |
| Variant deleted during checkout | Validation fails (is_active check) |
| Sales window ends mid-checkout | RPC locks product, then checks window → fail |
| Admin changes price during checkout | Server-side price at validation time is used (correct) |
| Order with 10 different products | Validate each, aggregate total price |
| Upgrade product + wrong ticket type | Validation fails with restriction error |
| Product capacity = 5, variant capacity = 3 | Variant limit takes precedence |
| Anonymous user buys product | Works (no auth required for checkout) |

---

## Database Migration File

**Filename**: `supabase/migrations/20260202100000_f015_products.sql`

**Sections**:
1. File header comment (purpose, dependencies)
2. ENUM type
3. CREATE TABLE (products, product_variants, product_ticket_restrictions)
4. ALTER TABLE (order_items)
5. CREATE INDEX
6. ENABLE RLS
7. CREATE POLICY (products, variants, restrictions)
8. CREATE VIEW (v_product_stats, v_product_variant_stats)
9. CREATE FUNCTION (9 RPCs)
10. CREATE TRIGGER (updated_at for products, variants)
11. COMMENT ON (tables, columns)

**Dependencies**:
- 20240119000004_layer_4_tickets.sql (ticket_types table)
- 20240119000005_layer_5_orders.sql (orders, order_items tables)

---

## Handoff to @backend

**Task**: Implement F015 Products Module (Data Layer)

### Deliverables

1. Migration file: `supabase/migrations/20260202100000_f015_products.sql`
   - 3 tables + 1 table extension
   - 2 views
   - 9 RPC functions
   - RLS policies for all tables
   - Indexes for performance

2. Extended Edge Function: `supabase/functions/create-order-public/index.ts`
   - Update OrderItem interface
   - Add product validation
   - Update order_items insert

3. Update db-architecture.md:
   - Add tables to Layer 4.5
   - Add RPCs to function list
   - Add ENUM type
   - Update ERD diagram

### Copy-Paste Ready Interfaces

```typescript
// Extend existing OrderItem interface
interface OrderItem {
    ticket_type_id?: string          // Existing
    product_id?: string               // NEW
    product_variant_id?: string       // NEW
    quantity: number
}

// Product validation in checkout
interface ProductValidationItem {
    product_id: string
    product_variant_id?: string
    quantity: number
    cart_ticket_type_ids: string[]  // For upgrade restriction check
}
```

### Implementation Order

1. **Phase 1: Core Schema** (30 min)
   - Create ENUM, tables, indexes
   - Enable RLS

2. **Phase 2: Policies** (20 min)
   - Implement RLS policies
   - Test with test users

3. **Phase 3: Views** (15 min)
   - Create v_product_stats
   - Create v_product_variant_stats

4. **Phase 4: Simple RPCs** (45 min)
   - create_product
   - update_product
   - delete_product
   - create_product_variant
   - update_product_variant
   - delete_product_variant
   - set_product_ticket_restrictions

5. **Phase 5: Complex RPCs** (60 min)
   - get_public_products (with variant aggregation)
   - validate_checkout_capacity (extend existing with product logic)

6. **Phase 6: Checkout Integration** (30 min)
   - Extend create-order-public Edge Function
   - Update interface
   - Add product validation path

**Total Estimated Time**: 3.5 hours

### Critical Validation Rules

1. **order_items constraint**: Exactly one of ticket_type_id OR product_id must be set
2. **Upgrade restriction**: If product.category = 'ticket_upgrade' AND restrictions exist → cart MUST contain allowed ticket
3. **Capacity locking**: Use `FOR UPDATE SKIP LOCKED` for atomic reservation
4. **Sales window**: Check NOW() BETWEEN sales_start AND sales_end
5. **Variant capacity**: If specified, variant.capacity_total overrides product.capacity_total

### Testing Checklist

After implementation, verify:
- [ ] Admin can create standalone product
- [ ] Admin can create upgrade product with ticket restrictions
- [ ] Public cannot see inactive products
- [ ] Public can see active products in sales window
- [ ] Checkout works with standalone product
- [ ] Checkout works with upgrade product + valid ticket
- [ ] Checkout FAILS with upgrade product + invalid ticket
- [ ] Capacity tracking works (sold + pending)
- [ ] Variant capacity tracked separately
- [ ] Concurrent orders handled correctly (no overselling)

---

**End of Architecture Document**

*Ready for @backend implementation.*
*Estimated completion: 3.5 hours*
*Test coverage: 14 scenarios*

