-- Migration: 20240120000030_fix_accept_reject_unique.sql
-- Fix: Drop existing accept/reject functions before recreating

-- Drop existing functions to avoid "not unique" error
DROP FUNCTION IF EXISTS public.accept_ticket_transfer(uuid);
DROP FUNCTION IF EXISTS public.reject_ticket_transfer(uuid);
