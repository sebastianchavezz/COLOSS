# F015 Products Module - Test Documentation

**Flow**: F015 Products Module
**Sprint**: S1 - Data Layer
**Status**: 🟡 Active Testing

---

## Test Files

### `integration-tests.mjs`
**Type**: Automated Integration Tests
**Runtime**: Node.js (ES Modules)
**Coverage**: RPC Functions, Views, Auth, Edge Cases

#### How to Run
```bash
# From project root
node .claude-flow/flows/f015-products/tests/integration-tests.mjs
```

#### What It Tests

**RPC Existence Tests (1-8)**
- Verifies all 8 RPC functions exist
- Functions tested:
  - `create_product`
  - `update_product`
  - `delete_product`
  - `get_public_products`
  - `create_product_variant`
  - `update_product_variant`
  - `delete_product_variant`
  - `set_product_ticket_restrictions`

**Authentication Tests (9-12)**
- Anonymous users blocked from admin operations
- Anonymous users CAN access public products
- Auth error messages are correct

**View Queryability Tests (13-14)**
- `v_product_stats` exists and queryable
- `v_product_variant_stats` exists and queryable

**Response Structure Tests (15-16)**
- Error responses have correct structure
- Success responses have expected fields

**Edge Case Tests (17-20)**
- Invalid category rejection
- Null event_id handling
- Negative price validation
- Negative capacity validation

---

## Test Scenarios Coverage

### Happy Path (Covered by existence tests)
- ✅ RPC functions are callable
- ✅ Auth checks work as expected
- ✅ Views are accessible

### Security Tests (Covered by auth tests)
- ✅ Anonymous blocked from create operations
- ✅ Anonymous blocked from update operations
- ✅ Anonymous blocked from delete operations
- ✅ Anonymous CAN view public products

### Edge Cases (Covered by edge case tests)
- ✅ Invalid enum values
- ✅ Null parameters
- ✅ Negative numbers
- ✅ Constraint violations

---

## Test Matrix

| Category | Test Count | Status |
|----------|-----------|--------|
| RPC Existence | 8 | ✅ |
| Authentication | 4 | ✅ |
| Views | 2 | ✅ |
| Response Structure | 2 | ✅ |
| Edge Cases | 4 | ✅ |
| **TOTAL** | **20** | ✅ |

---

## Known Limitations

1. **No authenticated tests**: Current tests only verify anonymous access. Authenticated scenarios (admin creating products) require auth setup.
2. **No capacity locking tests**: FOR UPDATE SKIP LOCKED logic not tested (requires concurrent operations).
3. **No integration with checkout**: Testing products in actual order flow requires separate E2E tests.

---

## Manual Testing Guide

For scenarios not covered by automated tests:

### Test 1: Create Product as Admin
```sql
-- Login as admin user, then:
SELECT create_product(
  _event_id := '<your-event-id>',
  _category := 'standalone',
  _name := 'Test Merchandise',
  _description := 'Cool event T-shirt',
  _price := 25.00,
  _capacity_total := 100
);
```

### Test 2: Create Product with Variants
```sql
-- After creating product:
SELECT create_product_variant(
  _product_id := '<product-id>',
  _name := 'Maat S',
  _capacity_total := 30
);

SELECT create_product_variant(
  _product_id := '<product-id>',
  _name := 'Maat M',
  _capacity_total := 40
);
```

### Test 3: Set Ticket Restrictions
```sql
-- Restrict product to specific tickets:
SELECT set_product_ticket_restrictions(
  _product_id := '<product-id>',
  _ticket_type_ids := ARRAY['<ticket-1-id>', '<ticket-2-id>']::UUID[]
);
```

### Test 4: Verify Public View
```sql
-- As anonymous user:
SELECT * FROM get_public_products(
  _event_id := '<event-id>',
  _cart_ticket_type_ids := ARRAY[]::UUID[]
);
```

---

## Next Steps

### After S1 Completion
- [ ] Add authenticated test suite
- [ ] Test capacity locking with concurrent orders
- [ ] Test sales window enforcement
- [ ] Test soft delete behavior

### Integration with F006 Checkout
- [ ] Test adding products to orders
- [ ] Test variant selection in checkout
- [ ] Test ticket restriction validation
- [ ] Test capacity reservation

---

## Bug Tracking

Report bugs in: `.claude-flow/flows/f015-products/bugs/`

### Bug Report Template
```markdown
# Bug: [Short Title]

## Severity
- [ ] Critical
- [ ] High
- [ ] Medium
- [ ] Low

## Test Case
{Which test failed?}

## Expected Behavior
{What should happen?}

## Actual Behavior
{What actually happened?}

## Reproduction
{Steps or test code}
```

---

**Last Updated**: 2026-02-02
**Tester**: @tester
**Next Review**: After S1 implementation complete
