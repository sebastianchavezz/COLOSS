-- SPRINT 15: Fix existing ticket statuses
-- Context: Old tickets may have 'issued' status, update to 'valid'

-- Update all 'issued' tickets to 'valid' (new enum value)
UPDATE public.tickets 
SET status = 'valid', updated_at = now()
WHERE status::text = 'issued';

-- Update all 'checked_in' tickets to 'used' if that exists, otherwise 'valid'
UPDATE public.tickets 
SET status = 'valid', updated_at = now()
WHERE status::text = 'checked_in';

-- Verification query (will be in logs)
DO $$
DECLARE
  v_valid_count int;
  v_pending_count int;
  v_cancelled_count int;
BEGIN
  SELECT count(*) INTO v_valid_count FROM public.tickets WHERE status = 'valid';
  SELECT count(*) INTO v_pending_count FROM public.tickets WHERE status = 'pending';
  SELECT count(*) INTO v_cancelled_count FROM public.tickets WHERE status = 'cancelled';
  
  RAISE NOTICE 'Ticket status counts: valid=%, pending=%, cancelled=%', v_valid_count, v_pending_count, v_cancelled_count;
END $$;
