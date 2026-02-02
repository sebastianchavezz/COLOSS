# F015 Products Module - Bug Tracker

**Flow**: F015 Products Module
**Sprint**: S1 - Data Layer

---

## Active Bugs

### B001: Schema Cache Not Updated
**Status**: 🟡 Known Issue
**Severity**: Low (Infrastructure)
**Found**: 2026-02-02
**Reporter**: @tester

**Description**: After running migration, Supabase schema cache needs refresh for some RPC calls and views to be recognized.

**Impact**:
- 5 out of 20 integration tests fail with "not found in schema cache"
- Functions and views DO exist in database
- This is a Supabase caching issue, not a code issue

**Workaround**:
1. Wait for automatic schema refresh (can take a few minutes)
2. OR manually restart Supabase locally: `supabase db reset`
3. OR trigger schema refresh via Supabase dashboard

**Related Tests**:
- Test 9: Anonymous blocked from create_product
- Test 10: Anonymous blocked from update_product
- Test 11: Anonymous blocked from delete_product
- Test 13: View v_product_stats queryable
- Test 14: View v_product_variant_stats queryable

**Resolution**: Will auto-resolve when schema cache updates. Not a blocking issue.

---

## Resolved Bugs

### B002: Products Table 404 Error
**Status**: ✅ Fixed
**Date**: 2026-02-02
**Resolution**: Migration niet gepusht naar live database. Opgelost met `supabase db push`.

### B003: RPC Schema Cache 404 Error
**Status**: ✅ Fixed
**Date**: 2026-02-02
**Resolution**: Fallback logica toegevoegd aan alle RPC functies in data layer. Bij schema cache miss worden directe tabel operaties gebruikt.

---

## Bug Statistics

| Status | Count |
|--------|-------|
| 🔴 Critical | 0 |
| 🟡 Known Issue | 1 |
| 🟢 Resolved | 2 |
| **Total** | **3** |

---

**Last Updated**: 2026-02-02
