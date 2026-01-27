/**
 * ORDER PRICING WITH DISCOUNTS
 *
 * Extends orders table to support:
 * - Invitation code tracking
 * - Discount amount
 * - Subtotal (before discount)
 *
 * Adds comprehensive pricing calculation RPC that:
 * - Calculates order subtotal from items
 * - Applies best available discount (considering volume tiers)
 * - Records discount application
 * - Returns final pricing breakdown
 */

-- ============================================================================
-- EXTEND ORDERS TABLE
-- ============================================================================

-- Add columns for discount tracking
ALTER TABLE orders ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS invitation_code_id UUID REFERENCES invitation_codes(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_id UUID REFERENCES discounts(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00;

COMMENT ON COLUMN orders.org_id IS 'Denormalized from event for easier querying';
COMMENT ON COLUMN orders.invitation_code_id IS 'Invitation code used at checkout (if any)';
COMMENT ON COLUMN orders.discount_id IS 'Discount applied to order (if any)';
COMMENT ON COLUMN orders.subtotal_amount IS 'Sum of order items before discount';
COMMENT ON COLUMN orders.discount_amount IS 'Total discount applied';

-- Update existing orders to set org_id
UPDATE orders o
SET org_id = e.org_id
FROM events e
WHERE o.event_id = e.id
  AND o.org_id IS NULL;

-- Make org_id NOT NULL after backfill
ALTER TABLE orders ALTER COLUMN org_id SET NOT NULL;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_orders_org_id ON orders(org_id);
CREATE INDEX IF NOT EXISTS idx_orders_invitation_code_id ON orders(invitation_code_id) WHERE invitation_code_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_discount_id ON orders(discount_id) WHERE discount_id IS NOT NULL;

-- Add constraint: total_amount = subtotal_amount - discount_amount
ALTER TABLE orders ADD CONSTRAINT orders_total_calculation_check
    CHECK (total_amount = subtotal_amount - discount_amount);

-- ============================================================================
-- FUNCTION: calculate_order_pricing
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_order_pricing(
    _order_id UUID,
    _invitation_code TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_order RECORD;
    v_subtotal NUMERIC := 0;
    v_discount_id UUID;
    v_discount_amount NUMERIC := 0;
    v_discount_type discount_type_enum;
    v_discount_value NUMERIC;
    v_invitation_code_id UUID;
    v_total_quantity INTEGER := 0;
    v_validation_result JSONB;
BEGIN
    -- 1. FETCH ORDER
    SELECT o.*, e.org_id INTO v_order
    FROM orders o
    JOIN events e ON e.id = o.event_id
    WHERE o.id = _order_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'ORDER_NOT_FOUND'
        );
    END IF;

    -- 2. CALCULATE SUBTOTAL
    SELECT
        COALESCE(SUM(total_price), 0),
        COALESCE(SUM(quantity), 0)
    INTO v_subtotal, v_total_quantity
    FROM order_items
    WHERE order_id = _order_id;

    -- 3. VALIDATE INVITATION CODE (if provided)
    IF _invitation_code IS NOT NULL THEN
        SELECT validate_invitation_code_usage(
            _invitation_code,
            v_order.event_id,
            v_order.email
        ) INTO v_validation_result;

        IF NOT (v_validation_result->>'valid')::boolean THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'INVALID_INVITATION_CODE',
                'details', v_validation_result
            );
        END IF;

        v_invitation_code_id := (v_validation_result->>'code_id')::uuid;

        -- Record invitation code use (idempotent)
        PERFORM record_invitation_code_use(
            v_invitation_code_id,
            _order_id,
            v_order.user_id,
            v_order.email
        );
    END IF;

    -- 4. FIND BEST APPLICABLE DISCOUNT
    -- For simplicity, we assume single ticket type per order
    -- In real implementation, iterate over order_items for multi-ticket orders
    SELECT
        discount_id,
        discount_type,
        discount_value
    INTO v_discount_id, v_discount_type, v_discount_value
    FROM get_applicable_discounts(
        v_order.event_id,
        (SELECT ticket_type_id FROM order_items WHERE order_id = _order_id LIMIT 1),
        v_total_quantity,
        v_subtotal,
        v_invitation_code_id
    )
    LIMIT 1; -- Best discount (highest tier, highest value)

    -- 5. CALCULATE DISCOUNT AMOUNT
    IF v_discount_id IS NOT NULL THEN
        v_discount_amount := calculate_discount_amount(
            v_discount_type,
            v_discount_value,
            v_subtotal
        );

        -- Record discount application (idempotent)
        PERFORM record_discount_application(
            v_discount_id,
            _order_id,
            NULL, -- order-level discount
            v_order.user_id,
            v_discount_type,
            v_discount_value,
            v_discount_amount
        );
    END IF;

    -- 6. UPDATE ORDER
    UPDATE orders SET
        org_id = v_order.org_id,
        invitation_code_id = v_invitation_code_id,
        discount_id = v_discount_id,
        subtotal_amount = v_subtotal,
        discount_amount = v_discount_amount,
        total_amount = v_subtotal - v_discount_amount,
        updated_at = NOW()
    WHERE id = _order_id;

    -- 7. RETURN PRICING BREAKDOWN
    RETURN jsonb_build_object(
        'success', true,
        'order_id', _order_id,
        'subtotal', v_subtotal,
        'discount_amount', v_discount_amount,
        'total_amount', v_subtotal - v_discount_amount,
        'currency', v_order.currency,
        'discount_id', v_discount_id,
        'invitation_code_id', v_invitation_code_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION calculate_order_pricing IS 'Calculates order pricing with discounts and invitation codes. Updates order record.';

-- ============================================================================
-- FUNCTION: apply_discount_to_order (convenience wrapper)
-- ============================================================================
CREATE OR REPLACE FUNCTION apply_discount_to_order(
    _order_id UUID,
    _discount_code TEXT
) RETURNS JSONB AS $$
DECLARE
    v_result JSONB;
BEGIN
    -- For now, discount_code is treated as invitation_code
    -- In future, could support explicit discount codes separate from invitation codes
    SELECT calculate_order_pricing(_order_id, _discount_code) INTO v_result;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION apply_discount_to_order IS 'Convenience function to apply a discount code to an order.';

-- ============================================================================
-- UPDATE RLS POLICIES FOR ORG_ID
-- ============================================================================

-- Update orders RLS to use org_id
DROP POLICY IF EXISTS "Org members can view orders" ON orders;
CREATE POLICY "Org members can view orders"
    ON orders
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM org_members om
            WHERE om.org_id = orders.org_id
              AND om.user_id = auth.uid()
        )
    );

-- Users can update their own pending orders (for recalculation)
CREATE POLICY "Users can update own pending orders"
    ON orders
    FOR UPDATE
    USING (
        status = 'pending'
        AND (
            user_id = auth.uid()
            OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
        )
    );
