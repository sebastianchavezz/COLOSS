-- Add test ticket type for the test event
INSERT INTO public.ticket_types (
    event_id,
    name,
    description,
    price,
    capacity_total,
    sales_start,
    sales_end
)
SELECT
    '00000000-0000-0000-0000-000000000002'::uuid,
    'Standaard Ticket',
    'Standaard toegang tot het event',
    10.00,
    200,
    NOW() - INTERVAL '1 day',
    NOW() + INTERVAL '30 days'
WHERE NOT EXISTS (
    SELECT 1 FROM public.ticket_types
    WHERE event_id = '00000000-0000-0000-0000-000000000002'
    AND name = 'Standaard Ticket'
);

DO $$
BEGIN
  RAISE NOTICE '✓ Test ticket type inserted';
END $$;
