-- Add 'pending' to ticket_status enum
ALTER TYPE public.ticket_status ADD VALUE IF NOT EXISTS 'pending';
