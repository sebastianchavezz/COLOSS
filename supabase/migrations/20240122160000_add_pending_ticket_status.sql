-- Add 'pending' to ticket_status enum if it doesn't exist
ALTER TYPE ticket_status ADD VALUE IF NOT EXISTS 'pending';
