/**
 * DISCOUNTS SYSTEM
 *
 * Enables flexible discount strategies:
 * - Percentage or fixed amount discounts
 * - Volume-based pricing tiers (buy X, get Y% off)
 * - Scheduled discounts (early bird, last minute)
 * - Invitation-gated discounts (requires code)
 * - Scoped to specific ticket types or all tickets
 *
 * Architecture:
 * - discounts: Master discount record
 * - discount_levels: Volume tiers (optional, for quantity-based discounts)
 * - discount_scopes: Which ticket types the discount applies to
 * - discount_applications: Append-only ledger of discount usage
 *
 * Atleta Compliance:
 * - Scheduled discounts MUST have ends_at (no indefinite early bird)
 *
 * RLS:
 * - Org members (owner/admin/finance) can manage discounts
 * - Public can query active discounts for checkout
 * - Application ledger is org-readable only
 */

-- ============================================================================
-- TYPE: discount_type_enum
-- ============================================================================
CREATE TYPE discount_type_enum AS ENUM ('percentage', 'fixed_amount');
COMMENT ON TYPE discount_type_enum IS 'Type of discount calculation';

-- ============================================================================
-- TABLE: discounts
-- ============================================================================
CREATE TABLE IF NOT EXISTS discounts (
    -- Identity
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,

    -- Metadata
    name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,

    -- Discount Type
    discount_type discount_type_enum NOT NULL,
    discount_value NUMERIC(10, 2) NOT NULL CHECK (discount_value > 0),

    -- Constraints for percentage discounts
    CONSTRAINT discounts_percentage_max_100
        CHECK (discount_type != 'percentage' OR discount_value <= 100),

    -- Time Window (scheduled discounts)
    valid_from TIMESTAMPTZ,
    valid_until TIMESTAMPTZ,

    -- Atleta Compliance: Scheduled discounts must have end date
    CONSTRAINT discounts_scheduled_must_have_end
        CHECK (valid_from IS NULL OR valid_until IS NOT NULL),

    CONSTRAINT discounts_time_window_check
        CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until),

    -- Usage Limits
    max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
    max_uses_per_user INTEGER CHECK (max_uses_per_user IS NULL OR max_uses_per_user > 0),

    -- Invitation Code Requirement
    requires_invitation_code BOOLEAN NOT NULL DEFAULT false,
    invitation_code_id UUID REFERENCES invitation_codes(id) ON DELETE SET NULL,

    -- Minimum Order Amount (fixed discounts only)
    min_order_amount NUMERIC(10, 2) CHECK (min_order_amount IS NULL OR min_order_amount >= 0),

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_at TIMESTAMPTZ,

    -- Business Rule: If requires_invitation_code, must have invitation_code_id
    CONSTRAINT discounts_invitation_code_required
        CHECK (NOT requires_invitation_code OR invitation_code_id IS NOT NULL)
);

COMMENT ON TABLE discounts IS 'Flexible discount system with time windows, volume tiers, and invitation gating';
COMMENT ON COLUMN discounts.discount_type IS 'percentage = X% off, fixed_amount = $X off';
COMMENT ON COLUMN discounts.discount_value IS 'Percentage (0-100) or fixed amount in event currency';
COMMENT ON COLUMN discounts.valid_from IS 'NULL = no start date, set = scheduled discount starts';
COMMENT ON COLUMN discounts.valid_until IS 'Required if valid_from is set (Atleta compliance)';
COMMENT ON COLUMN discounts.requires_invitation_code IS 'If true, discount only applies when invitation code is used';
COMMENT ON COLUMN discounts.min_order_amount IS 'Minimum order subtotal required to apply discount';

-- Indexes
CREATE INDEX idx_discounts_org_id ON discounts(org_id);
CREATE INDEX idx_discounts_event_id ON discounts(event_id);
CREATE INDEX idx_discounts_active_lookup ON discounts(event_id, is_active) WHERE is_active = true;
CREATE INDEX idx_discounts_invitation_code_id ON discounts(invitation_code_id) WHERE invitation_code_id IS NOT NULL;

-- ============================================================================
-- TABLE: discount_levels
-- ============================================================================
CREATE TABLE IF NOT EXISTS discount_levels (
    -- Identity
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discount_id UUID NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,

    -- Volume Tier
    min_quantity INTEGER NOT NULL CHECK (min_quantity > 0),

    -- Override discount value for this tier
    discount_type discount_type_enum NOT NULL,
    discount_value NUMERIC(10, 2) NOT NULL CHECK (discount_value > 0),

    -- Constraints
    CONSTRAINT discount_levels_percentage_max_100
        CHECK (discount_type != 'percentage' OR discount_value <= 100),

    -- Unique tier per discount
    CONSTRAINT discount_levels_discount_min_qty_unique
        UNIQUE (discount_id, min_quantity)
);

COMMENT ON TABLE discount_levels IS 'Volume-based pricing tiers (e.g., buy 10+ get 20% off)';
COMMENT ON COLUMN discount_levels.min_quantity IS 'Minimum ticket quantity to unlock this tier';
COMMENT ON COLUMN discount_levels.discount_value IS 'Overrides parent discount value for this tier';

-- Indexes
CREATE INDEX idx_discount_levels_discount_id ON discount_levels(discount_id);

-- ============================================================================
-- TABLE: discount_scopes
-- ============================================================================
CREATE TABLE IF NOT EXISTS discount_scopes (
    -- Identity
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discount_id UUID NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,

    -- Scope: Which ticket types?
    ticket_type_id UUID NOT NULL REFERENCES ticket_types(id) ON DELETE CASCADE,

    -- Unique: One scope record per discount-ticket_type pair
    CONSTRAINT discount_scopes_discount_ticket_type_unique
        UNIQUE (discount_id, ticket_type_id)
);

COMMENT ON TABLE discount_scopes IS 'Defines which ticket types a discount applies to. Empty = applies to all ticket types.';

-- Indexes
CREATE INDEX idx_discount_scopes_discount_id ON discount_scopes(discount_id);
CREATE INDEX idx_discount_scopes_ticket_type_id ON discount_scopes(ticket_type_id);

-- ============================================================================
-- TABLE: discount_applications
-- ============================================================================
CREATE TABLE IF NOT EXISTS discount_applications (
    -- Identity
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discount_id UUID NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,

    -- Context
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    order_item_id UUID REFERENCES order_items(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    -- Discount Applied
    discount_type discount_type_enum NOT NULL,
    discount_value NUMERIC(10, 2) NOT NULL,
    discount_amount NUMERIC(10, 2) NOT NULL CHECK (discount_amount >= 0),

    -- Audit
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Idempotency: One discount per order
    -- (order_item_id allows line-item discounts in future)
    CONSTRAINT discount_applications_discount_order_unique
        UNIQUE (discount_id, order_id)
);

COMMENT ON TABLE discount_applications IS 'Append-only ledger of discount applications';
COMMENT ON COLUMN discount_applications.order_item_id IS 'NULL = order-level discount, set = line-item discount';
COMMENT ON COLUMN discount_applications.discount_amount IS 'Calculated discount amount in order currency';

-- Indexes
CREATE INDEX idx_discount_applications_discount_id ON discount_applications(discount_id);
CREATE INDEX idx_discount_applications_order_id ON discount_applications(order_id);
CREATE INDEX idx_discount_applications_user_id ON discount_applications(user_id) WHERE user_id IS NOT NULL;

-- ============================================================================
-- FUNCTION: get_applicable_discounts
-- ============================================================================
CREATE OR REPLACE FUNCTION get_applicable_discounts(
    _event_id UUID,
    _ticket_type_id UUID,
    _quantity INTEGER,
    _subtotal NUMERIC,
    _invitation_code_id UUID DEFAULT NULL
) RETURNS TABLE(
    discount_id UUID,
    name TEXT,
    description TEXT,
    discount_type discount_type_enum,
    discount_value NUMERIC,
    tier_min_quantity INTEGER,
    requires_invitation_code BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.id AS discount_id,
        d.name,
        d.description,
        COALESCE(dl.discount_type, d.discount_type) AS discount_type,
        COALESCE(dl.discount_value, d.discount_value) AS discount_value,
        dl.min_quantity AS tier_min_quantity,
        d.requires_invitation_code
    FROM discounts d
    LEFT JOIN discount_levels dl ON dl.discount_id = d.id
        AND _quantity >= dl.min_quantity
    WHERE d.event_id = _event_id
      AND d.is_active = true
      -- Time window check
      AND (d.valid_from IS NULL OR NOW() >= d.valid_from)
      AND (d.valid_until IS NULL OR NOW() <= d.valid_until)
      -- Usage limit check (global)
      AND (d.max_uses IS NULL OR (
          SELECT COUNT(*) FROM discount_applications da
          WHERE da.discount_id = d.id
      ) < d.max_uses)
      -- Minimum order amount check
      AND (d.min_order_amount IS NULL OR _subtotal >= d.min_order_amount)
      -- Invitation code requirement
      AND (NOT d.requires_invitation_code OR d.invitation_code_id = _invitation_code_id)
      -- Scope check: applies to this ticket type (or no scope = all types)
      AND (
          NOT EXISTS (SELECT 1 FROM discount_scopes WHERE discount_id = d.id)
          OR EXISTS (
              SELECT 1 FROM discount_scopes ds
              WHERE ds.discount_id = d.id
                AND ds.ticket_type_id = _ticket_type_id
          )
      )
    ORDER BY
        -- Best tier first (highest min_quantity)
        dl.min_quantity DESC NULLS LAST,
        -- Then by discount value (highest first)
        COALESCE(dl.discount_value, d.discount_value) DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_applicable_discounts IS 'Returns all applicable discounts for a given ticket type and quantity, including volume tiers.';

-- ============================================================================
-- FUNCTION: calculate_discount_amount
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_discount_amount(
    _discount_type discount_type_enum,
    _discount_value NUMERIC,
    _subtotal NUMERIC
) RETURNS NUMERIC AS $$
BEGIN
    IF _discount_type = 'percentage' THEN
        RETURN ROUND(_subtotal * (_discount_value / 100.0), 2);
    ELSIF _discount_type = 'fixed_amount' THEN
        -- Fixed amount, but never more than subtotal
        RETURN LEAST(_discount_value, _subtotal);
    ELSE
        RETURN 0;
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION calculate_discount_amount IS 'Calculates discount amount given type, value, and subtotal.';

-- ============================================================================
-- FUNCTION: record_discount_application
-- ============================================================================
CREATE OR REPLACE FUNCTION record_discount_application(
    _discount_id UUID,
    _order_id UUID,
    _order_item_id UUID,
    _user_id UUID,
    _discount_type discount_type_enum,
    _discount_value NUMERIC,
    _discount_amount NUMERIC
) RETURNS VOID AS $$
BEGIN
    -- Insert application record (idempotent due to unique constraint)
    INSERT INTO discount_applications (
        discount_id,
        order_id,
        order_item_id,
        user_id,
        discount_type,
        discount_value,
        discount_amount
    ) VALUES (
        _discount_id,
        _order_id,
        _order_item_id,
        _user_id,
        _discount_type,
        _discount_value,
        _discount_amount
    )
    ON CONFLICT (discount_id, order_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION record_discount_application IS 'Records discount application in append-only ledger. Idempotent.';

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS
ALTER TABLE discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE discount_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE discount_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE discount_applications ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS: discounts
-- ============================================================================

-- Policy: Org members can manage discounts
CREATE POLICY discounts_org_members_manage
    ON discounts
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM org_members om
            WHERE om.org_id = discounts.org_id
              AND om.user_id = auth.uid()
              AND om.role IN ('owner', 'admin', 'finance')
        )
    );

-- Policy: Public can view active discounts for event (read-only)
CREATE POLICY discounts_public_view_active
    ON discounts
    FOR SELECT
    USING (
        is_active = true
        AND (valid_from IS NULL OR NOW() >= valid_from)
        AND (valid_until IS NULL OR NOW() <= valid_until)
    );

-- ============================================================================
-- RLS: discount_levels
-- ============================================================================

-- Policy: Org members can manage levels
CREATE POLICY discount_levels_org_members_manage
    ON discount_levels
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM discounts d
            INNER JOIN org_members om ON om.org_id = d.org_id
            WHERE d.id = discount_levels.discount_id
              AND om.user_id = auth.uid()
              AND om.role IN ('owner', 'admin', 'finance')
        )
    );

-- Policy: Public can view levels for active discounts
CREATE POLICY discount_levels_public_view
    ON discount_levels
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM discounts d
            WHERE d.id = discount_levels.discount_id
              AND d.is_active = true
        )
    );

-- ============================================================================
-- RLS: discount_scopes
-- ============================================================================

-- Policy: Org members can manage scopes
CREATE POLICY discount_scopes_org_members_manage
    ON discount_scopes
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM discounts d
            INNER JOIN org_members om ON om.org_id = d.org_id
            WHERE d.id = discount_scopes.discount_id
              AND om.user_id = auth.uid()
              AND om.role IN ('owner', 'admin', 'finance')
        )
    );

-- Policy: Public can view scopes for active discounts
CREATE POLICY discount_scopes_public_view
    ON discount_scopes
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM discounts d
            WHERE d.id = discount_scopes.discount_id
              AND d.is_active = true
        )
    );

-- ============================================================================
-- RLS: discount_applications
-- ============================================================================

-- Policy: Org members can view applications
CREATE POLICY discount_applications_org_members_view
    ON discount_applications
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM discounts d
            INNER JOIN org_members om ON om.org_id = d.org_id
            WHERE d.id = discount_applications.discount_id
              AND om.user_id = auth.uid()
              AND om.role IN ('owner', 'admin', 'finance')
        )
    );

-- Policy: Users can view their own applications
CREATE POLICY discount_applications_user_view_own
    ON discount_applications
    FOR SELECT
    USING (user_id = auth.uid());

-- Policy: System can insert applications (via SECURITY DEFINER RPC)
-- No INSERT policy needed since insertion is done via SECURITY DEFINER function
