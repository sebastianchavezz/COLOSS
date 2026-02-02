# B003: RPC Schema Cache 404 Error

**Status**: ✅ Fixed
**Flow**: F015
**Date**: 2026-02-02
**Attempts**: 1

## Bug

Na het pushen van de F015 migration gaven RPC calls nog steeds 404 errors:

```
POST https://yihypotpywllwoymjduz.supabase.co/rest/v1/rpc/create_product 404 (Not Found)
PGRST202: Could not find the function public.create_product in the schema cache
```

Dit is een bekend Supabase/PostgREST probleem: de schema cache kan tot 1 uur duren om te refreshen na nieuwe functies.

## Fix

Fallback logica toegevoegd aan alle RPC functies in `web/src/data/products.ts`:

1. Eerst RPC proberen
2. Als RPC faalt met `PGRST202` of "schema cache" error:
   - Fallback naar directe tabel operaties
   - Console warning voor debugging

### Functies met fallback:
- `createProduct` - Direct insert naar `products` tabel
- `updateProduct` - Direct update op `products` tabel
- `deleteProduct` - Direct soft delete (set deleted_at)
- `createProductVariant` - Direct insert naar `product_variants`
- `updateProductVariant` - Direct update op `product_variants`
- `deleteProductVariant` - Direct delete van `product_variants`
- `setProductTicketRestrictions` - Direct delete + insert op `product_ticket_restrictions`

## Files

- `web/src/data/products.ts` - Alle 7 RPC functies hebben nu fallback logica

## Test

- [x] createProduct fallback werkt
- [x] updateProduct fallback werkt
- [x] deleteProduct fallback werkt
- [x] Variant CRUD fallbacks werken
- [x] TypeScript compileert zonder errors

## Notes

De fallback is een tijdelijke workaround. Zodra de Supabase schema cache refresht (automatisch binnen 1 uur), zullen de RPCs normaal werken en de fallback niet meer nodig zijn.

De fallback respecteert dezelfde RLS policies omdat directe tabel operaties ook door RLS gaan.

---
*Fixed: 2026-02-02*
