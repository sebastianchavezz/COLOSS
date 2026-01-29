-- ===========================================================================
-- F006 Fix: Allow NULL user_id in participants for guest checkout
-- ===========================================================================
-- The participants table should allow user_id = NULL for guest checkouts
-- (users without an account). The original design specified this.
-- ===========================================================================

-- Drop the foreign key constraint first (if it exists with wrong ON DELETE)
ALTER TABLE public.participants
  DROP CONSTRAINT IF EXISTS participants_user_id_fkey;

-- Allow NULL for user_id
ALTER TABLE public.participants
  ALTER COLUMN user_id DROP NOT NULL;

-- Re-add foreign key with ON DELETE SET NULL (not CASCADE)
-- This way if a user account is deleted, the participant record remains
ALTER TABLE public.participants
  ADD CONSTRAINT participants_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Verify
DO $$
BEGIN
  RAISE NOTICE '✓ F006 Fix: participants.user_id now allows NULL for guest checkout';
END $$;
