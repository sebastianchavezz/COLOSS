-- Migration: 20240120000027_add_rejected_to_enum.sql
-- Fix: transfer_status enum missing 'rejected' value

-- Check current enum values
DO $$ 
BEGIN
    -- Add 'rejected' to transfer_status enum if not exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'rejected' 
        AND enumtypid = 'public.transfer_status'::regtype
    ) THEN
        ALTER TYPE public.transfer_status ADD VALUE 'rejected';
        RAISE NOTICE 'Added rejected to transfer_status enum';
    ELSE
        RAISE NOTICE 'rejected already exists in transfer_status enum';
    END IF;
END $$;
