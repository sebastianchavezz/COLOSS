# Mollie Sandbox Setup Guide

## Stap 1: Mollie Test API Key

1. Ga naar [Mollie Dashboard](https://my.mollie.com/dashboard)
2. Log in met je Mollie account
3. Ga naar **Settings** → **Website profiles** → Kies je profiel
4. Klik op **API keys**
5. Kopieer de **Test API key** (begint met `test_`)

> **Belangrijk**: Gebruik ALTIJD de test key voor development, NOOIT de live key!

## Stap 2: Configureer Supabase

Run dit commando met jouw test API key:

```bash
npx supabase secrets set MOLLIE_API_KEY=test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Verifieer dat het is ingesteld:
```bash
npx supabase secrets list | grep MOLLIE
```

## Stap 3: Test Payment Aanmaken

Voor refunds heb je eerst een betaalde order nodig. In test mode:

### Optie A: Via Simulate Payment (Aanbevolen)

Als `SIMULATE_PAYMENTS_ENABLED=true` is ingesteld, kun je betalingen simuleren:

```bash
# 1. Maak een test order aan
curl -X POST 'https://yihypotpywllwoymjduz.supabase.co/functions/v1/create-order-public' \
  -H 'Content-Type: application/json' \
  -d '{
    "event_id": "YOUR_EVENT_ID",
    "items": [{"ticket_type_id": "YOUR_TICKET_TYPE_ID", "quantity": 1}],
    "participant": {"email": "test@example.com", "first_name": "Test", "last_name": "User"}
  }'

# 2. Simuleer betaling (als enabled)
curl -X POST 'https://yihypotpywllwoymjduz.supabase.co/functions/v1/simulate-payment' \
  -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"order_id": "ORDER_ID_FROM_STEP_1"}'
```

### Optie B: Via Mollie Test Checkout

1. Maak een order aan
2. Ga naar de checkout URL
3. Gebruik Mollie test credentials:
   - **iDEAL**: Selecteer een test bank
   - **Credit Card**:
     - Number: `4000 0000 0000 0002`
     - Expiry: Any future date
     - CVC: Any 3 digits

## Stap 4: Test Refund Aanmaken

Nu je een betaalde order hebt:

```bash
# Full refund
curl -X POST 'https://yihypotpywllwoymjduz.supabase.co/functions/v1/create-refund' \
  -H 'Authorization: Bearer YOUR_USER_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "order_id": "PAID_ORDER_ID",
    "idempotency_key": "test-refund-001"
  }'

# Partial refund (500 cents = €5.00)
curl -X POST 'https://yihypotpywllwoymjduz.supabase.co/functions/v1/create-refund' \
  -H 'Authorization: Bearer YOUR_USER_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "order_id": "PAID_ORDER_ID",
    "amount_cents": 500,
    "reason": "Partial refund test",
    "idempotency_key": "test-refund-002"
  }'
```

## Stap 5: Webhook Testing

Mollie stuurt webhooks naar je endpoint. In test mode:

### Lokaal testen met ngrok

```bash
# Start ngrok tunnel
ngrok http 54321

# Update Mollie webhook URL in je code of Mollie dashboard
# naar: https://xxxx.ngrok.io/functions/v1/mollie-webhook
```

### Of: Handmatig webhook simuleren

```bash
# Simuleer refund webhook (service role needed)
curl -X POST 'https://yihypotpywllwoymjduz.supabase.co/functions/v1/mollie-webhook' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'id=re_test123456'
```

## Mollie Test Refund Statuses

In test mode doorloopt een refund deze statussen:

| Status | Beschrijving |
|--------|-------------|
| `queued` | Refund is aangemaakt, wacht op verwerking |
| `pending` | Refund wordt verwerkt |
| `refunded` | Refund is succesvol |

Om een specifieke status te testen, kun je de Mollie test API gebruiken met speciale bedragen:
- Normaal bedrag → `refunded` (success)
- Bedrag eindigt op `.00` → direct `refunded`

## Troubleshooting

### "MOLLIE_NOT_CONFIGURED" error
→ MOLLIE_API_KEY is niet ingesteld. Run: `npx supabase secrets set MOLLIE_API_KEY=test_xxx`

### "UNAUTHORIZED" error
→ Je bent niet ingelogd of geen org admin. Check je Bearer token.

### "ORDER_NOT_PAID" error
→ De order heeft nog geen succesvolle betaling. Gebruik simulate-payment of voltooi Mollie checkout.

### Webhook komt niet aan
→ Check of je webhook URL correct is geconfigureerd in Mollie dashboard of via metadata.

## Verification Queries

Check refunds in de database:

```sql
-- Alle refunds
SELECT r.*, o.email
FROM refunds r
JOIN orders o ON o.id = r.order_id
ORDER BY r.created_at DESC;

-- Refund status per order
SELECT
  o.id as order_id,
  o.total_amount,
  SUM(CASE WHEN r.status = 'refunded' THEN r.amount_cents ELSE 0 END) / 100.0 as refunded,
  SUM(CASE WHEN r.status IN ('pending', 'queued', 'processing') THEN r.amount_cents ELSE 0 END) / 100.0 as pending
FROM orders o
LEFT JOIN refunds r ON r.order_id = o.id
WHERE o.status = 'paid'
GROUP BY o.id, o.total_amount;
```

---

*Created: 2026-01-28*
