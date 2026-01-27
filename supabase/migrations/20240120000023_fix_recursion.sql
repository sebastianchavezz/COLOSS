-- SPRINT 9 FIX: Break RLS Recursion & Fix Check-in 400s
-- Migration: 20240120000023_fix_recursion.sql

-- ========================================================
-- 1. SECURITY DEFINER function to break RLS recursion
-- ========================================================
-- Problem: participants policy queries registrations -> registrations policy queries participants.
-- Fix: Wrap the "org member check" for participants in a SECURITY DEFINER function.
-- This bypasses RLS on registrations/events/org_members within the check, breaking the loop.

CREATE OR REPLACE FUNCTION public.org_can_view_participant(_participant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check if participant is registered for ANY event that belongs to an org
  -- where the current user is a member.
  RETURN EXISTS (
    SELECT 1
    FROM public.registrations r
    JOIN public.events e ON r.event_id = e.id
    WHERE r.participant_id = _participant_id
    AND public.is_org_member(e.org_id)
  );
END;
$$;

COMMENT ON FUNCTION public.org_can_view_participant IS 
  'Security Definer check to allow org members to view participants without triggering RLS recursion on registrations.';

-- ========================================================
-- 2. Update participants RLS policy
-- ========================================================

DROP POLICY IF EXISTS "Org members can view participants of their events" ON public.participants;

CREATE POLICY "Org members can view participants of their events"
    ON public.participants
    FOR SELECT
    USING ( public.org_can_view_participant(id) );

-- ========================================================
-- 3. Ensure ticket_instances_with_payment view has correct permissions
-- ========================================================
-- We use this view in CheckIn.tsx to avoid embedding auth.users
-- It must be accessible to org members.

-- (View already has security_invoker=true from creation, so RLS on underlying tables applies)
-- Underlying tables: ticket_instances, orders, ticket_types, events.
-- ticket_instances: Org members can view (policy exists).
-- orders: We need to ensure org members can view orders of their events.

-- Check orders policy (from layer 5)
-- If it's missing, we add it here to be safe.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'orders' 
        AND policyname = 'Org members can view event orders'
    ) THEN
        CREATE POLICY "Org members can view event orders"
            ON public.orders
            FOR SELECT
            USING (
                EXISTS (
                    SELECT 1 FROM public.events e
                    WHERE e.id = orders.event_id
                    AND public.is_org_member(e.org_id)
                )
            );
    END IF;
END $$;
