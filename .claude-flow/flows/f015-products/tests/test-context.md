# Test Context: F015 Products Module

**Flow**: F015 Products
**Sprint**: S1 (Data Layer)
**Created**: 2026-02-02

---

## Dependencies

### Required Flows (Must Work First)
- ✅ F003: Event Creation (events table, RLS)
- ✅ F006: Checkout Flow (orders, order_items, capacity locking)

### Database State
All migrations from Layer 1-5 must be applied:
- orgs, org_members (multi-tenant)
- events, event_settings
- ticket_types (for upgrade restrictions)
- orders, order_items (to extend)
- RLS helper functions: `is_org_member()`, `has_role()`

---

## Relevant Tables for This Flow

### New Tables (Created by This Flow)
1. **products**
   - Purpose: Product definitions (upgrades + standalone)
   - Key columns: event_id, category, price, capacity_total, sales_start/end
   - RLS: Public (published events), Org members (all), Admins (CRUD)

2. **product_variants**
   - Purpose: Size/color variants with own capacity
   - Key columns: product_id, name, capacity_total
   - RLS: Inherit from product

3. **product_ticket_restrictions**
   - Purpose: Define which tickets allow buying upgrade products
   - Key columns: product_id, ticket_type_id
   - RLS: Public SELECT, Admin INSERT/DELETE

### Extended Tables
4. **order_items**
   - New columns: product_id, product_variant_id
   - New constraint: ticket_type_id XOR product_id (exactly one)

---

## RLS Policies to Test

### products Table

| Policy | Actor | Action | Rule |
|--------|-------|--------|------|
| Public view | anon | SELECT | published event + active + in sales window |
| Org member view | auth (org member) | SELECT | is_org_member(org_id) |
| Admin manage | auth (admin/owner) | ALL | has_role(org_id, 'admin\|owner') |

**Test Cases**:
- [ ] Anonymous can view published, active, in-window product
- [ ] Anonymous cannot view inactive product
- [ ] Anonymous cannot view product before sales_start
- [ ] Anonymous cannot view product after sales_end
- [ ] Org member can view inactive products
- [ ] Org member of different org cannot view product
- [ ] Admin can INSERT product
- [ ] Non-admin cannot INSERT product
- [ ] Admin can UPDATE product
- [ ] Admin can soft DELETE product (set deleted_at)

### product_variants Table

| Policy | Actor | Action | Rule |
|--------|-------|--------|------|
| Public view | anon | SELECT | is_active + parent product visible |
| Org member view | auth (org member) | SELECT | via product.org_id |
| Admin manage | auth (admin/owner) | ALL | via product.org_id |

**Test Cases**:
- [ ] Anonymous sees variants of published product
- [ ] Anonymous does not see inactive variants
- [ ] Admin can create variant
- [ ] Admin can update variant capacity
- [ ] Admin can deactivate variant

### product_ticket_restrictions Table

| Policy | Actor | Action | Rule |
|--------|-------|--------|------|
| Public read | anon | SELECT | true (needed for checkout validation) |
| Admin manage | auth (admin/owner) | INSERT/DELETE | via product.org_id |

**Test Cases**:
- [ ] Anonymous can read restrictions
- [ ] Admin can set restrictions
- [ ] Non-admin cannot set restrictions

---

## Edge Cases

### Capacity Tracking

1. **Product with NULL capacity**
   - Unlimited stock
   - Should never show "out of stock"

2. **Product with capacity = 0**
   - Should fail checkout validation

3. **Variant capacity overrides product capacity**
   - Product capacity = 100
   - Variant "Maat M" capacity = 10
   - After 10 sales of "M", that variant is out of stock
   - Other variants still available

4. **Concurrent checkouts**
   - Product capacity = 5
   - 10 simultaneous checkout requests
   - Only 5 succeed (FOR UPDATE SKIP LOCKED)

### Sales Window

5. **Before sales_start**
   - Product not visible to public
   - Admin can still see it

6. **After sales_end**
   - Product not visible to public
   - Existing orders not affected

7. **NULL sales window**
   - Always available (if event published)

### Upgrade Restrictions

8. **Upgrade product with no restrictions**
   - Cannot be purchased (explicit restrictions required)

9. **Upgrade product with restrictions**
   - Cart must contain at least one allowed ticket_type_id
   - Otherwise checkout validation fails

10. **Standalone product**
    - Can be purchased without any ticket
    - Restrictions table empty for standalone products

### Order Items Constraint

11. **order_items with ticket_type_id**
    - product_id must be NULL

12. **order_items with product_id**
    - ticket_type_id must be NULL

13. **order_items with both**
    - INSERT fails (constraint violation)

14. **order_items with neither**
    - INSERT fails (constraint violation)

---

## Test Users Required

### 1. Admin User (org_member role = admin)
- email: `admin@testorg.com`
- org_id: Test Organization UUID
- Purpose: CRUD operations on products

### 2. Regular Org Member (org_member role = member)
- email: `member@testorg.com`
- org_id: Same as admin
- Purpose: View-only, cannot create products

### 3. Anonymous User (no auth)
- Purpose: Public product listing, checkout

### 4. Different Org Admin
- email: `admin@otherorg.com`
- org_id: Different organization UUID
- Purpose: Verify isolation (cannot see products from testorg)

---

## Fixtures & Test Data

### Minimal Setup

```sql
-- Org
INSERT INTO orgs (id, name) VALUES 
('00000000-0000-0000-0000-000000000001', 'Test Org');

-- Admin user (via Supabase Auth)
-- Assume user_id = '11111111-1111-1111-1111-111111111111'
INSERT INTO org_members (org_id, user_id, role) VALUES
('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'admin');

-- Event (published)
INSERT INTO events (id, org_id, name, slug, status) VALUES
('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001', 'Test Event', 'test-event', 'published');

-- Ticket Type (for upgrade restrictions)
INSERT INTO ticket_types (id, event_id, name, price, capacity_total) VALUES
('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'Regular Ticket', 50.00, 100);

-- Standalone Product
INSERT INTO products (id, event_id, org_id, category, name, price, capacity_total, is_active) VALUES
('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001', 'standalone', 'Event T-Shirt', 25.00, 50, true);

-- Upgrade Product (with restriction)
INSERT INTO products (id, event_id, org_id, category, name, price, is_active) VALUES
('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001', 'ticket_upgrade', 'VIP Upgrade', 100.00, true);

INSERT INTO product_ticket_restrictions (product_id, ticket_type_id) VALUES
('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333');

-- Variants for T-Shirt
INSERT INTO product_variants (id, product_id, name, capacity_total) VALUES
('66666666-6666-6666-6666-666666666666', '44444444-4444-4444-4444-444444444444', 'Maat S', 10),
('77777777-7777-7777-7777-777777777777', '44444444-4444-4444-4444-444444444444', 'Maat M', 20),
('88888888-8888-8888-8888-888888888888', '44444444-4444-4444-4444-444444444444', 'Maat L', 15);
```

### Cleanup SQL

```sql
-- Run after each test to reset state
DELETE FROM product_ticket_restrictions WHERE product_id IN (
    SELECT id FROM products WHERE event_id = '22222222-2222-2222-2222-222222222222'
);

DELETE FROM product_variants WHERE product_id IN (
    SELECT id FROM products WHERE event_id = '22222222-2222-2222-2222-222222222222'
);

DELETE FROM order_items WHERE order_id IN (
    SELECT id FROM orders WHERE event_id = '22222222-2222-2222-2222-222222222222'
);

DELETE FROM orders WHERE event_id = '22222222-2222-2222-2222-222222222222';

DELETE FROM products WHERE event_id = '22222222-2222-2222-2222-222222222222';

DELETE FROM ticket_types WHERE event_id = '22222222-2222-2222-2222-222222222222';

DELETE FROM events WHERE id = '22222222-2222-2222-2222-222222222222';

DELETE FROM org_members WHERE org_id = '00000000-0000-0000-0000-000000000001';

DELETE FROM orgs WHERE id = '00000000-0000-0000-0000-000000000001';
```

---

## RPC Functions to Test

### 1. create_product
```sql
SELECT public.create_product(
    _event_id := '22222222-2222-2222-2222-222222222222',
    _category := 'standalone',
    _name := 'Test Product',
    _price := 15.00,
    _capacity_total := 100
);
```
**Expected**: Returns UUID of new product

**Test as**:
- ✅ Admin → succeeds
- ❌ Non-admin → fails (RLS)
- ❌ Anonymous → fails (auth required)

### 2. update_product
```sql
SELECT public.update_product(
    _product_id := '44444444-4444-4444-4444-444444444444',
    _price := 30.00,
    _capacity_total := 60
);
```
**Expected**: Returns TRUE

### 3. delete_product
```sql
SELECT public.delete_product('44444444-4444-4444-4444-444444444444');
```
**Expected**: Sets deleted_at, returns TRUE

### 4. get_public_products
```sql
SELECT * FROM public.get_public_products(
    _event_id := '22222222-2222-2222-2222-222222222222',
    _cart_ticket_type_ids := ARRAY['33333333-3333-3333-3333-333333333333']::UUID[]
);
```
**Expected**: Returns standalone products + upgrade products with matching restrictions

**Test variations**:
- Empty cart → only standalone products
- Cart with allowed ticket → standalone + upgrade
- Cart with different ticket → upgrade filtered out

### 5. validate_checkout_capacity (extended)
```sql
SELECT public.validate_checkout_capacity(
    _event_id := '22222222-2222-2222-2222-222222222222',
    _items := '[
        {"product_id": "44444444-4444-4444-4444-444444444444", "product_variant_id": "66666666-6666-6666-6666-666666666666", "quantity": 2},
        {"ticket_type_id": "33333333-3333-3333-3333-333333333333", "quantity": 1}
    ]'::JSONB
);
```
**Expected**: Returns validation result with prices

**Test scenarios**:
- Product only → valid
- Product + ticket → valid
- Upgrade product without allowed ticket → invalid
- Product out of stock → invalid
- Variant out of stock → invalid
- Outside sales window → invalid

### 6. create_product_variant
```sql
SELECT public.create_product_variant(
    _product_id := '44444444-4444-4444-4444-444444444444',
    _name := 'Maat XL',
    _capacity_total := 10
);
```
**Expected**: Returns UUID

### 7. set_product_ticket_restrictions
```sql
SELECT public.set_product_ticket_restrictions(
    _product_id := '55555555-5555-5555-5555-555555555555',
    _ticket_type_ids := ARRAY['33333333-3333-3333-3333-333333333333']::UUID[]
);
```
**Expected**: Replaces existing restrictions, returns TRUE

---

## View Tests

### v_product_stats

```sql
SELECT * FROM public.v_product_stats WHERE product_id = '44444444-4444-4444-4444-444444444444';
```

**Columns to verify**:
- `units_sold` = count of paid order_items
- `total_quantity_sold` = sum of quantities from paid orders
- `total_quantity_pending` = sum from pending orders
- `available_capacity` = capacity_total - (sold + pending)
- `sales_status` = 'not_started' | 'active' | 'ended'

**Test scenarios**:
1. No orders → units_sold = 0, available = capacity_total
2. 3 paid orders (qty 2 each) → units_sold = 3, total_quantity_sold = 6
3. 2 pending orders → total_quantity_pending = X
4. Available capacity = 50 - 6 - 2 = 42

### v_product_variant_stats

```sql
SELECT * FROM public.v_product_variant_stats WHERE product_id = '44444444-4444-4444-4444-444444444444';
```

**Verify**:
- Each variant has own units_sold
- Variant capacity tracked independently
- Inactive variants excluded

---

## Performance Tests

### Concurrent Checkouts

Simulate 20 simultaneous requests for product with capacity = 5:

```typescript
// Pseudo-code
const results = await Promise.all(
    Array(20).fill(null).map(() => 
        createOrderPublic({
            event_id: '...',
            items: [{ product_id: '...', quantity: 1 }],
            email: `test${Math.random()}@example.com`
        })
    )
);

const succeeded = results.filter(r => r.success).length;
expect(succeeded).toBe(5); // Exactly 5 succeed
```

**Expected**:
- 5 orders succeed (status = 'paid' or 'pending')
- 15 orders fail (capacity exceeded)
- No overselling (FOR UPDATE SKIP LOCKED works)

---

## Known Issues & Limitations

1. **Soft delete complexity**: Deleted products still visible to org members (for historical orders). This is intentional.

2. **Capacity updates**: If admin reduces capacity_total BELOW current sold amount, system allows it (does not block past sales). Frontend should warn.

3. **Variant deletion**: Cannot hard delete variant if order_items reference it. Must deactivate instead.

4. **Sales window granularity**: TIMESTAMPTZ is precise to microseconds, but UI may show date-only. Test with full timestamps.

5. **Concurrent variant updates**: If two admins edit same product simultaneously, last write wins (no optimistic locking). Acceptable for MVP.

---

## Success Criteria

**All tests pass**:
- [ ] 10 RLS policy tests
- [ ] 5 edge case tests
- [ ] 7 RPC function tests
- [ ] 2 view tests
- [ ] 1 concurrency test

**Performance**:
- [ ] get_public_products < 100ms for 50 products
- [ ] validate_checkout_capacity < 200ms for 10 items

**Security**:
- [ ] Anonymous cannot create products
- [ ] Org isolation verified (no cross-org leaks)
- [ ] RLS bypassed only via SECURITY DEFINER RPCs

---

**End of Test Context**

*This document provides @supabase-tester with complete testing context.*
*No need to read migration files or guess table structure.*
*All fixtures, cleanup SQL, and test users defined.*

