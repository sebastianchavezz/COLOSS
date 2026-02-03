-- Fix test products to use event that has ticket_types
-- Event 75cd6d6d-6d99-460a-b2f6-4f4aff20ab84 has existing tickets

-- First get the org_id from the event
DO $$
DECLARE
  v_event_id UUID := '75cd6d6d-6d99-460a-b2f6-4f4aff20ab84';
  v_org_id UUID;
BEGIN
  SELECT org_id INTO v_org_id FROM public.events WHERE id = v_event_id;

  IF v_org_id IS NULL THEN
    RAISE NOTICE 'Event not found, skipping product update';
    RETURN;
  END IF;

  -- Update existing test products
  UPDATE public.products
  SET event_id = v_event_id, org_id = v_org_id
  WHERE name IN ('Test T-Shirt', 'VIP Upgrade');

  -- If no rows updated, insert new products
  IF NOT FOUND THEN
    INSERT INTO public.products (event_id, org_id, category, name, description, price, vat_percentage, capacity_total, max_per_order, is_active)
    VALUES
      (v_event_id, v_org_id, 'standalone', 'Test T-Shirt', 'Een test T-shirt', 15.00, 21.00, 100, 5, true),
      (v_event_id, v_org_id, 'ticket_upgrade', 'VIP Upgrade', 'Upgrade naar VIP', 25.00, 21.00, 50, 1, true);
  END IF;

  RAISE NOTICE '✓ Products linked to event %', v_event_id;
END $$;
