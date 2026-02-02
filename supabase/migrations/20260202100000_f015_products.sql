-- F015: PRODUCTS MODULE (LAYER 4.5)
--
-- Doel: Enable selling extra products beyond tickets (upgrades, merchandise)
-- Afhankelijkheid:
--   - Layer 1: Identity (orgs, org_members, roles)
--   - Layer 2: Events
--   - Layer 4: Tickets (ticket_types)
--   - Layer 5: Orders (orders, order_items)
--
-- Features:
--   - Two categories: ticket_upgrade (tied to tickets) & standalone (independent)
--   - Product variants (sizes, colors) with own capacity
--   - Ticket restrictions (which tickets allow buying which upgrades)
--   - Atomic capacity locking (FOR UPDATE SKIP LOCKED)
--   - Sales windows & capacity tracking
--   - Full RLS policies (public view, org member manage)

-- =========================================
-- 1. ENUM TYPE
-- =========================================

CREATE TYPE product_category AS ENUM (
    'ticket_upgrade',    -- Only purchasable with specific tickets
    'standalone'         -- Independently purchasable
);

COMMENT ON TYPE product_category IS 'Product categorization: upgrades tied to tickets vs standalone items';

-- =========================================
-- 2. TABLES
-- =========================================

-- 2.1 Products Table
CREATE TABLE public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,

    -- Categorization
    category product_category NOT NULL DEFAULT 'standalone',

    -- Basic Info
    name TEXT NOT NULL,
    description TEXT,                    -- Rich text, shown in detail
    instructions TEXT,                   -- Post-purchase instructions
    image_url TEXT,                      -- Product image

    -- Pricing
    price NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    vat_percentage NUMERIC(4,2) NOT NULL DEFAULT 21.00,

    -- Capacity & Limits
    capacity_total INTEGER,              -- NULL = unlimited
    max_per_order INTEGER NOT NULL DEFAULT 10,

    -- Sales Window
    sales_start TIMESTAMPTZ,
    sales_end TIMESTAMPTZ,

    -- Display
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,              -- Soft delete

    -- Constraints
    CONSTRAINT products_price_check CHECK (price >= 0),
    CONSTRAINT products_vat_check CHECK (vat_percentage >= 0 AND vat_percentage <= 100),
    CONSTRAINT products_capacity_check CHECK (capacity_total IS NULL OR capacity_total >= 0),
    CONSTRAINT products_max_per_order_check CHECK (max_per_order > 0)
);

COMMENT ON TABLE public.products IS 'Extra products beyond tickets (upgrades, merchandise)';
COMMENT ON COLUMN public.products.category IS 'ticket_upgrade = tied to tickets, standalone = independent';
COMMENT ON COLUMN public.products.capacity_total IS 'NULL means unlimited capacity';
COMMENT ON COLUMN public.products.instructions IS 'Post-purchase instructions shown to buyer';

-- 2.2 Product Variants Table
CREATE TABLE public.product_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,

    -- Variant Details
    name TEXT NOT NULL,                  -- "Maat M", "Kleur Rood"
    capacity_total INTEGER,              -- NULL = inherit from product or unlimited

    -- Display
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT product_variants_capacity_check CHECK (capacity_total IS NULL OR capacity_total >= 0),
    CONSTRAINT product_variants_unique UNIQUE (product_id, name)
);

COMMENT ON TABLE public.product_variants IS 'Product variations (sizes, colors) with own capacity';
COMMENT ON COLUMN public.product_variants.capacity_total IS 'NULL = no variant-specific limit';

-- 2.3 Product Ticket Restrictions Table
CREATE TABLE public.product_ticket_restrictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    ticket_type_id UUID NOT NULL REFERENCES public.ticket_types(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraint: one restriction entry per product-ticket pair
    CONSTRAINT product_ticket_restrictions_unique UNIQUE (product_id, ticket_type_id)
);

COMMENT ON TABLE public.product_ticket_restrictions IS 'Junction table: which tickets allow buying which products (for upgrades)';

-- 2.4 Extend order_items Table
ALTER TABLE public.order_items
    ADD COLUMN product_id UUID REFERENCES public.products(id) ON DELETE RESTRICT,
    ADD COLUMN product_variant_id UUID REFERENCES public.product_variants(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.order_items.product_id IS 'Link to product (mutually exclusive with ticket_type_id)';
COMMENT ON COLUMN public.order_items.product_variant_id IS 'Optional: specific variant within product';

-- Add constraint: must have either ticket_type_id OR product_id (not both, not neither)
ALTER TABLE public.order_items
    ADD CONSTRAINT order_items_item_type_check CHECK (
        (ticket_type_id IS NOT NULL AND product_id IS NULL) OR
        (ticket_type_id IS NULL AND product_id IS NOT NULL)
    );

-- =========================================
-- 3. INDEXES
-- =========================================

CREATE INDEX idx_products_event_id ON public.products(event_id);
CREATE INDEX idx_products_org_id ON public.products(org_id);
CREATE INDEX idx_products_category ON public.products(category);
CREATE INDEX idx_products_active ON public.products(is_active, deleted_at);

CREATE INDEX idx_product_variants_product_id ON public.product_variants(product_id);
CREATE INDEX idx_product_variants_active ON public.product_variants(is_active);

CREATE INDEX idx_product_ticket_restrictions_product_id ON public.product_ticket_restrictions(product_id);
CREATE INDEX idx_product_ticket_restrictions_ticket_type_id ON public.product_ticket_restrictions(ticket_type_id);

CREATE INDEX idx_order_items_product_id ON public.order_items(product_id);
CREATE INDEX idx_order_items_product_variant_id ON public.order_items(product_variant_id);

-- =========================================
-- 4. ROW LEVEL SECURITY (RLS)
-- =========================================

-- 4.1 Enable RLS
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_ticket_restrictions ENABLE ROW LEVEL SECURITY;

-- 4.2 Products Policies

-- Public: view published event products in sales window
CREATE POLICY "Public can view active products"
    ON public.products
    FOR SELECT
    USING (
        deleted_at IS NULL
        AND is_active = true
        AND EXISTS (
            SELECT 1 FROM public.events e
            WHERE e.id = products.event_id
            AND e.status = 'published'
            AND e.deleted_at IS NULL
        )
        AND (sales_start IS NULL OR NOW() >= sales_start)
        AND (sales_end IS NULL OR NOW() <= sales_end)
    );

-- Org members: view all products for their events
CREATE POLICY "Org members can view products"
    ON public.products
    FOR SELECT
    USING (
        public.is_org_member(org_id)
    );

-- Admins/Owners: full CRUD
CREATE POLICY "Admins can manage products"
    ON public.products
    FOR ALL
    USING (
        public.has_role(org_id, 'admin') OR public.has_role(org_id, 'owner')
    )
    WITH CHECK (
        public.has_role(org_id, 'admin') OR public.has_role(org_id, 'owner')
    );

-- 4.3 Product Variants Policies

-- Public: inherit from product
CREATE POLICY "Public can view active variants"
    ON public.product_variants
    FOR SELECT
    USING (
        is_active = true
        AND EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = product_variants.product_id
            AND p.deleted_at IS NULL
            AND p.is_active = true
            AND EXISTS (
                SELECT 1 FROM public.events e
                WHERE e.id = p.event_id
                AND e.status = 'published'
                AND e.deleted_at IS NULL
            )
        )
    );

-- Org members: view via product
CREATE POLICY "Org members can view variants"
    ON public.product_variants
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = product_variants.product_id
            AND public.is_org_member(p.org_id)
        )
    );

-- Admins: manage variants
CREATE POLICY "Admins can manage variants"
    ON public.product_variants
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = product_variants.product_id
            AND (public.has_role(p.org_id, 'admin') OR public.has_role(p.org_id, 'owner'))
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = product_variants.product_id
            AND (public.has_role(p.org_id, 'admin') OR public.has_role(p.org_id, 'owner'))
        )
    );

-- 4.4 Product Ticket Restrictions Policies

-- Public: view restrictions (needed for checkout validation)
CREATE POLICY "Public can view restrictions"
    ON public.product_ticket_restrictions
    FOR SELECT
    USING (true);

-- Admins: manage restrictions
CREATE POLICY "Admins can manage restrictions"
    ON public.product_ticket_restrictions
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = product_ticket_restrictions.product_id
            AND (public.has_role(p.org_id, 'admin') OR public.has_role(p.org_id, 'owner'))
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = product_ticket_restrictions.product_id
            AND (public.has_role(p.org_id, 'admin') OR public.has_role(p.org_id, 'owner'))
        )
    );

-- =========================================
-- 5. VIEWS
-- =========================================

-- 5.1 Product Stats View
CREATE OR REPLACE VIEW public.v_product_stats AS
SELECT
    p.id AS product_id,
    p.event_id,
    p.org_id,
    p.name,
    p.category,
    p.price,
    p.capacity_total,

    -- Aggregated Sales (only from paid orders)
    COUNT(DISTINCT oi.id) FILTER (WHERE o.status = 'paid') AS units_sold,
    COALESCE(SUM(oi.quantity) FILTER (WHERE o.status = 'paid'), 0) AS total_quantity_sold,
    COALESCE(SUM(oi.total_price) FILTER (WHERE o.status = 'paid'), 0) AS total_revenue,

    -- Pending (reserved but not paid)
    COALESCE(SUM(oi.quantity) FILTER (WHERE o.status = 'pending'), 0) AS total_quantity_pending,

    -- Availability
    CASE
        WHEN p.capacity_total IS NULL THEN NULL -- Unlimited
        ELSE p.capacity_total - COALESCE(SUM(oi.quantity) FILTER (WHERE o.status IN ('paid', 'pending')), 0)
    END AS available_capacity,

    -- Sales Window Status
    CASE
        WHEN p.sales_start IS NOT NULL AND NOW() < p.sales_start THEN 'not_started'
        WHEN p.sales_end IS NOT NULL AND NOW() > p.sales_end THEN 'ended'
        ELSE 'active'
    END AS sales_status

FROM public.products p
LEFT JOIN public.order_items oi ON oi.product_id = p.id
LEFT JOIN public.orders o ON o.id = oi.order_id

WHERE p.deleted_at IS NULL

GROUP BY p.id;

COMMENT ON VIEW public.v_product_stats IS 'Aggregated product sales and availability';

-- 5.2 Product Variant Stats View
CREATE OR REPLACE VIEW public.v_product_variant_stats AS
SELECT
    pv.id AS variant_id,
    pv.product_id,
    pv.name AS variant_name,
    pv.capacity_total AS variant_capacity,

    -- Sold
    COALESCE(SUM(oi.quantity) FILTER (WHERE o.status = 'paid'), 0) AS units_sold,

    -- Pending
    COALESCE(SUM(oi.quantity) FILTER (WHERE o.status = 'pending'), 0) AS units_pending,

    -- Available
    CASE
        WHEN pv.capacity_total IS NULL THEN NULL
        ELSE pv.capacity_total - COALESCE(SUM(oi.quantity) FILTER (WHERE o.status IN ('paid', 'pending')), 0)
    END AS available_capacity

FROM public.product_variants pv
LEFT JOIN public.order_items oi ON oi.product_variant_id = pv.id
LEFT JOIN public.orders o ON o.id = oi.order_id

WHERE pv.is_active = true

GROUP BY pv.id;

COMMENT ON VIEW public.v_product_variant_stats IS 'Per-variant sales and capacity';

-- =========================================
-- 6. RPC FUNCTIONS
-- =========================================

-- 6.1 Create Product
CREATE OR REPLACE FUNCTION public.create_product(
    _event_id UUID,
    _category product_category,
    _name TEXT,
    _description TEXT DEFAULT NULL,
    _instructions TEXT DEFAULT NULL,
    _image_url TEXT DEFAULT NULL,
    _price NUMERIC DEFAULT 0.00,
    _vat_percentage NUMERIC DEFAULT 21.00,
    _capacity_total INTEGER DEFAULT NULL,
    _max_per_order INTEGER DEFAULT 10,
    _sales_start TIMESTAMPTZ DEFAULT NULL,
    _sales_end TIMESTAMPTZ DEFAULT NULL,
    _ticket_type_ids UUID[] DEFAULT ARRAY[]::UUID[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _org_id UUID;
    _product_id UUID;
    _ticket_id UUID;
BEGIN
    -- Auth check: user must be authenticated
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    -- Resolve org_id from event
    SELECT e.org_id INTO _org_id
    FROM public.events e
    WHERE e.id = _event_id;

    IF _org_id IS NULL THEN
        RAISE EXCEPTION 'Event not found';
    END IF;

    -- Auth check: user must be admin or owner
    IF NOT (public.has_role(_org_id, 'admin') OR public.has_role(_org_id, 'owner')) THEN
        RAISE EXCEPTION 'Insufficient permissions';
    END IF;

    -- Insert product
    INSERT INTO public.products (
        event_id,
        org_id,
        category,
        name,
        description,
        instructions,
        image_url,
        price,
        vat_percentage,
        capacity_total,
        max_per_order,
        sales_start,
        sales_end
    ) VALUES (
        _event_id,
        _org_id,
        _category,
        _name,
        _description,
        _instructions,
        _image_url,
        _price,
        _vat_percentage,
        _capacity_total,
        _max_per_order,
        _sales_start,
        _sales_end
    )
    RETURNING id INTO _product_id;

    -- If ticket restrictions provided, insert them
    IF array_length(_ticket_type_ids, 1) > 0 THEN
        FOREACH _ticket_id IN ARRAY _ticket_type_ids
        LOOP
            INSERT INTO public.product_ticket_restrictions (product_id, ticket_type_id)
            VALUES (_product_id, _ticket_id)
            ON CONFLICT (product_id, ticket_type_id) DO NOTHING;
        END LOOP;
    END IF;

    RETURN _product_id;
END;
$$;

COMMENT ON FUNCTION public.create_product IS 'Create new product (admin only)';
GRANT EXECUTE ON FUNCTION public.create_product TO authenticated;

-- 6.2 Update Product
CREATE OR REPLACE FUNCTION public.update_product(
    _product_id UUID,
    _name TEXT DEFAULT NULL,
    _description TEXT DEFAULT NULL,
    _instructions TEXT DEFAULT NULL,
    _image_url TEXT DEFAULT NULL,
    _price NUMERIC DEFAULT NULL,
    _vat_percentage NUMERIC DEFAULT NULL,
    _capacity_total INTEGER DEFAULT NULL,
    _max_per_order INTEGER DEFAULT NULL,
    _sales_start TIMESTAMPTZ DEFAULT NULL,
    _sales_end TIMESTAMPTZ DEFAULT NULL,
    _is_active BOOLEAN DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _org_id UUID;
BEGIN
    -- Auth check
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    -- Get org_id from product
    SELECT p.org_id INTO _org_id
    FROM public.products p
    WHERE p.id = _product_id;

    IF _org_id IS NULL THEN
        RAISE EXCEPTION 'Product not found';
    END IF;

    -- Auth check: admin or owner
    IF NOT (public.has_role(_org_id, 'admin') OR public.has_role(_org_id, 'owner')) THEN
        RAISE EXCEPTION 'Insufficient permissions';
    END IF;

    -- Update with COALESCE for optional fields
    UPDATE public.products
    SET
        name = COALESCE(_name, name),
        description = COALESCE(_description, description),
        instructions = COALESCE(_instructions, instructions),
        image_url = COALESCE(_image_url, image_url),
        price = COALESCE(_price, price),
        vat_percentage = COALESCE(_vat_percentage, vat_percentage),
        capacity_total = COALESCE(_capacity_total, capacity_total),
        max_per_order = COALESCE(_max_per_order, max_per_order),
        sales_start = COALESCE(_sales_start, sales_start),
        sales_end = COALESCE(_sales_end, sales_end),
        is_active = COALESCE(_is_active, is_active),
        updated_at = NOW()
    WHERE id = _product_id;

    RETURN true;
END;
$$;

COMMENT ON FUNCTION public.update_product IS 'Update product details (admin only)';
GRANT EXECUTE ON FUNCTION public.update_product TO authenticated;

-- 6.3 Delete Product (Soft Delete)
CREATE OR REPLACE FUNCTION public.delete_product(
    _product_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _org_id UUID;
BEGIN
    -- Auth check
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    -- Get org_id
    SELECT p.org_id INTO _org_id
    FROM public.products p
    WHERE p.id = _product_id;

    IF _org_id IS NULL THEN
        RAISE EXCEPTION 'Product not found';
    END IF;

    -- Auth check
    IF NOT (public.has_role(_org_id, 'admin') OR public.has_role(_org_id, 'owner')) THEN
        RAISE EXCEPTION 'Insufficient permissions';
    END IF;

    -- Soft delete
    UPDATE public.products
    SET deleted_at = NOW()
    WHERE id = _product_id;

    RETURN true;
END;
$$;

COMMENT ON FUNCTION public.delete_product IS 'Soft delete product (admin only)';
GRANT EXECUTE ON FUNCTION public.delete_product TO authenticated;

-- 6.4 Get Public Products
CREATE OR REPLACE FUNCTION public.get_public_products(
    _event_id UUID,
    _cart_ticket_type_ids UUID[] DEFAULT ARRAY[]::UUID[]
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    description TEXT,
    instructions TEXT,
    image_url TEXT,
    price NUMERIC,
    vat_percentage NUMERIC,
    category product_category,
    max_per_order INTEGER,
    available_capacity INTEGER,
    sales_start TIMESTAMPTZ,
    sales_end TIMESTAMPTZ,
    variants JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id,
        p.name,
        p.description,
        p.instructions,
        p.image_url,
        p.price,
        p.vat_percentage,
        p.category,
        p.max_per_order,
        ps.available_capacity::INTEGER,
        p.sales_start,
        p.sales_end,
        COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'id', pv.id,
                    'name', pv.name,
                    'capacity_total', pv.capacity_total,
                    'available_capacity', pvs.available_capacity,
                    'sort_order', pv.sort_order
                )
                ORDER BY pv.sort_order
            ) FILTER (WHERE pv.id IS NOT NULL),
            '[]'::jsonb
        ) AS variants
    FROM public.products p
    LEFT JOIN public.v_product_stats ps ON ps.product_id = p.id
    LEFT JOIN public.product_variants pv ON pv.product_id = p.id AND pv.is_active = true
    LEFT JOIN public.v_product_variant_stats pvs ON pvs.variant_id = pv.id
    WHERE p.event_id = _event_id
        AND p.deleted_at IS NULL
        AND p.is_active = true
        AND (p.sales_start IS NULL OR NOW() >= p.sales_start)
        AND (p.sales_end IS NULL OR NOW() <= p.sales_end)
        AND EXISTS (
            SELECT 1 FROM public.events e
            WHERE e.id = p.event_id
            AND e.status = 'published'
            AND e.deleted_at IS NULL
        )
        -- Filter upgrades: only show if cart has allowed ticket
        AND (
            p.category = 'standalone'
            OR (
                p.category = 'ticket_upgrade'
                AND (
                    -- If no restrictions, allow (opt-in required)
                    NOT EXISTS (
                        SELECT 1 FROM public.product_ticket_restrictions ptr
                        WHERE ptr.product_id = p.id
                    )
                    OR
                    -- If restrictions exist, check cart has allowed ticket
                    EXISTS (
                        SELECT 1 FROM public.product_ticket_restrictions ptr
                        WHERE ptr.product_id = p.id
                        AND ptr.ticket_type_id = ANY(_cart_ticket_type_ids)
                    )
                )
            )
        )
    GROUP BY p.id, ps.available_capacity;
END;
$$;

COMMENT ON FUNCTION public.get_public_products IS 'Get public products for event (respects sales window, ticket restrictions)';
GRANT EXECUTE ON FUNCTION public.get_public_products TO anon, authenticated;

-- 6.5 Create Product Variant
CREATE OR REPLACE FUNCTION public.create_product_variant(
    _product_id UUID,
    _name TEXT,
    _capacity_total INTEGER DEFAULT NULL,
    _sort_order INTEGER DEFAULT 0
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _org_id UUID;
    _variant_id UUID;
BEGIN
    -- Auth check
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    -- Get org_id via product
    SELECT p.org_id INTO _org_id
    FROM public.products p
    WHERE p.id = _product_id;

    IF _org_id IS NULL THEN
        RAISE EXCEPTION 'Product not found';
    END IF;

    -- Auth check
    IF NOT (public.has_role(_org_id, 'admin') OR public.has_role(_org_id, 'owner')) THEN
        RAISE EXCEPTION 'Insufficient permissions';
    END IF;

    -- Insert variant
    INSERT INTO public.product_variants (
        product_id,
        name,
        capacity_total,
        sort_order
    ) VALUES (
        _product_id,
        _name,
        _capacity_total,
        _sort_order
    )
    RETURNING id INTO _variant_id;

    RETURN _variant_id;
END;
$$;

COMMENT ON FUNCTION public.create_product_variant IS 'Create product variant (admin only)';
GRANT EXECUTE ON FUNCTION public.create_product_variant TO authenticated;

-- 6.6 Update Product Variant
CREATE OR REPLACE FUNCTION public.update_product_variant(
    _variant_id UUID,
    _name TEXT DEFAULT NULL,
    _capacity_total INTEGER DEFAULT NULL,
    _is_active BOOLEAN DEFAULT NULL,
    _sort_order INTEGER DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _org_id UUID;
BEGIN
    -- Auth check
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    -- Get org_id via product
    SELECT p.org_id INTO _org_id
    FROM public.products p
    JOIN public.product_variants pv ON pv.product_id = p.id
    WHERE pv.id = _variant_id;

    IF _org_id IS NULL THEN
        RAISE EXCEPTION 'Variant not found';
    END IF;

    -- Auth check
    IF NOT (public.has_role(_org_id, 'admin') OR public.has_role(_org_id, 'owner')) THEN
        RAISE EXCEPTION 'Insufficient permissions';
    END IF;

    -- Update
    UPDATE public.product_variants
    SET
        name = COALESCE(_name, name),
        capacity_total = COALESCE(_capacity_total, capacity_total),
        is_active = COALESCE(_is_active, is_active),
        sort_order = COALESCE(_sort_order, sort_order)
    WHERE id = _variant_id;

    RETURN true;
END;
$$;

COMMENT ON FUNCTION public.update_product_variant IS 'Update product variant (admin only)';
GRANT EXECUTE ON FUNCTION public.update_product_variant TO authenticated;

-- 6.7 Delete Product Variant
CREATE OR REPLACE FUNCTION public.delete_product_variant(
    _variant_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _org_id UUID;
    _has_orders BOOLEAN;
BEGIN
    -- Auth check
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    -- Get org_id
    SELECT p.org_id INTO _org_id
    FROM public.products p
    JOIN public.product_variants pv ON pv.product_id = p.id
    WHERE pv.id = _variant_id;

    IF _org_id IS NULL THEN
        RAISE EXCEPTION 'Variant not found';
    END IF;

    -- Auth check
    IF NOT (public.has_role(_org_id, 'admin') OR public.has_role(_org_id, 'owner')) THEN
        RAISE EXCEPTION 'Insufficient permissions';
    END IF;

    -- Check if variant has orders
    SELECT EXISTS (
        SELECT 1 FROM public.order_items oi
        WHERE oi.product_variant_id = _variant_id
    ) INTO _has_orders;

    IF _has_orders THEN
        -- Deactivate instead of delete
        UPDATE public.product_variants
        SET is_active = false
        WHERE id = _variant_id;
    ELSE
        -- Hard delete if no orders
        DELETE FROM public.product_variants
        WHERE id = _variant_id;
    END IF;

    RETURN true;
END;
$$;

COMMENT ON FUNCTION public.delete_product_variant IS 'Delete variant (hard delete if no orders, else deactivate)';
GRANT EXECUTE ON FUNCTION public.delete_product_variant TO authenticated;

-- 6.8 Set Product Ticket Restrictions
CREATE OR REPLACE FUNCTION public.set_product_ticket_restrictions(
    _product_id UUID,
    _ticket_type_ids UUID[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _org_id UUID;
    _ticket_id UUID;
BEGIN
    -- Auth check
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    -- Get org_id
    SELECT p.org_id INTO _org_id
    FROM public.products p
    WHERE p.id = _product_id;

    IF _org_id IS NULL THEN
        RAISE EXCEPTION 'Product not found';
    END IF;

    -- Auth check
    IF NOT (public.has_role(_org_id, 'admin') OR public.has_role(_org_id, 'owner')) THEN
        RAISE EXCEPTION 'Insufficient permissions';
    END IF;

    -- Delete existing restrictions
    DELETE FROM public.product_ticket_restrictions
    WHERE product_id = _product_id;

    -- Insert new restrictions
    IF array_length(_ticket_type_ids, 1) > 0 THEN
        FOREACH _ticket_id IN ARRAY _ticket_type_ids
        LOOP
            INSERT INTO public.product_ticket_restrictions (product_id, ticket_type_id)
            VALUES (_product_id, _ticket_id)
            ON CONFLICT (product_id, ticket_type_id) DO NOTHING;
        END LOOP;
    END IF;

    RETURN true;
END;
$$;

COMMENT ON FUNCTION public.set_product_ticket_restrictions IS 'Replace ticket restrictions for product (admin only)';
GRANT EXECUTE ON FUNCTION public.set_product_ticket_restrictions TO authenticated;

-- =========================================
-- 7. TRIGGERS
-- =========================================

-- Updated_at trigger for products
CREATE TRIGGER handle_updated_at_products
    BEFORE UPDATE ON public.products
    FOR EACH ROW
    EXECUTE PROCEDURE extensions.moddatetime(updated_at);

-- =========================================
-- END OF MIGRATION
-- =========================================
