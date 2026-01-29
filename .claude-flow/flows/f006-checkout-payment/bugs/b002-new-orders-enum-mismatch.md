# B002: Nieuwe orders pending door enum mismatches

**Status**: ✅ Fixed
**Flow**: f006-checkout-payment
**Date**: 28-01-2026
**Attempts**: 3

## Bug

Na B001 fix bleven NIEUWE orders nog steeds op "pending" staan. De webhook returned 200 OK maar de RPC faalde intern.

Test order: `9710790f` (flow-test@coloss.nl, €40)

## Root Causes

1. **ticket_instance_status enum** - RPC gebruikte `'valid'` maar enum heeft alleen: `'issued', 'void', 'checked_in'`

2. **ticket_status enum (legacy)** - De `tickets` tabel heeft andere enum: `'valid', 'used', 'cancelled'`. RPC probeerde `'issued'` te gebruiken.

3. **ON CONFLICT zonder constraint** - `ticket_instances` tabel heeft geen UNIQUE constraint op `(order_item_id, sequence_no)`, waardoor ON CONFLICT faalt.

## Fix

### Migrations
- `20250128235000_f006_fix_valid_enum.sql` - Remove 'valid' from ticket_instance queries
- `20250128235500_f006_fix_ticket_status_enums.sql` - Correct enums per tabel
- `20250129000000_f006_remove_on_conflict.sql` - Remove ON CONFLICT, use explicit idempotency

### Code Changes
- `handle_payment_webhook`:
  - `tickets.status = 'valid'::ticket_status` (legacy tabel)
  - `ticket_instances.status = 'issued'::ticket_instance_status` (nieuwe tabel)
  - Removed `ON CONFLICT (order_item_id, sequence_no)`
  - Added explicit idempotency check before insert

## Files
- `supabase/migrations/20250128235000_f006_fix_valid_enum.sql`
- `supabase/migrations/20250128235500_f006_fix_ticket_status_enums.sql`
- `supabase/migrations/20250129000000_f006_remove_on_conflict.sql`

## Test
- [x] Order 9710790f succesvol naar "paid" via admin-retry-webhook
- [x] Webhook returns 200 OK
- [x] Tickets issued correct

## Notes

Attempt 1: Remove 'valid' → `invalid input value for enum ticket_status: "issued"`
Attempt 2: Fix both enums → `no unique constraint matching ON CONFLICT`
Attempt 3: Remove ON CONFLICT, explicit idempotency → Success

## Enum Reference

| Tabel | Enum | Values |
|-------|------|--------|
| `tickets` | `ticket_status` | valid, used, cancelled |
| `ticket_instances` | `ticket_instance_status` | issued, void, checked_in |
