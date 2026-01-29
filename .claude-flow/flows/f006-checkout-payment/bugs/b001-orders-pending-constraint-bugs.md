# B001: Orders blijven pending na Mollie betaling (constraint bugs)

**Status**: ✅ Fixed
**Flow**: f006-checkout-payment
**Date**: 28-01-2026
**Attempts**: 3

## Bug

Orders bleven op "In behandeling" staan in de frontend terwijl Mollie betalingen succesvol waren. De webhook werd ontvangen maar de RPC `handle_payment_webhook` faalde.

## Root Causes

1. **ON CONFLICT ON CONSTRAINT met INDEX** - De trigger gebruikte `ON CONFLICT ON CONSTRAINT idx_participants_email_unique` maar dit is een INDEX, geen CONSTRAINT. PostgreSQL accepteert alleen echte constraints.

2. **Missing audit_log columns** - De `audit_log` tabel heeft `resource_type` en `resource_id` als NOT NULL, maar deze ontbraken in de INSERT statements.

3. **Email outbox te complex** - De `email_outbox` tabel heeft veel verplichte velden die niet vanuit een trigger te populeren zijn.

## Fix

### Migrations
- `20250128232000_f006_fix_constraint_references.sql` - ON CONFLICT syntax fix
- `20250128233000_f006_fix_audit_log_columns.sql` - Added resource_type/resource_id
- `20250128234000_f006_skip_email_outbox.sql` - Removed email outbox from triggers

### Code Changes
- `sync_registration_on_order_paid`: `ON CONFLICT ON CONSTRAINT idx_participants_email_unique` → `ON CONFLICT (email) WHERE deleted_at IS NULL`
- `sync_registration_on_payment`: Same fix + audit_log columns added
- Email outbox removed from triggers (handled by Edge Functions)

## Files
- `supabase/migrations/20250128232000_f006_fix_constraint_references.sql`
- `supabase/migrations/20250128233000_f006_fix_audit_log_columns.sql`
- `supabase/migrations/20250128234000_f006_skip_email_outbox.sql`

## Test
- [x] Existing pending orders gefixed via admin-fix-all-orders
- [x] 9 orders succesvol naar "paid" gezet

## Notes

Attempt 1: Constraint fix → Audit log error
Attempt 2: Audit log columns fix → Email outbox error
Attempt 3: Email outbox removed → Success
