# B001: Products table 404 error

**Status**: ✅ Fixed
**Flow**: F015
**Date**: 2026-02-02
**Attempts**: 1

## Bug

De EventProducts.tsx pagina gaf een 404 error bij het laden van producten:

```
Failed to load resource: the server responded with a status of 404 ()
[EventProducts] Error: Object
```

De query naar `/rest/v1/products` faalde omdat de tabel niet bestond.

## Root Cause

De migration `20260202100000_f015_products.sql` was lokaal aangemaakt maar nog niet gepusht naar de live Supabase database.

## Fix

Migration gepusht naar Supabase:

```bash
npx supabase db push
```

Output:
```
Applying migration 20260202100000_f015_products.sql...
Finished supabase db push.
```

## Files

- `supabase/migrations/20260202100000_f015_products.sql` - Migration was al correct

## Test

- [x] `products` tabel bestaat nu (returns [] in plaats van 404)
- [x] `product_variants` tabel exists
- [x] `product_ticket_restrictions` tabel exists
- [x] RPCs (`get_public_products`) werken

## Notes

Attempt 1: Checked migration status with `supabase migration list`, zag dat `20260202100000` niet was toegepast. Gepusht met `db push`. Succes.

---
*Fixed: 2026-02-02*
