# Handoff: Backend → Tester

**Flow**: F015 Products Module
**Sprint**: S1 Data Layer
**Date**: 2026-02-02
**Status**: Implementation Complete - Ready for Testing

---

## What to Test

### Database Layer

1. **Tables & Schema**
   - Verify products table created with all columns
   - Verify product_variants table created
   - Verify product_ticket_restrictions table created
   - Verify order_items extended with product columns
   - Verify all indexes created

2. **Constraints**
   - `order_items_item_type_check`: Must have exactly one of ticket_type_id OR product_id
   - `products_price_check`: Price >= 0
   - `products_vat_check`: VAT between 0-100
   - `products_capacity_check`: Capacity NULL or >= 0
   - `product_variants_unique`: No duplicate variant names per product

3. **RLS Policies**
   - **Public users**: Can view active products in sales window for published events
   - **Org members**: Can view all products for their events
   - **Admins**: Can create/update/delete products
   - **Non-admins**: Cannot create products
   - **Other orgs**: Cannot see products

4. **RPCs - Admin Functions**
   - `create_product`: Creates product with optional restrictions
   - `update_product`: Updates product (COALESCE pattern for optional params)
   - `delete_product`: Soft deletes (sets deleted_at)
   - `create_product_variant`: Creates variant
   - `update_product_variant`: Updates variant
   - `delete_product_variant`: Hard delete if no orders, else deactivate
   - `set_product_ticket_restrictions`: Replaces restrictions atomically

5. **RPCs - Public Functions**
   - `get_public_products`: Returns available products with variants as JSON
   - Filters by sales window
   - Filters upgrades by cart ticket types
   - Returns aggregated variant data

6. **Views**
   - `v_product_stats`: Aggregates sales, revenue, capacity
   - `v_product_variant_stats`: Per-variant capacity tracking

---

## Test Entry Points

### Local Supabase

```bash
# Start local Supabase
cd /Users/sebastianchavez/Desktop/COLOSS
supabase start

# Apply migration
supabase db reset

# Or apply single migration
psql postgresql://postgres:postgres@localhost:54322/postgres -f supabase/migrations/20260202100000_f015_products.sql
```

### SQL Test Files

Create test files in `/Users/sebastianchavez/Desktop/COLOSS/tests/f015-products/`:

1. `test-schema.sql` - Verify tables, indexes, constraints
2. `test-rls.sql` - Test policies with different roles
3. `test-rpcs.sql` - Test all RPC functions
4. `test-views.sql` - Test aggregation views
5. `test-edge-cases.sql` - Test edge cases

---

## Known Edge Cases

### Products

1. **Free products**: Price = 0.00 should be allowed
2. **Unlimited capacity**: capacity_total = NULL should work
3. **No sales window**: sales_start/sales_end = NULL should allow always
4. **Soft delete**: deleted_at should hide product from public queries
5. **Inactive product**: is_active = false should hide from public

### Variants

1. **Variant without capacity**: Should inherit from product (no explicit enforcement)
2. **Variant deletion with orders**: Should deactivate, not delete
3. **Variant deletion without orders**: Should hard delete
4. **Duplicate variant name**: Should fail with unique constraint error

### Ticket Restrictions

1. **Upgrade without restrictions**: Allowed (but should be prevented in UI)
2. **Standalone with restrictions**: Allowed (restrictions ignored)
3. **Empty restrictions array**: Should clear all restrictions
4. **Upgrade with cart having no allowed ticket**: `get_public_products` should filter out

### Order Items

1. **Both ticket_type_id and product_id**: Should fail constraint check
2. **Neither ticket_type_id nor product_id**: Should fail constraint check
3. **Product with variant**: Both product_id and product_variant_id set
4. **Product without variant**: Only product_id set

---

## Test Scenarios

### RLS Tests (Priority: High)

```sql
-- Test 1: Anonymous can view published, active, in-window products
SET ROLE anon;
SELECT * FROM products WHERE event_id = '...';
-- Should return only published, active products

-- Test 2: Anonymous cannot view inactive products
SET ROLE anon;
SELECT * FROM products WHERE is_active = false;
-- Should return 0 rows

-- Test 3: Org member can view all products
SET ROLE authenticated;
-- Set auth.uid() to org member
SELECT * FROM products WHERE org_id = '...';
-- Should return all products for that org

-- Test 4: Other org cannot view products
SET ROLE authenticated;
-- Set auth.uid() to different org member
SELECT * FROM products WHERE org_id = '...';
-- Should return 0 rows
```

### RPC Tests (Priority: High)

```sql
-- Test 5: Create product as admin
SELECT create_product(
    _event_id := '...',
    _category := 'standalone',
    _name := 'Test Product',
    _price := 25.00
);
-- Should return product UUID

-- Test 6: Create product as non-admin
SET ROLE authenticated;
-- Set auth.uid() to non-admin user
SELECT create_product(...);
-- Should raise exception 'Insufficient permissions'

-- Test 7: Create upgrade with restrictions
SELECT create_product(
    _category := 'ticket_upgrade',
    _ticket_type_ids := ARRAY['ticket-uuid-1', 'ticket-uuid-2']
);
-- Should create product and restrictions

-- Test 8: Update product with optional params
SELECT update_product(
    _product_id := '...',
    _name := 'Updated Name',
    _price := 30.00
);
-- Should update only specified fields

-- Test 9: Soft delete product
SELECT delete_product(_product_id := '...');
-- Should set deleted_at, not delete row

-- Test 10: Get public products
SELECT * FROM get_public_products(
    _event_id := '...',
    _cart_ticket_type_ids := ARRAY['ticket-uuid-1']
);
-- Should return products with variants as JSON
```

### View Tests (Priority: Medium)

```sql
-- Test 11: v_product_stats aggregates correctly
INSERT INTO orders (...) VALUES (...);
INSERT INTO order_items (product_id, quantity) VALUES ('...', 5);
UPDATE orders SET status = 'paid' WHERE id = '...';

SELECT * FROM v_product_stats WHERE product_id = '...';
-- Should show units_sold = 1, total_quantity_sold = 5

-- Test 12: Capacity calculation
-- Product with capacity_total = 10
-- Sold = 3, Pending = 2
SELECT available_capacity FROM v_product_stats WHERE product_id = '...';
-- Should return 5 (10 - 3 - 2)

-- Test 13: Variant stats
SELECT * FROM v_product_variant_stats WHERE product_id = '...';
-- Should track per-variant capacity
```

### Constraint Tests (Priority: High)

```sql
-- Test 14: Order item must have ticket OR product
INSERT INTO order_items (order_id, quantity, unit_price, total_price)
VALUES ('...', 1, 10, 10);
-- Should fail: order_items_item_type_check

-- Test 15: Order item cannot have both
INSERT INTO order_items (
    order_id, ticket_type_id, product_id, quantity, unit_price, total_price
) VALUES ('...', 'ticket-uuid', 'product-uuid', 1, 10, 10);
-- Should fail: order_items_item_type_check

-- Test 16: Negative price fails
INSERT INTO products (event_id, org_id, name, price)
VALUES ('...', '...', 'Test', -10.00);
-- Should fail: products_price_check

-- Test 17: Duplicate variant name fails
INSERT INTO product_variants (product_id, name) VALUES ('...', 'Maat M');
INSERT INTO product_variants (product_id, name) VALUES ('...', 'Maat M');
-- Should fail: product_variants_unique
```

### Sales Window Tests (Priority: Medium)

```sql
-- Test 18: Product not yet started
INSERT INTO products (
    ..., sales_start := NOW() + INTERVAL '1 day'
);
SELECT * FROM get_public_products(...);
-- Should NOT include product

-- Test 19: Product ended
INSERT INTO products (
    ..., sales_end := NOW() - INTERVAL '1 day'
);
SELECT * FROM get_public_products(...);
-- Should NOT include product

-- Test 20: Product in window
INSERT INTO products (
    ..., sales_start := NOW() - INTERVAL '1 day',
    sales_end := NOW() + INTERVAL '1 day'
);
SELECT * FROM get_public_products(...);
-- Should include product
```

### Ticket Restriction Tests (Priority: High)

```sql
-- Test 21: Upgrade product filters by cart tickets
-- Create upgrade product with restriction to ticket-type-A
SELECT create_product(
    _category := 'ticket_upgrade',
    _ticket_type_ids := ARRAY['ticket-type-A']
);

-- Query without cart having ticket-type-A
SELECT * FROM get_public_products(
    _event_id := '...',
    _cart_ticket_type_ids := ARRAY['ticket-type-B']
);
-- Should NOT include upgrade product

-- Query with cart having ticket-type-A
SELECT * FROM get_public_products(
    _event_id := '...',
    _cart_ticket_type_ids := ARRAY['ticket-type-A']
);
-- Should include upgrade product
```

### Variant Tests (Priority: Medium)

```sql
-- Test 22: Delete variant with orders
INSERT INTO order_items (product_variant_id, ...) VALUES ('variant-uuid', ...);
SELECT delete_product_variant(_variant_id := 'variant-uuid');
-- Should set is_active = false, not delete

SELECT * FROM product_variants WHERE id = 'variant-uuid';
-- Should still exist, is_active = false

-- Test 23: Delete variant without orders
SELECT delete_product_variant(_variant_id := 'new-variant-uuid');
-- Should hard delete

SELECT * FROM product_variants WHERE id = 'new-variant-uuid';
-- Should return 0 rows
```

---

## Files Changed

### Migration
- `/Users/sebastianchavez/Desktop/COLOSS/supabase/migrations/20260202100000_f015_products.sql`
  - 1 ENUM type
  - 3 tables (products, product_variants, product_ticket_restrictions)
  - 1 table extension (order_items)
  - 10 indexes
  - 8 RLS policies
  - 2 views
  - 8 RPC functions
  - 1 trigger

### TypeScript Types
- `/Users/sebastianchavez/Desktop/COLOSS/web/src/types/products.ts`
  - Database model types
  - API request/response types
  - Public API types
  - Validation helpers

---

## Success Criteria

- [ ] All tables created successfully
- [ ] All indexes created
- [ ] All RLS policies working (public, org, admin)
- [ ] All 8 RPC functions working
- [ ] All constraints enforced
- [ ] Views aggregate correctly
- [ ] Trigger updates `updated_at`
- [ ] No SQL syntax errors
- [ ] No permission errors in expected scenarios

---

## Next Steps After Testing

1. **If tests pass**:
   - Mark F015 S1 as complete
   - Handoff to @reviewer for security audit
   - Plan S2: Checkout Integration

2. **If tests fail**:
   - Create bug report in `.claude-flow/flows/f015-products/bugs/`
   - Tag @backend for fix
   - Re-test after fix

---

**Test Coverage Target**: 25+ test scenarios
**Priority Focus**: RLS policies, constraints, RPC auth checks

---

**End of Handoff**

*Ready for @supabase-tester to begin test suite implementation.*
