# F009 S2: Refund Flow Waterdicht

## Doel
Fix de complete refund webhook chain zodat klanten daadwerkelijk hun geld terugkrijgen.

## Kritieke Bugs

### 1. CHAIN-BREAKING: Mollie API endpoint fout (mollie-webhook)
- `handleRefundWebhook` gebruikt `GET /v2/refunds/{id}` maar die endpoint bestaat NIET
- Correct: `GET /v2/payments/{paymentId}/refunds/{refundId}`
- Impact: ELKE refund webhook faalt stil met 404. Status wordt NOOIT bijgewerkt.

### 2. handle_refund_webhook audit log verkeerde kolom
- Gebruikt `details` kolom die niet bestaat (moet `metadata` zijn)
- Impact: audit log INSERT faalt, RPC crasht

### 3. Order status wordt nooit 'refunded'
- Na volledige refund blijft order op 'paid'
- Impact: verwarrend voor organizers in dashboard

### 4. create-refund status mapping incompleet
- `failed`/`canceled` van Mollie wordt `processing`
- Impact: fout status in database

## Scope
1. Fix mollie-webhook refund endpoint (lookup payment_id first, then fetch)
2. Fix handle_refund_webhook audit log + add order status update
3. Fix create-refund status mapping
4. Tests
