# F006 Sprint 2: Mollie Sandbox Integration Upgrade

## Sprint Goal
Upgrade de checkout flow voor betere Mollie sandbox testing support.

## Issues Identified

1. **Bug in create-order-public**: `.catch()` wordt direct aangeroepen op Supabase query result, maar dat is geen Promise met `.catch()` method
2. **Geen test mode indicator**: Geen manier om te zien of we in test mode zijn
3. **Moeilijk te testen**: Geen eenvoudige manier om een complete checkout flow te testen

## Planned Changes

### 1. Fix create-order-public Bug
**File**: `supabase/functions/create-order-public/index.ts`
**Issue**: Lines 285-289 en 425-436 gebruiken `.catch()` direct op Supabase query
**Fix**: Wrap in try/catch

### 2. Add Test Mode Detection
- Log of we test API key gebruiken
- Include test mode indicator in response

### 3. Add E2E Test Script
**File**: `.claude-flow/flows/f006-checkout-payment/tests/e2e-sandbox-test.mjs`
- Complete checkout flow test
- Works with Mollie sandbox

## Dependencies
- MOLLIE_API_KEY must be set (✅ Done: test_u6Dtbxm...)

## Timeline
- Single sprint, no database changes needed
- Only Edge Function updates

---

*Created: 2026-01-28*
