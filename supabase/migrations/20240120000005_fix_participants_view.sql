-- FIX: ticket_instances_with_payment view - avoid auth.users permission issues
--
-- Probleem: Views met security_invoker=true kunnen geen auth.users lezen vanuit client
-- Oplossing: 
-- 1. Expliciete kolom selectie (geen SELECT *)
-- 2. Gebruik alleen public tables (orders.email ipv auth.users.email)
-- 3. owner_user_id en checked_in_by blijven als UUID references (OK voor FK, niet voor SELECT)
--
-- Waarom auth.users niet direct bevraagbaar is vanuit client:
-- - auth.users is een system table met strikte RLS
-- - Clients mogen alleen hun eigen user ophalen via auth.getUser()
-- - Views/queries mogen niet direct naar auth.users.email of andere velden
-- - Gebruik public.profiles of public tables (orders.email) als identifier

-- Drop oude view
drop view if exists public.ticket_instances_with_payment;

-- Recreate view met expliciete kolommen (geen wildcards)
-- Alle velden expliciet benoemen, zodat we geen onverwachte auth.users lookups doen
create or replace view public.ticket_instances_with_payment as
select 
    -- Ticket instance velden (expliciet)
    ti.id,
    ti.event_id,
    ti.ticket_type_id,
    ti.order_id,
    ti.owner_user_id,      -- UUID reference is OK, we bevragen niet auth.users direct
    ti.qr_code,
    ti.status,
    ti.checked_in_at,
    ti.checked_in_by,      -- UUID reference is OK
    ti.created_at,
    ti.updated_at,
    
    -- Order info (gebruik email uit orders tabel, niet auth.users)
    o.status as order_status,
    o.email as order_email,
    o.user_id as order_user_id,
    
    -- Ticket type info
    tt.name as ticket_type_name,
    tt.price as ticket_type_price,
    tt.currency as ticket_type_currency,
    
    -- Event info
    e.name as event_name,
    e.slug as event_slug
from public.ticket_instances ti
join public.orders o on ti.order_id = o.id
join public.ticket_types tt on ti.ticket_type_id = tt.id
join public.events e on ti.event_id = e.id;

comment on view public.ticket_instances_with_payment is 
  'Ticket instances met order + ticket type + event info. Gebruikt orders.email als participant identifier (geen auth.users dependency).';

-- Security invoker: view gebruikt permissions van de caller (org member RLS policies)
alter view public.ticket_instances_with_payment set (security_invoker = true);
