-- Force PostgREST schema cache reload
-- This is a workaround for schema cache not updating after RPC creation

-- Add a comment to trigger reload
COMMENT ON FUNCTION public.create_product IS 'Create new product with optional ticket restrictions (admin only). Triggers schema reload.';

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
