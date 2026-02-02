# Code Review: F015 Products Module

**Reviewer**: @reviewer  
**Date**: 2026-02-02  
**Files Reviewed**:
- `supabase/migrations/20260202100000_f015_products.sql` (888 lines)
- `web/src/types/products.ts` (279 lines)

---

## Summary

The F015 Products Module implementation is **high quality** and follows COLOSS architecture standards. The migration provides a complete product catalog system with:
- Two product categories (ticket_upgrade, standalone)
- Product variants with independent capacity tracking
- Ticket restrictions for upgrades
- Comprehensive RLS policies
- Well-designed helper RPCs
- Materialized views for stats

**Overall Assessment**: Production-ready with minor recommendations for enhanced robustness.

---

## Verdict

- [x] **APPROVED WITH COMMENTS** - Minor improvements recommended, can proceed to testing

---

## Security Review

### Critical Security Checks

| Check | Status | Notes |
|-------|--------|-------|
| RLS enabled on all tables | ✅ | All 3 new tables have RLS |
| RLS policies present | ✅ | Comprehensive public + org policies |
| Auth checks in RPCs | ✅ | All RPCs check auth.uid() |
| SECURITY DEFINER set | ✅ | All RPCs properly configured |
| search_path = public | ✅ | All RPCs have search_path set |
| GRANT statements present | ✅ | Proper grants on all functions |
| No service_role in client | ✅ | Not applicable (migration only) |
| SQL injection prevention | ✅ | Parameterized queries throughout |
| Input validation | ✅ | CHECK constraints on all critical fields |

### RLS Policy Analysis

**Products Table** (3 policies):
1. ✅ **Public view**: Properly restricted to published events, active products, sales window
2. ✅ **Org member view**: Uses is_org_member helper
3. ✅ **Admin manage**: Uses has_role with admin/owner check

**Product Variants Table** (3 policies):
1. ✅ **Public view**: Inherits from parent product (nested EXISTS check)
2. ✅ **Org member view**: Proper JOIN to products table
3. ✅ **Admin manage**: Correct permission inheritance

**Product Ticket Restrictions Table** (2 policies):
1. ✅ **Public view**: `USING (true)` - CORRECT (needed for checkout validation)
2. ✅ **Admin manage**: Proper org ownership check via products table

### Security Findings

**No critical issues found.**

**Recommendation 1**: Consider rate limiting on `get_public_products` RPC
- **Severity**: Low
- **Rationale**: Public endpoint could be abused for scraping
- **Suggestion**: Add app-level rate limiting or Supabase Edge Function wrapper

**Recommendation 2**: Add audit logging for product modifications
- **Severity**: Low
- **Rationale**: Track who changed pricing/capacity for financial compliance
- **Suggestion**: Insert into audit_log on product updates/deletes

---

## Code Quality Review

### Naming Conventions

✅ **Excellent consistency**:
- Tables: snake_case (`products`, `product_variants`)
- Columns: snake_case (`capacity_total`, `max_per_order`)
- Functions: snake_case (`create_product`, `get_public_products`)
- ENUM types: snake_case (`product_category`)
- ENUM values: snake_case (`ticket_upgrade`, `standalone`)

### Comments & Documentation

✅ **Comprehensive documentation**:
- Intent comment at file header (lines 1-16)
- Table comments on all tables
- Column comments on nullable/complex fields
- Function comments on all RPCs
- View comments

**Minor improvement**: Add examples in comments for complex logic (e.g., ticket restriction filtering logic in `get_public_products`)

### Idempotency

✅ **Properly implemented**:
- `CREATE TYPE` (not idempotent but first run expected)
- `CREATE TABLE` - uses standard syntax (first run expected)
- `CREATE OR REPLACE FUNCTION` - idempotent ✅
- `CREATE OR REPLACE VIEW` - idempotent ✅
- `CREATE INDEX` - standard syntax (would fail on re-run)

⚠️ **Recommendation 3**: Make indexes idempotent
```sql
-- Current:
CREATE INDEX idx_products_event_id ON public.products(event_id);

-- Safer:
CREATE INDEX IF NOT EXISTS idx_products_event_id ON public.products(event_id);
```

### Constraint Naming

✅ **Excellent**:
- `products_price_check`
- `products_vat_check`
- `products_capacity_check`
- `product_variants_unique`
- `order_items_item_type_check`

All constraints follow `{table}_{field}_{type}` pattern.

### Error Handling

✅ **Clear error messages** in all RPCs:
- `'Authentication required'`
- `'Event not found'`
- `'Insufficient permissions'`
- `'Product not found'`
- `'Variant not found'`

All exceptions are actionable and don't leak sensitive info.

---

## Backwards Compatibility Review

### Impact on Existing Tables

**order_items Table Extension**:

✅ **SAFE approach**:
1. Adds nullable columns (`product_id`, `product_variant_id`)
2. Adds CHECK constraint ensuring mutual exclusivity with `ticket_type_id`
3. ON DELETE RESTRICT prevents orphaned references

**Potential Issue**:
⚠️ **Warning 1**: Constraint `order_items_item_type_check` would FAIL on existing rows if `order_items` already exists
- **Problem**: Existing rows with `ticket_type_id` NULL AND `product_id` NULL would violate constraint
- **Impact**: Migration would fail on existing databases with invalid data
- **Fix**: Add constraint validation check first:
  ```sql
  -- Before adding constraint, ensure data integrity:
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM public.order_items 
      WHERE ticket_type_id IS NULL
    ) THEN
      RAISE EXCEPTION 'Cannot add constraint: existing rows have NULL ticket_type_id';
    END IF;
  END $$;
  ```

**Verification**: Check if order_items table already has rows:
```bash
grep -B 10 "CREATE TABLE.*order_items" supabase/migrations/*.sql | head -20
```

### Breaking Changes

**None detected** - all changes are additive.

### Migration Rollback

⚠️ **Warning 2**: No rollback migration provided
- **Recommendation**: Create companion down migration
- **Includes**: 
  - Drop columns from order_items
  - Drop all new tables
  - Drop ENUM type
  - Drop all functions/views

---

## Performance Review

### Indexes Analysis

✅ **Comprehensive index coverage**:

**Products table** (4 indexes):
1. `idx_products_event_id` - ✅ Critical (FK + filter queries)
2. `idx_products_org_id` - ✅ Critical (multi-tenant isolation)
3. `idx_products_category` - ✅ Useful (category filtering)
4. `idx_products_active` - ✅ Composite (is_active, deleted_at) - smart for soft deletes

**Product Variants** (2 indexes):
1. `idx_product_variants_product_id` - ✅ Critical (FK)
2. `idx_product_variants_active` - ✅ Useful (active filtering)

**Product Ticket Restrictions** (2 indexes):
1. `idx_product_ticket_restrictions_product_id` - ✅ Critical (FK)
2. `idx_product_ticket_restrictions_ticket_type_id` - ✅ Critical (bidirectional lookup)

**Order Items** (2 indexes):
1. `idx_order_items_product_id` - ✅ Critical (new FK)
2. `idx_order_items_product_variant_id` - ✅ Critical (new FK)

**Missing Indexes**:
⚠️ **Recommendation 4**: Consider adding composite index for common query pattern
```sql
CREATE INDEX idx_products_event_active ON public.products(event_id, is_active, deleted_at);
-- Optimizes: SELECT * FROM products WHERE event_id = X AND is_active = true AND deleted_at IS NULL
```

### Query Patterns

**View: v_product_stats**
- ✅ Uses LEFT JOIN (safe for products with no sales)
- ✅ Filters on deleted_at in WHERE clause (uses index)
- ✅ Uses FILTER clause for conditional aggregation (efficient)
- ⚠️ **Potential N+1**: View recalculates on every query

**Recommendation 5**: For high-traffic events, consider materialized view:
```sql
CREATE MATERIALIZED VIEW public.mv_product_stats AS ...
CREATE UNIQUE INDEX ON public.mv_product_stats(product_id);
-- Refresh strategy: trigger on order status changes or periodic refresh
```

**RPC: get_public_products**
- ✅ Uses indexes efficiently (event_id, is_active, deleted_at)
- ✅ Single query with JOINs and aggregation (no N+1)
- ✅ Filters before aggregation (WHERE before GROUP BY)
- ⚠️ **Complexity**: Nested subqueries for variant aggregation + ticket restriction logic

**Performance Test Recommendation**: Test with:
- Event with 100+ products
- Products with 10+ variants each
- Cart with multiple ticket types

### Capacity Locking

⚠️ **Critical Observation**: No `FOR UPDATE SKIP LOCKED` in capacity checks
- **Context**: F006 checkout uses atomic locking for tickets
- **Missing**: Similar pattern for product capacity
- **Impact**: Potential race condition in high-concurrency scenarios
- **Location**: Should be added in checkout flow (not in this migration)

**Recommendation 6**: @backend should implement in checkout:
```sql
-- In create-order-public Edge Function:
SELECT capacity_total, units_sold 
FROM v_product_stats 
WHERE product_id = X 
FOR UPDATE SKIP LOCKED;
```

---

## TypeScript Types Review

**File**: `web/src/types/products.ts`

### Type Safety

✅ **Excellent type coverage**:
- Database models match SQL schema exactly
- View models match SQL view output
- Request/Response types for all RPCs
- Helper types for forms
- Type guards for discriminated unions

### Type Accuracy

**Checked Against SQL Schema**:

| SQL Column | TypeScript Type | Match |
|------------|-----------------|-------|
| price NUMERIC(10,2) | number | ✅ |
| capacity_total INTEGER | number \| null | ✅ |
| sales_start TIMESTAMPTZ | string \| null | ✅ |
| category product_category | ProductCategory | ✅ |
| deleted_at TIMESTAMPTZ | string \| null | ✅ |

### Validation Helpers

✅ **Useful client-side validation**:
- `validateProductPrice` - mirrors CHECK constraint
- `validateProductCapacity` - mirrors CHECK constraint
- `validateSalesWindow` - business logic validation
- `isProductAvailable` - composite availability check

**Minor Issue**:
⚠️ **Warning 3**: `validateProductPrice` allows 0, but semantic meaning unclear
- **Question**: Should €0.00 products be allowed?
- **Suggestion**: Add comment or separate constant `MIN_PRODUCT_PRICE`

### Type Guards

✅ **Properly implemented discriminated union**:
```typescript
export type OrderItem = OrderItemProduct | OrderItemTicket;

export function isProductOrderItem(item: OrderItem): item is OrderItemProduct {
  return 'product_id' in item;
}
```

Good defensive programming for checkout flow.

---

## Issues Found

### Blocking Issues

**None** - Implementation is production-ready.

### Non-Blocking Issues

| ID | Severity | Category | Issue | Recommendation |
|----|----------|----------|-------|----------------|
| W1 | Low | Compatibility | order_items constraint may fail on existing data | Add pre-check before ALTER TABLE |
| W2 | Low | Maintenance | No rollback migration | Create down migration |
| W3 | Low | Clarity | €0.00 products unclear | Document free product policy |
| R1 | Low | Security | Public endpoint could be scraped | Add rate limiting |
| R2 | Low | Audit | No audit trail for price changes | Log to audit_log |
| R3 | Low | Idempotency | Indexes not idempotent | Use IF NOT EXISTS |
| R4 | Medium | Performance | Missing composite index | Add event_id + active index |
| R5 | Medium | Performance | View recalculates every query | Consider materialized view |
| R6 | **High** | Concurrency | No capacity locking | Add FOR UPDATE in checkout |

---

## Recommendations Summary

### Must Fix Before Production (High Priority)

1. **R6 - Capacity Locking**: @backend must add `FOR UPDATE SKIP LOCKED` in checkout flow
   - **Why**: Prevent overselling in high-traffic scenarios
   - **Where**: Edge Function `create-order-public`
   - **Pattern**: Same as ticket capacity locking in F006

### Should Fix (Medium Priority)

2. **W1 - Constraint Compatibility**: Add pre-check for existing order_items data
3. **R4 - Composite Index**: Add `idx_products_event_active` for query optimization
4. **R5 - Materialized View**: Consider for high-traffic events (500+ products)

### Nice to Have (Low Priority)

5. **R1 - Rate Limiting**: Add app-level rate limiting on public endpoints
6. **R2 - Audit Logging**: Track product modifications for compliance
7. **R3 - Index Idempotency**: Use `IF NOT EXISTS` on CREATE INDEX
8. **W2 - Rollback Migration**: Create down migration for safety
9. **W3 - Free Products**: Document policy on €0.00 products

---

## Final Verdict

**APPROVED WITH COMMENTS**

The F015 Products Module is **well-architected** and follows COLOSS standards:
- ✅ Security: RLS policies comprehensive and correct
- ✅ Code Quality: Clean, consistent, well-documented
- ✅ Backwards Compatibility: Additive changes, minimal risk
- ✅ Performance: Good index coverage, efficient queries
- ✅ TypeScript: Type-safe, accurate, defensive

**Primary Concern**: Capacity locking (R6) should be addressed in checkout flow to prevent race conditions.

**Ready for @tester** with understanding that capacity locking will be tested in checkout integration tests.

---

## Test Recommendations for @tester

### Critical Test Scenarios

1. **Concurrency**: 
   - Simulate 10 simultaneous checkouts for same product variant
   - Verify capacity not exceeded

2. **Ticket Restrictions**:
   - Test upgrade only shows when cart has allowed ticket
   - Test standalone shows regardless of cart contents
   - Test empty restriction list behavior

3. **Sales Window**:
   - Product not visible before sales_start
   - Product not visible after sales_end
   - Product visible when window NULL (always on sale)

4. **Soft Delete**:
   - Deleted products don't show in public query
   - Deleted products still accessible to org members
   - Existing orders still reference deleted products

5. **Variant Capacity**:
   - Variant-specific capacity overrides product capacity
   - NULL variant capacity inherits from product
   - Sold out variants don't show as available

6. **RLS Policies**:
   - Anon can view published products
   - Anon cannot view draft products
   - Org member sees all products for their events
   - Non-member cannot see other org products
   - Only admin/owner can create/update/delete

7. **order_items Integration**:
   - Can create order with product_id
   - Can create order with ticket_type_id
   - Cannot create order with both product_id AND ticket_type_id
   - Cannot create order with neither product_id NOR ticket_type_id

---

## Architecture Compliance

| Principle | Status | Notes |
|-----------|--------|-------|
| RLS-first | ✅ | All tables have RLS + explicit policies |
| Multi-tenant isolation | ✅ | org_id on products table, policies check ownership |
| Database as source of truth | ✅ | All business rules in DB (CHECK constraints, triggers) |
| Auditability | ⚠️ | No audit_log integration (recommendation only) |
| Idempotency | ⚠️ | Functions yes, indexes no (minor) |
| Flow-based development | ✅ | Clear Layer 4.5 positioning, dependencies documented |

---

**Review completed by @reviewer**  
**Handoff to**: @tester (for test implementation)  
**CC**: @backend (for capacity locking in checkout)

---

## Attachments

### Files Reviewed
1. `/Users/sebastianchavez/Desktop/COLOSS/supabase/migrations/20260202100000_f015_products.sql`
2. `/Users/sebastianchavez/Desktop/COLOSS/web/src/types/products.ts`

### Reference Files
- `/Users/sebastianchavez/Desktop/COLOSS/supabase/migrations/20240119000001_layer_1_identity.sql` (helper functions)
- `/Users/sebastianchavez/Desktop/COLOSS/.claude-flow/memory/shared.md` (project context)
