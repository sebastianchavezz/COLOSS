# Key Architecture Decisions - F015 Products

**Sprint**: S1
**Date**: 2026-02-02
**Architect**: @architect

---

## Decision 1: Products as Separate Entity (Not Ticket Attributes)

### Context
Products kunnen gezien worden als:
- A) Attributes van tickets (bv. `ticket_types.has_lunch`)
- B) Separate entiteiten met eigen lifecycle

### Decision
Separate `products` table, onafhankelijk van tickets.

### Rationale
1. **Standalone products** kunnen zonder tickets verkocht worden
2. **Variants** zijn veel eenvoudiger met aparte tabel
3. **Capacity tracking** is gedistribueerd (per product ipv centraal per event)
4. **Pricing** kan anders zijn (aparte BTW, kortingen)
5. **Toekomst**: Products kunnen herbruikbaar zijn over events

### Consequences
- **Pro**: Clean separation, makkelijk uit te breiden
- **Pro**: Checkout flow blijft modulair
- **Con**: Extra tabellen, complexere queries
- **Con**: order_items wordt polymorphic (ticket OF product)

---

## Decision 2: Dual Category Model (Upgrade vs Standalone)

### Context
Atleta.cc toont twee soorten producten:
- Upgrades die alleen bij tickets gekocht kunnen worden
- Standalone producten zonder ticketvereiste

### Decision
Single `products` table met `category` ENUM ('ticket_upgrade', 'standalone').

### Rationale
1. **Shared attributes**: Beide types hebben dezelfde velden (price, capacity, sales_window)
2. **Reuse RLS**: Zelfde policies voor beide
3. **Eenvoud**: Geen aparte tabellen voor upgrades vs merchandise
4. **Flexibility**: Category kan later uitgebreid worden ('bundle', 'subscription')

### Consequences
- **Pro**: Minder tabellen, minder code duplication
- **Pro**: Eenvoudiger queries (geen UNION tussen tabellen)
- **Con**: Checkout logic moet category-aware zijn
- **Con**: Ticket restrictions table soms leeg (voor standalone)

---

## Decision 3: Variants as Separate Table

### Context
Products hebben vaak varianten (maten, kleuren). Opties:
- A) JSONB column in `products` (flexible maar geen FK's)
- B) Separate `product_variants` table (normalized)

### Decision
Separate `product_variants` table met `product_id` FK.

### Rationale
1. **Capacity tracking**: Elke variant heeft eigen capacity_total
2. **Referential integrity**: order_items kan FK naar variant_id
3. **Query efficiency**: Index op variant_id voor sales reports
4. **RLS**: Separate policies voor variants (bv. inactive hidden)

### Consequences
- **Pro**: Proper normalization, strong consistency
- **Pro**: Variant-level capacity tracking (critical!)
- **Con**: JOIN required voor product + variants listing
- **Con**: Extra RLS policies

---

## Decision 4: Ticket Restrictions via Junction Table

### Context
Upgrade products mogen alleen bij specifieke tickets gekocht worden.

### Decision
Junction table `product_ticket_restrictions` (N:M relationship).

### Rationale
1. **Many-to-many**: Product kan bij meerdere tickets, ticket kan meerdere products unlocking
2. **Explicit opt-in**: Empty restrictions = niet toegestaan (veilig default)
3. **Audit trail**: created_at tracks wanneer restriction toegevoegd
4. **Query efficiency**: Index voor checkout validation

### Consequences
- **Pro**: Explicit, verifiable
- **Pro**: Eenvoudig te updaten (DELETE + INSERT)
- **Con**: Extra table, extra JOIN in checkout
- **Con**: Frontend moet restrictions UI bouwen

---

## Decision 5: Extend order_items Instead of New Table

### Context
Waar store je product orders?
- A) New `product_orders` table
- B) Extend existing `order_items` table

### Decision
Extend `order_items` met `product_id` + `product_variant_id` columns.

### Rationale
1. **Unified order model**: Tickets en products in één order
2. **Reuse logic**: Capacity validation, price calculation, payment flow
3. **Simplicity**: Frontend checkout UI één lijst van items
4. **Reporting**: Aggregated revenue queries makkelijker

### Consequences
- **Pro**: Minder complexity in checkout flow
- **Pro**: Backward compatible (existing columns blijven werken)
- **Con**: Polymorphic foreign keys (ticket_type_id XOR product_id)
- **Con**: Queries moeten beide types checken

**Constraint added**: `CHECK ((ticket_type_id IS NOT NULL AND product_id IS NULL) OR (ticket_type_id IS NULL AND product_id IS NOT NULL))`

---

## Decision 6: Capacity Locking Pattern Reuse

### Context
Products hebben capaciteit net als tickets. Hoe voorkomen we overselling?

### Decision
Reuse exact dezelfde `FOR UPDATE SKIP LOCKED` pattern als tickets.

### Rationale
1. **Proven**: Werkt al voor F006 checkout
2. **Atomic**: Garanteert consistency onder concurrency
3. **Code reuse**: Extend bestaande `validate_checkout_capacity` RPC
4. **Performance**: SKIP LOCKED voorkomt deadlocks

### Consequences
- **Pro**: Geen nieuwe locking strategie nodig
- **Pro**: Consistent gedrag (tickets + products)
- **Con**: Lock order matters (products na tickets om deadlock te voorkomen)

**Lock Order**:
1. ticket_types (bestaand)
2. products (nieuw)
3. product_variants (nieuw)

---

## Decision 7: Sales Window at Product Level

### Context
Wanneer mogen products verkocht worden? Opties:
- A) Gebruik event start/end dates
- B) Product heeft eigen sales_start/sales_end

### Decision
Product-level sales_start/sales_end (optional, defaults to NULL = always available).

### Rationale
1. **Independence**: T-shirt kan al verkocht worden vóór event tickets
2. **Early bird**: Product kan eigen early bird window hebben
3. **Flexibility**: Organizers kunnen phased rollout doen
4. **Compatibility**: NULL = geen restrictie (eenvoudig)

### Consequences
- **Pro**: Maximale flexibiliteit voor organizers
- **Pro**: Separate marketing campaigns mogelijk
- **Con**: Checkout moet product + event window checken
- **Con**: UI complexity (twee sets van dates)

---

## Decision 8: Variant Capacity Overrides Product Capacity

### Context
Als product capacity = 100 en variant "Maat M" capacity = 20, wat geldt?

### Decision
Variant capacity takes precedence. Product capacity is fallback voor variants zonder capacity.

### Rationale
1. **Real-world use case**: 100 shirts totaal, maar per maat gelimiteerd
2. **Logical**: Variant is meer specifiek dan product
3. **Checkout logic**: Check variant capacity first, fallback to product

### Consequences
- **Pro**: Realistic inventory management
- **Pro**: Prevents "50 XXL, 0 M" scenarios
- **Con**: Confusing for admins (need clear UI explanation)
- **Con**: Validation RPC moet beide levels checken

**Implementation**:
```sql
capacity_to_check = COALESCE(variant.capacity_total, product.capacity_total)
```

---

## Decision 9: SECURITY DEFINER RPCs for All Writes

### Context
RLS policies kunnen complex worden voor product CRUD. Alternatief: RPCs.

### Decision
All product write operations via `SECURITY DEFINER` RPCs met expliciete auth checks.

### Rationale
1. **Centralized auth**: One place voor permission checks
2. **Audit logging**: RPCs kunnen audit_log inserts doen
3. **Complex validation**: Upgrade restrictions validation in SQL
4. **Error handling**: Better error messages dan RLS violations

### Consequences
- **Pro**: Cleaner API voor frontend (call RPC ipv INSERT)
- **Pro**: Auditability (every change logged)
- **Con**: More code (9 RPCs voor products module)
- **Con**: Cannot use Supabase auto-generated client (must call RPCs)

---

## Decision 10: Soft Delete for Products

### Context
Wat gebeurt er als admin een product verwijderd dat al in orders zit?

### Decision
Soft delete via `deleted_at` column. Hard delete niet toegestaan als order_items references bestaan.

### Rationale
1. **Historical data**: Orders moeten blijven werken (links naar product)
2. **Audit trail**: Deleted products blijven zichtbaar voor admins
3. **Undo**: Mogelijk om delete te reverteren
4. **Reports**: Historical sales reports blijven kloppen

### Consequences
- **Pro**: Referential integrity behouden
- **Pro**: No cascading deletes
- **Con**: Deleted products blijven in database (growth over time)
- **Con**: Queries moeten `WHERE deleted_at IS NULL` toevoegen

---

**End of Key Decisions**

*Deze beslissingen bepalen de implementatie van F015 Products.*
*Bij vragen of trade-offs review deze rationale.*

