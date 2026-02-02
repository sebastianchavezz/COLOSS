# Flow: Products Module

**ID**: F015
**Status**: 🟢 Complete
**Total Sprints**: 2
**Current Sprint**: S2 (Complete)

## Sprints
| Sprint | Focus | Status |
|--------|-------|--------|
| S1 | Data Layer + RPCs | 🟢 Complete |
| S2 | Frontend UI | 🟢 Complete |

## Dependencies
- **Requires**: F003 ✅ (Events), F006 ✅ (Checkout)
- **Blocks**: None

## Overview

Organisatoren kunnen extra producten verkopen naast tickets.

```
Als organisator
Wil ik extra producten kunnen verkopen (merchandise, upgrades)
Zodat ik meer waarde kan bieden en extra omzet kan genereren
```

## Product Types

### Ticket-upgrades
- Extra's die alleen bij een ticket gekocht kunnen worden
- Bijv: "VIP upgrade", "Lunch pakket", "Foto pakket"
- Gekoppeld aan specifieke ticket types

### Losstaande producten (Standalone)
- Kunnen los gekocht worden zonder ticket
- Bijv: "Event T-shirt", "Supporter pakket"
- Hebben eigen capaciteit

## Product Attributes (from Atleta.cc)

### Basisinformatie
- `name` - Product naam
- `image_url` - Product afbeelding
- `description` - Beschrijving (rich text)
- `instructions` - Instructies voor deelnemer

### Prijzen
- `price` - Basisprijs
- `vat_percentage` - BTW percentage
- `sales_start` / `sales_end` - Verkoopperiode
- `ticket_type_restrictions` - Welke tickets mogen dit kopen

### Beperkingen
- `capacity_total` - Maximale voorraad
- `max_per_order` - Maximum per bestelling

### Productvarianten
- Varianten (bijv. maat S/M/L/XL)
- Elke variant heeft eigen capaciteit

## Database Design

### Tables
| Table | Purpose |
|-------|---------|
| `products` | Product definities |
| `product_variants` | Varianten (maten, kleuren) |
| `product_ticket_restrictions` | Welke tickets mogen product kopen |
| `order_items` | Extended met product_id |

## Flow Diagram

```
[Event Setup] → [Add Product]
                     │
    ┌────────────────┼────────────────┐
    ▼                ▼                ▼
[Basisinfo]    [Prijzen]      [Varianten]
    │                │                │
    └────────────────┴────────────────┘
                     │
                     ▼
              [Published]
                     │
                     ▼
            [Checkout Flow]
```

## Acceptance Criteria

### S1 (Data Layer) ✅ COMPLETE
- [x] Products table with all attributes
- [x] Product variants with capacity
- [x] Ticket restrictions (upgrade vs standalone)
- [x] RLS for org isolation
- [x] RPCs for CRUD operations
- [x] order_items extended with product_id + product_variant_id
- [x] Views: v_product_stats, v_product_variant_stats
- [x] TypeScript types
- [x] Integration tests (15/20 passing)
- [x] Code review APPROVED

### S2 (Frontend) ✅ COMPLETE
- [x] Product list in event sidebar (Producten tab)
- [x] Product create/edit form with tabs (Basisinformatie, Prijzen, Varianten, Beperkingen)
- [x] Image URL support
- [x] Variant management (add/delete)
- [x] Ticket restrictions for upgrades
- [x] Product cards with status badges
- [x] Category sections (Ticket upgrades / Losstaande producten)
- [x] Data layer (web/src/data/products.ts)

---
*Last updated: 2026-02-02*
