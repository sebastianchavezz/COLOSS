-- Temporary test data for checkout testing
-- This migration inserts a test product for the existing published event

INSERT INTO public.products (
    event_id,
    org_id,
    category,
    name,
    description,
    price,
    vat_percentage,
    capacity_total,
    max_per_order,
    is_active
)
SELECT
    '00000000-0000-0000-0000-000000000002'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    'standalone'::product_category,
    'Test T-Shirt',
    'Een test T-shirt voor checkout testing',
    15.00,
    21.00,
    100,
    5,
    true
WHERE NOT EXISTS (
    SELECT 1 FROM public.products WHERE name = 'Test T-Shirt'
);

-- Also add a ticket_upgrade product
INSERT INTO public.products (
    event_id,
    org_id,
    category,
    name,
    description,
    price,
    vat_percentage,
    capacity_total,
    max_per_order,
    is_active
)
SELECT
    '00000000-0000-0000-0000-000000000002'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    'ticket_upgrade'::product_category,
    'VIP Upgrade',
    'Upgrade naar VIP toegang',
    25.00,
    21.00,
    50,
    1,
    true
WHERE NOT EXISTS (
    SELECT 1 FROM public.products WHERE name = 'VIP Upgrade'
);

DO $$
BEGIN
  RAISE NOTICE '✓ Test products inserted';
END $$;
