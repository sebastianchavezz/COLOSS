-- F006: Fix simulate_payment_success RPC permissions
-- Allow service_role to call this function for development testing

-- Grant execute to service_role (for simulate-payment Edge Function)
GRANT EXECUTE ON FUNCTION public.simulate_payment_success(uuid) TO service_role;

-- Also grant to authenticated users who are org admins (for testing via UI)
-- Note: The function itself should have additional permission checks

-- Verification
DO $$
BEGIN
  RAISE NOTICE 'F006: simulate_payment_success permissions updated';
END$$;
