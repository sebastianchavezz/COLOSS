-- ===========================================================================
-- F006 S5a: BTW-berekening (VAT Calculation)
-- ===========================================================================
-- Doel: Add VAT tracking to order_items and orders.
-- Update validate_checkout_with_products RPC to return VAT info.
-- Backfill existing orders with calculated VAT amounts.
--
-- Key design: Prices are VAT-inclusive. VAT is back-calculated:
--   vat_amount = total_price - (total_price / (1 + vat_percentage / 100))
--   = total_price * vat_percentage / (100 + vat_percentage)
--
-- Backwards compatible: new columns have defaults, existing checkout works.
-- ===========================================================================

-- =====================================================
-- 1. SCHEMA WIJZIGINGEN
-- =====================================================

-- order_items: add VAT columns
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS vat_percentage NUMERIC(4,2) NOT NULL DEFAULT 21.00,
  ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00;

-- Constraint: vat_percentage must be 0-100
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_items_vat_percentage_check'
  ) THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_vat_percentage_check
      CHECK (vat_percentage >= 0 AND vat_percentage <= 100);
  END IF;
END $$;

-- orders: add VAT total
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00;

-- =====================================================
-- 2. UPDATE validate_checkout_with_products RPC
-- =====================================================
-- Now returns vat_percentage + vat_amount per item and total_vat

CREATE OR REPLACE FUNCTION public.validate_checkout_with_products(
  _event_id UUID,
  _ticket_items JSONB,
  _product_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_ticket_type_id UUID;
  v_product_id UUID;
  v_variant_id UUID;
  v_quantity INT;
  v_ticket_type RECORD;
  v_product RECORD;
  v_variant RECORD;
  v_sold_count INT;
  v_available INT;
  v_ticket_details JSONB := '[]'::JSONB;
  v_product_details JSONB := '[]'::JSONB;
  v_is_valid BOOLEAN := TRUE;
  v_total_price NUMERIC(10,2) := 0;
  v_total_vat NUMERIC(10,2) := 0;
  v_line_total NUMERIC(10,2);
  v_line_vat NUMERIC(10,2);
  v_item_vat_pct NUMERIC(4,2);
  v_cart_ticket_type_ids UUID[] := ARRAY[]::UUID[];
  v_restriction_count INT;
  v_has_allowed_ticket BOOLEAN;
BEGIN
  -- =========================================
  -- PHASE 1: VALIDATE TICKET ITEMS
  -- =========================================
  IF _ticket_items IS NOT NULL AND jsonb_array_length(_ticket_items) > 0 THEN
    FOR v_item IN SELECT jsonb_array_elements(_ticket_items)
    LOOP
      v_ticket_type_id := (v_item->>'ticket_type_id')::UUID;
      v_quantity := (v_item->>'quantity')::INT;

      IF v_quantity < 1 THEN
        RETURN jsonb_build_object(
          'valid', false,
          'error', 'INVALID_QUANTITY',
          'details', jsonb_build_array(
            jsonb_build_object('ticket_type_id', v_ticket_type_id, 'reason', 'Quantity must be >= 1')
          )
        );
      END IF;

      -- Lock ticket_type row for atomic capacity check
      -- Now also select vat_percentage
      SELECT tt.id, tt.name, tt.price, tt.capacity_total, tt.sales_start, tt.sales_end, tt.vat_percentage
      INTO v_ticket_type
      FROM public.ticket_types tt
      WHERE tt.id = v_ticket_type_id
        AND tt.event_id = _event_id
        AND tt.deleted_at IS NULL
      FOR UPDATE SKIP LOCKED;

      IF NOT FOUND THEN
        v_is_valid := FALSE;
        v_ticket_details := v_ticket_details || jsonb_build_array(
          jsonb_build_object(
            'ticket_type_id', v_ticket_type_id,
            'reason', 'Ticket type not found or locked by concurrent request'
          )
        );
        CONTINUE;
      END IF;

      -- Collect ticket_type_ids for later product restriction check
      v_cart_ticket_type_ids := array_append(v_cart_ticket_type_ids, v_ticket_type_id);

      -- Sales window check
      IF v_ticket_type.sales_start IS NOT NULL AND NOW() < v_ticket_type.sales_start THEN
        v_is_valid := FALSE;
        v_ticket_details := v_ticket_details || jsonb_build_array(
          jsonb_build_object(
            'ticket_type_id', v_ticket_type_id,
            'ticket_name', v_ticket_type.name,
            'reason', 'Sales have not started yet'
          )
        );
        CONTINUE;
      END IF;

      IF v_ticket_type.sales_end IS NOT NULL AND NOW() > v_ticket_type.sales_end THEN
        v_is_valid := FALSE;
        v_ticket_details := v_ticket_details || jsonb_build_array(
          jsonb_build_object(
            'ticket_type_id', v_ticket_type_id,
            'ticket_name', v_ticket_type.name,
            'reason', 'Sales have ended'
          )
        );
        CONTINUE;
      END IF;

      -- Count sold tickets (pending + paid orders)
      SELECT COALESCE(SUM(oi.quantity), 0) INTO v_sold_count
      FROM public.order_items oi
      JOIN public.orders o ON oi.order_id = o.id
      WHERE oi.ticket_type_id = v_ticket_type_id
        AND o.status IN ('pending', 'paid');

      v_available := v_ticket_type.capacity_total - v_sold_count;

      IF v_available < v_quantity THEN
        v_is_valid := FALSE;
        v_ticket_details := v_ticket_details || jsonb_build_array(
          jsonb_build_object(
            'ticket_type_id', v_ticket_type_id,
            'ticket_name', v_ticket_type.name,
            'capacity_total', v_ticket_type.capacity_total,
            'sold_count', v_sold_count,
            'available', v_available,
            'requested', v_quantity,
            'reason', 'Insufficient capacity'
          )
        );
      ELSE
        -- Calculate VAT (price is VAT-inclusive)
        v_line_total := v_ticket_type.price * v_quantity;
        v_item_vat_pct := COALESCE(v_ticket_type.vat_percentage, 21.00);
        v_line_vat := ROUND(v_line_total * v_item_vat_pct / (100 + v_item_vat_pct), 2);

        v_total_price := v_total_price + v_line_total;
        v_total_vat := v_total_vat + v_line_vat;

        v_ticket_details := v_ticket_details || jsonb_build_array(
          jsonb_build_object(
            'ticket_type_id', v_ticket_type_id,
            'ticket_name', v_ticket_type.name,
            'price', v_ticket_type.price,
            'quantity', v_quantity,
            'line_total', v_line_total,
            'vat_percentage', v_item_vat_pct,
            'vat_amount', v_line_vat,
            'available', v_available,
            'status', 'OK'
          )
        );
      END IF;
    END LOOP;
  END IF;

  -- =========================================
  -- PHASE 2: VALIDATE PRODUCT ITEMS
  -- =========================================
  IF _product_items IS NOT NULL AND jsonb_array_length(_product_items) > 0 THEN
    FOR v_item IN SELECT jsonb_array_elements(_product_items)
    LOOP
      v_product_id := (v_item->>'product_id')::UUID;
      v_variant_id := NULLIF(v_item->>'variant_id', '')::UUID;
      v_quantity := (v_item->>'quantity')::INT;

      IF v_quantity < 1 THEN
        RETURN jsonb_build_object(
          'valid', false,
          'error', 'INVALID_PRODUCT_QUANTITY',
          'details', jsonb_build_array(
            jsonb_build_object('product_id', v_product_id, 'reason', 'Quantity must be >= 1')
          )
        );
      END IF;

      -- Lock product row for atomic capacity check
      SELECT p.id, p.name, p.price, p.vat_percentage, p.capacity_total,
             p.max_per_order, p.sales_start, p.sales_end, p.category, p.org_id
      INTO v_product
      FROM public.products p
      WHERE p.id = v_product_id
        AND p.event_id = _event_id
        AND p.is_active = true
        AND p.deleted_at IS NULL
      FOR UPDATE SKIP LOCKED;

      IF NOT FOUND THEN
        v_is_valid := FALSE;
        v_product_details := v_product_details || jsonb_build_array(
          jsonb_build_object(
            'product_id', v_product_id,
            'reason', 'Product not found, inactive, or locked by concurrent request'
          )
        );
        CONTINUE;
      END IF;

      -- Sales window check
      IF v_product.sales_start IS NOT NULL AND NOW() < v_product.sales_start THEN
        v_is_valid := FALSE;
        v_product_details := v_product_details || jsonb_build_array(
          jsonb_build_object(
            'product_id', v_product_id,
            'product_name', v_product.name,
            'reason', 'Product sales have not started yet'
          )
        );
        CONTINUE;
      END IF;

      IF v_product.sales_end IS NOT NULL AND NOW() > v_product.sales_end THEN
        v_is_valid := FALSE;
        v_product_details := v_product_details || jsonb_build_array(
          jsonb_build_object(
            'product_id', v_product_id,
            'product_name', v_product.name,
            'reason', 'Product sales have ended'
          )
        );
        CONTINUE;
      END IF;

      -- max_per_order check
      IF v_quantity > v_product.max_per_order THEN
        v_is_valid := FALSE;
        v_product_details := v_product_details || jsonb_build_array(
          jsonb_build_object(
            'product_id', v_product_id,
            'product_name', v_product.name,
            'max_per_order', v_product.max_per_order,
            'requested', v_quantity,
            'reason', 'Exceeds maximum per order limit'
          )
        );
        CONTINUE;
      END IF;

      -- ticket_upgrade restriction check
      IF v_product.category = 'ticket_upgrade' THEN
        SELECT COUNT(*) INTO v_restriction_count
        FROM public.product_ticket_restrictions ptr
        WHERE ptr.product_id = v_product_id;

        IF v_restriction_count > 0 THEN
          SELECT EXISTS (
            SELECT 1 FROM public.product_ticket_restrictions ptr
            WHERE ptr.product_id = v_product_id
              AND ptr.ticket_type_id = ANY(v_cart_ticket_type_ids)
          ) INTO v_has_allowed_ticket;

          IF NOT v_has_allowed_ticket THEN
            v_is_valid := FALSE;
            v_product_details := v_product_details || jsonb_build_array(
              jsonb_build_object(
                'product_id', v_product_id,
                'product_name', v_product.name,
                'category', v_product.category,
                'reason', 'This upgrade requires a specific ticket type in your cart'
              )
            );
            CONTINUE;
          END IF;
        END IF;
      END IF;

      -- Product-level capacity check
      IF v_product.capacity_total IS NOT NULL THEN
        SELECT COALESCE(SUM(oi.quantity), 0) INTO v_sold_count
        FROM public.order_items oi
        JOIN public.orders o ON oi.order_id = o.id
        WHERE oi.product_id = v_product_id
          AND o.status IN ('pending', 'paid');

        v_available := v_product.capacity_total - v_sold_count;

        IF v_available < v_quantity THEN
          v_is_valid := FALSE;
          v_product_details := v_product_details || jsonb_build_array(
            jsonb_build_object(
              'product_id', v_product_id,
              'product_name', v_product.name,
              'capacity_total', v_product.capacity_total,
              'sold_count', v_sold_count,
              'available', v_available,
              'requested', v_quantity,
              'reason', 'Insufficient product capacity'
            )
          );
          CONTINUE;
        END IF;
      END IF;

      -- Variant-level capacity check
      IF v_variant_id IS NOT NULL THEN
        SELECT pv.id, pv.name, pv.capacity_total
        INTO v_variant
        FROM public.product_variants pv
        WHERE pv.id = v_variant_id
          AND pv.product_id = v_product_id
          AND pv.is_active = true
        FOR UPDATE SKIP LOCKED;

        IF NOT FOUND THEN
          v_is_valid := FALSE;
          v_product_details := v_product_details || jsonb_build_array(
            jsonb_build_object(
              'product_id', v_product_id,
              'variant_id', v_variant_id,
              'reason', 'Variant not found, inactive, or locked'
            )
          );
          CONTINUE;
        END IF;

        IF v_variant.capacity_total IS NOT NULL THEN
          SELECT COALESCE(SUM(oi.quantity), 0) INTO v_sold_count
          FROM public.order_items oi
          JOIN public.orders o ON oi.order_id = o.id
          WHERE oi.product_variant_id = v_variant_id
            AND o.status IN ('pending', 'paid');

          v_available := v_variant.capacity_total - v_sold_count;

          IF v_available < v_quantity THEN
            v_is_valid := FALSE;
            v_product_details := v_product_details || jsonb_build_array(
              jsonb_build_object(
                'product_id', v_product_id,
                'variant_id', v_variant_id,
                'variant_name', v_variant.name,
                'capacity_total', v_variant.capacity_total,
                'sold_count', v_sold_count,
                'available', v_available,
                'requested', v_quantity,
                'reason', 'Insufficient variant capacity'
              )
            );
            CONTINUE;
          END IF;
        END IF;
      END IF;

      -- All checks passed - accumulate price + VAT
      v_line_total := v_product.price * v_quantity;
      v_item_vat_pct := COALESCE(v_product.vat_percentage, 21.00);
      v_line_vat := ROUND(v_line_total * v_item_vat_pct / (100 + v_item_vat_pct), 2);

      v_total_price := v_total_price + v_line_total;
      v_total_vat := v_total_vat + v_line_vat;

      v_product_details := v_product_details || jsonb_build_array(
        jsonb_build_object(
          'product_id', v_product_id,
          'product_name', v_product.name,
          'variant_id', v_variant_id,
          'variant_name', COALESCE(v_variant.name, NULL),
          'price', v_product.price,
          'vat_percentage', v_item_vat_pct,
          'quantity', v_quantity,
          'line_total', v_line_total,
          'vat_amount', v_line_vat,
          'status', 'OK'
        )
      );
    END LOOP;
  END IF;

  -- =========================================
  -- RETURN RESULT (now includes total_vat)
  -- =========================================
  RETURN jsonb_build_object(
    'valid', v_is_valid,
    'total_price', v_total_price,
    'total_vat', v_total_vat,
    'ticket_details', v_ticket_details,
    'product_details', v_product_details
  );
END;
$$;

COMMENT ON FUNCTION public.validate_checkout_with_products IS 'Validates tickets and products for checkout with atomic capacity locking. Returns VAT breakdown per item.';
GRANT EXECUTE ON FUNCTION public.validate_checkout_with_products(UUID, JSONB, JSONB) TO service_role;

-- =====================================================
-- 3. UPDATE validate_setting_domain + get_default_settings
-- =====================================================
-- Add kvk_number to payments domain defaults

CREATE OR REPLACE FUNCTION public.get_default_settings(_domain TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    CASE _domain
        WHEN 'payments' THEN
            RETURN jsonb_build_object(
                'payment_profile_id', null,
                'invoice_prefix', '',
                'vat_number', '',
                'kvk_number', '',
                'vat_rate', 21
            );
        WHEN 'transfers' THEN
            RETURN jsonb_build_object(
                'allow_transfers', true,
                'transfer_deadline_hours', 48,
                'transfer_fee_cents', 0
            );
        WHEN 'communication' THEN
            RETURN jsonb_build_object(
                'support_email', '',
                'email_footer_text', '',
                'chat_enabled', false,
                'faq_enabled', false,
                'auto_reply_enabled', false,
                'auto_reply_message', '',
                'sla_hours', 24,
                'thread_auto_close_hours', 168
            );
        WHEN 'tickets' THEN
            RETURN jsonb_build_object(
                'show_remaining', true,
                'show_price', true,
                'qr_size', 200
            );
        WHEN 'scanning' THEN
            RETURN jsonb_build_object(
                'scanning_enabled', true,
                'allow_re_entry', false,
                'check_in_window_hours', 24,
                'offline_mode', false,
                'sound_enabled', true,
                'vibrate_enabled', true
            );
        ELSE
            RETURN '{}'::JSONB;
    END CASE;
END;
$$;

-- =====================================================
-- 4. BACKFILL EXISTING ORDERS (idempotent)
-- =====================================================
-- Update order_items with VAT from linked ticket_types/products
-- Only where vat_amount = 0 (not yet backfilled)

-- Backfill ticket items
UPDATE public.order_items oi
SET
  vat_percentage = COALESCE(tt.vat_percentage, 21.00),
  vat_amount = ROUND(oi.total_price * COALESCE(tt.vat_percentage, 21.00) / (100 + COALESCE(tt.vat_percentage, 21.00)), 2)
FROM public.ticket_types tt
WHERE oi.ticket_type_id = tt.id
  AND oi.vat_amount = 0
  AND oi.total_price > 0;

-- Backfill product items
UPDATE public.order_items oi
SET
  vat_percentage = COALESCE(p.vat_percentage, 21.00),
  vat_amount = ROUND(oi.total_price * COALESCE(p.vat_percentage, 21.00) / (100 + COALESCE(p.vat_percentage, 21.00)), 2)
FROM public.products p
WHERE oi.product_id = p.id
  AND oi.vat_amount = 0
  AND oi.total_price > 0;

-- Backfill orders.vat_amount as SUM of item VAT amounts
UPDATE public.orders o
SET vat_amount = sub.total_vat
FROM (
  SELECT order_id, COALESCE(SUM(vat_amount), 0) as total_vat
  FROM public.order_items
  GROUP BY order_id
) sub
WHERE o.id = sub.order_id
  AND o.vat_amount = 0
  AND sub.total_vat > 0;

-- =====================================================
-- 5. FIX FREE ITEMS (set vat_percentage = 0 for zero-price items)
-- =====================================================
-- Free tickets (e.g. from invitations) should not show 21% VAT
UPDATE public.order_items
SET vat_percentage = 0, vat_amount = 0
WHERE total_price = 0 AND unit_price = 0;

-- =====================================================
-- VERIFICATION
-- =====================================================
DO $$
BEGIN
  -- Verify columns exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_items' AND column_name = 'vat_percentage'
  ) THEN
    RAISE EXCEPTION 'order_items.vat_percentage not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_items' AND column_name = 'vat_amount'
  ) THEN
    RAISE EXCEPTION 'order_items.vat_amount not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'vat_amount'
  ) THEN
    RAISE EXCEPTION 'orders.vat_amount not created';
  END IF;

  RAISE NOTICE '--- F006 S5a: VAT Calculation ---';
  RAISE NOTICE 'order_items.vat_percentage column added';
  RAISE NOTICE 'order_items.vat_amount column added';
  RAISE NOTICE 'orders.vat_amount column added';
  RAISE NOTICE 'validate_checkout_with_products RPC updated (returns VAT info)';
  RAISE NOTICE 'get_default_settings updated (added kvk_number)';
  RAISE NOTICE 'Existing orders backfilled with VAT data';
END $$;
