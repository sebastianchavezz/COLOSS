# F006 Sprint 3: Waterdichte Mollie Integration

## Sprint Goal
Maak de checkout en webhook flow 100% betrouwbaar volgens Mollie best practices.

## Research Summary

### Mollie Webhook Best Practices (bron: docs.mollie.com)

| Aspect | Best Practice | Status |
|--------|---------------|--------|
| Verificatie | Altijd re-fetch van Mollie API, nooit IP whitelist | ✅ Al geïmplementeerd |
| Response | Return 200 OK voor alle requests (ook unknown IDs) | ⚠️ Moet fixen |
| Timeout | Mollie timeout na 15 seconden | ⚠️ Moet checken |
| Redirects | Vermijd 301/302 (use 307/308) | ✅ N.v.t. (geen redirects) |
| Idempotency | Check of resource echt gewijzigd is | ✅ Via payment_events table |
| Retry | Mollie retry 10x over 26 uur | ✅ We returnen 500 voor transient errors |

## Planned Changes

### 1. Webhook Response Codes (Critical)
- Return 200 OK voor unknown payment IDs (security best practice)
- Return 200 OK voor duplicate events (idempotency)
- Return 500 alleen voor transient DB/network errors

### 2. Timeout Optimization
- Ensure webhook completes within 15 seconds
- Add timeout to Mollie API fetch (10s max)

### 3. Error Handling Improvements
- Better logging for debugging
- Graceful handling of missing data

### 4. Payment Simulation Fix
- Grant proper permissions for simulate_payment_success RPC
- Make development testing easier

### 5. Comprehensive Tests
- Webhook idempotency test
- Unknown payment ID test
- Timeout handling test
- Full E2E flow test

## Sources
- [Mollie Webhooks Documentation](https://docs.mollie.com/reference/webhooks)
- [Mollie Testing Guide](https://docs.mollie.com/reference/testing)
- [ngrok for Local Testing](https://docs.umbraco.com/umbraco-commerce-payment-providers/mollie/how-to-guides/testing-mollie-webhooks-locally)

---

*Created: 2026-01-28*
