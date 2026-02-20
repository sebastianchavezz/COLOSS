# F006 S7 Architecture: Ticket Flow Waterdicht

## 1. QR Code Fix (handle_payment_webhook)

### Probleem
```sql
-- HUIDIGE CODE (BROKEN):
token_hash = encode(digest(gen_random_uuid()::text::bytea, 'sha256'), 'hex'),  -- UUID_A
qr_code = gen_random_uuid()::text,                                             -- UUID_B (ANDERS!)
```

### Oplossing
Gebruik een CTE om 1 raw token te genereren per ticket, en leid daar beide waarden van af:
```sql
WITH raw_tokens AS (
  SELECT seq, gen_random_uuid()::text AS raw_token
  FROM generate_series(1, quantity) AS seq
)
INSERT INTO ticket_instances (... token_hash, qr_code ...)
SELECT ...,
  encode(digest(raw_token::bytea, 'sha256'), 'hex'),
  raw_token
FROM raw_tokens;
```

### Backfill
Bestaande tickets waarbij token_hash != sha256(qr_code) moeten gerepareerd worden:
```sql
UPDATE ticket_instances
SET token_hash = encode(digest(qr_code::bytea, 'sha256'), 'hex')
WHERE token_hash != encode(digest(qr_code::bytea, 'sha256'), 'hex');
```

## 2. void_tickets_for_refund Fix

### Bugs
1. `status = 'voided'` → moet `'void'` zijn
2. `voided_at` kolom bestaat niet → gebruik `updated_at`
3. `voided_reason` kolom bestaat niet → verwijder
4. `status IN ('valid', 'issued')` → `'valid'` is geen geldige enum → alleen `'issued'`
5. `audit_log` kolommen `resource_type`/`resource_id`/`details` → moeten `entity_type`/`entity_id`/`metadata` zijn

## 3. RLS Lockdown

### ticket_instances
```sql
DROP POLICY "System can create ticket instances" ON ticket_instances;
CREATE POLICY "Deny direct ticket instance creation" ON ticket_instances FOR INSERT WITH CHECK (false);
```

### tickets (legacy)
```sql
DROP POLICY "System/Users can create tickets" ON tickets;
CREATE POLICY "Deny direct ticket creation" ON tickets FOR INSERT WITH CHECK (false);
```

Ticket creatie gaat via SECURITY DEFINER functies (handle_payment_webhook, issue-tickets) die als service_role draaien en RLS bypassen.

## 4. Transfer Edge Functions Rewrite

### initiate-transfer Bugs
- Query't `tickets` tabel → moet `ticket_instances`
- Insert't `from_user_id`, `initiated_by_user_id` → bestaan niet
- Mist: `from_participant_id`, `transfer_token_hash`, `expires_at`, `org_id`, `event_id`

### accept-transfer Bugs
- Leest `transfer.ticket_instance_id` → kolom heet `ticket_id`

### Nieuwe Flow
```
initiate-transfer:
1. Auth user
2. Find ticket_instance by ID where owner_user_id = auth.uid()
3. Find participant for user
4. Generate transfer_token + hash
5. Insert into ticket_transfers with all required fields
6. Queue notification emails

accept-transfer:
1. Auth user
2. Hash incoming token → find transfer by transfer_token_hash
3. Check pending + not expired
4. Resolve/create recipient participant
5. Call complete_ticket_transfer RPC with correct column name (ticket_id)
```

## 5. Capacity Counting Unification

### Probleem
- Checkout: telt `order_items.quantity` van `pending + paid` orders
- Webhook: telt `ticket_instances` met `issued + checked_in` status

### Oplossing
Webhook counting is correcter (telt daadwerkelijk uitgegeven tickets).
Checkout counting via order_items is nodig voor reservering (pending orders reserveren capaciteit).
**Beide zijn correct voor hun context** - checkout reserveert, webhook verifieert.

Wat WEL gefixed moet worden: cleanup_stale_pending_orders moet daadwerkelijk draaien zodat phantom blocks verdwijnen.

## 6. Cleanup Jobs

### cleanup_expired_transfers (NIEUW)
```sql
CREATE OR REPLACE FUNCTION cleanup_expired_transfers()
RETURNS INTEGER AS $$
  UPDATE ticket_transfers SET status = 'expired', updated_at = NOW()
  WHERE status = 'pending' AND expires_at < NOW()
  RETURNING id;
$$;
```

### Scheduling
Beide cleanup functies worden aanroepbaar via Edge Function (pg_cron is niet beschikbaar in Supabase hosted):
- `cleanup-jobs` Edge Function die beide aanroept
- Scheduling via externe cron (Supabase cron extension of Netlify scheduled function)

## 7. Overbooked Order Handling

Wanneer webhook detecteert dat een order overbooked is:
1. Cancel de order (al geimplementeerd)
2. Queue refund in email_outbox met template 'overbooked_refund'
3. Log in audit_log

Dit vereist dat de Mollie refund via process-outbox of een aparte function wordt afgehandeld.
Voor nu: queue email notificatie + audit log. Automatische Mollie refund is P2.
