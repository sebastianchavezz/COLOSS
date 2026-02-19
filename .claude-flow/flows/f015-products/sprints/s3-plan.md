# F015 S3: Waterdichte Product Upsell Flow

## Status: DONE

## Scope
End-to-end product upsell flow: checkout integratie, scanner product info, email product info.

## Changes

### Bug Fix
- `web/src/data/products.ts`: Fixed `getPublicProducts()` return - RPC returns table directly, not `data.products`

### Database Migrations
1. `20260219500000_f015_s3_scanner_products.sql` - `scan_ticket` uitgebreid met `order_products` array in response
2. `20260219500001_f015_s3_email_products.sql` - `queue_ticket_delivery_email` uitgebreid met "JE EXTRA'S" sectie

### Frontend
1. `web/src/types/products.ts` - Added `getProductStatusBadge()` helper
2. `web/src/pages/public/PublicEventCheckout.tsx` - Full products section: fetch, display, variant selector, quantity, checkout integration, standalone products support
3. `web/src/pages/public/PublicEventDetail.tsx` - Product preview in sidebar (max 4 items)
4. `web/src/pages/ScanPage.tsx` - Order products display in scan result card

## Key Decisions
- Products shown for **entire order** at scan (not filtered per ticket type)
- Standalone products can be purchased **without tickets**
- `ticket_upgrade` products only appear when matching ticket is selected
- Product data in email uses same dark theme styling as tickets
- HTML-escaped all user content in emails
