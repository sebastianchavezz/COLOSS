-- Fix bug: v_variant not assigned when no variant specified
-- The RPC was trying to use v_variant.name even when variant_id is NULL

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
  v_cart_ticket_type_ids UUID[] := ARRAY[]::UUID[];
  v_restriction_count INT;
  v_has_allowed_ticket BOOLEAN;
  v_variant_name TEXT := NULL;  -- Explicit default
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

      SELECT tt.id, tt.name, tt.price, tt.capacity_total, tt.sales_start, tt.sales_end
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

      v_cart_ticket_type_ids := array_append(v_cart_ticket_type_ids, v_ticket_type_id);

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
        v_total_price := v_total_price + (v_ticket_type.price * v_quantity);
        v_ticket_details := v_ticket_details || jsonb_build_array(
          jsonb_build_object(
            'ticket_type_id', v_ticket_type_id,
            'ticket_name', v_ticket_type.name,
            'price', v_ticket_type.price,
            'quantity', v_quantity,
            'line_total', v_ticket_type.price * v_quantity,
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
      v_variant_name := NULL;  -- Reset for each iteration

      IF v_quantity < 1 THEN
        RETURN jsonb_build_object(
          'valid', false,
          'error', 'INVALID_PRODUCT_QUANTITY',
          'details', jsonb_build_array(
            jsonb_build_object('product_id', v_product_id, 'reason', 'Quantity must be >= 1')
          )
        );
      END IF;

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

      -- Variant-level capacity check (only if variant specified)
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

        v_variant_name := v_variant.name;

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

      -- All checks passed - accumulate price
      v_total_price := v_total_price + (v_product.price * v_quantity);
      v_product_details := v_product_details || jsonb_build_array(
        jsonb_build_object(
          'product_id', v_product_id,
          'product_name', v_product.name,
          'variant_id', v_variant_id,
          'variant_name', v_variant_name,  -- Use local variable, not record field
          'price', v_product.price,
          'vat_percentage', v_product.vat_percentage,
          'quantity', v_quantity,
          'line_total', v_product.price * v_quantity,
          'status', 'OK'
        )
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'valid', v_is_valid,
    'total_price', v_total_price,
    'ticket_details', v_ticket_details,
    'product_details', v_product_details
  );
END;
$$;

COMMENT ON FUNCTION public.validate_checkout_with_products IS 'Validates tickets and products for checkout with atomic capacity locking (fixed variant bug)';

DO $$
BEGIN
  RAISE NOTICE '✓ Fixed variant bug in validate_checkout_with_products';
END $$;
