-- FIX: Remove auth.users queries from RLS policies
--
-- Problem: 
-- RLS policies that query auth.users fail in client context with "permission denied"
-- Example: (email = (SELECT email FROM auth.users WHERE id = auth.uid()))
--
-- Solution:
-- 1. Remove auth.users SELECT from orders policies
-- 2. Rely on org membership via events->org_members for organizers
-- 3. End users will see their orders via user_id = auth.uid() only
--
-- Note: We keep the "Users can view own orders" policy but remove the auth.users fallback

-- ============================================================
-- ORDERS POLICIES FIX
-- ============================================================

-- Drop oude policies
drop policy if exists "Users can view own orders" on public.orders;
drop policy if exists "Org members can view orders" on public.orders;

-- Recreate without auth.users query
-- Policy 1: Users can view orders where they are the user_id
create policy "Users can view own orders"
    on public.orders
    for select
    using (
        user_id = auth.uid()
    );

-- Policy 2: Org members can view ALL orders for their events
create policy "Org members can view orders"
    on public.orders
    for select
    using (
        exists (
            select 1 from public.events e
            where e.id = orders.event_id
            and public.is_org_member(e.org_id)
        )
    );

comment on policy "Users can view own orders" on public.orders is
    'Authenticated users can view orders where user_id matches. No auth.users query needed.';

comment on policy "Org members can view orders" on public.orders is
    'Org members can view all orders for events in their organization.';

-- ============================================================
-- ORDER_ITEMS POLICIES FIX
-- ============================================================

-- Drop oude policies
drop policy if exists "Users can view own order items" on public.order_items;
drop policy if exists "Org members can view order items" on public.order_items;

-- Recreate: User policy via orders.user_id (no auth.users)
create policy "Users can view own order items"
    on public.order_items
    for select
    using (
        exists (
            select 1 from public.orders o
            where o.id = order_items.order_id
            and o.user_id = auth.uid()
        )
    );

-- Recreate: Org member policy unchanged (already correct)
create policy "Org members can view order items"
    on public.order_items
    for select
    using (
        exists (
            select 1 from public.orders o
            join public.events e on o.event_id = e.id
            where o.id = order_items.order_id
            and public.is_org_member(e.org_id)
        )
    );

comment on policy "Users can view own order items" on public.order_items is
    'Users can view items for orders they own via user_id match.';

-- ============================================================
-- TICKET_TRANSFERS POLICIES FIX (if exists)
-- ============================================================

-- Check if ticket_transfers policies exist and fix them
do $$
begin
    -- Drop policies if they exist
    drop policy if exists "Users can view transfers as sender" on public.ticket_transfers;
    drop policy if exists "Users can view transfers as recipient" on public.ticket_transfers;
    
    -- Recreate without auth.users queries
    -- Note: These policies might not exist yet depending on migration order
    -- We create them defensively
    
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'ticket_transfers') then
        create policy "Users can view transfers as sender"
            on public.ticket_transfers
            for select
            using (
                from_user_id = auth.uid()
            );
        
        create policy "Users can view transfers as recipient"
            on public.ticket_transfers
            for select
            using (
                to_user_id = auth.uid()
            );
    end if;
end $$;

-- ============================================================
-- VERIFICATION
-- ============================================================

-- List all policies that might still reference auth.users
-- Run this manually to verify:
-- SELECT schemaname, tablename, policyname, definition 
-- FROM pg_policies 
-- WHERE definition LIKE '%auth.users%';
