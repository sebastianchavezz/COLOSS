-- SPRINT: FIX STATS & MY TICKETS
-- Context: Organizer OS stats bug & phone_ui My Tickets feature.
-- NOTE: Using 'tickets' table as source of truth for now (Layer 4), 
-- but aliasing columns to match future 'ticket_instances' structure where possible.

-- 1. VIEW: Ticket Type Stats (Fixes Organizer OS "Sold" count)
create or replace view public.ticket_type_stats as
select
  tt.id as ticket_type_id,
  tt.id, -- Alias for easier casting
  tt.event_id,
  tt.name,
  tt.description,
  tt.price,
  tt.currency,
  tt.capacity_total as capacity, -- Alias to match user expectation
  tt.sales_start,
  tt.sales_end,
  tt.status,
  tt.sort_order,
  tt.created_at,
  tt.updated_at,
  tt.deleted_at,

  -- Sold count: valid + pending
  count(t.id) filter (
    where t.status in ('valid', 'pending')
  ) as sold,

  -- Remaining: capacity - sold
  greatest(
    0,
    coalesce(tt.capacity_total, 0)
    - count(t.id) filter (where t.status in ('valid', 'pending'))
  ) as remaining

from public.ticket_types tt
left join public.tickets t
  on t.ticket_type_id = tt.id
group by tt.id;

-- Security: Inherit permissions from underlying tables (RLS enabled on tables)
alter view public.ticket_type_stats set (security_invoker = true);

-- 2. VIEW: My Tickets (for phone_ui)
-- Flattens tickets -> registrations -> participants -> events
create or replace view public.my_tickets_view as
select
  t.id as ticket_id,
  t.id as ticket_instance_id, -- Alias for future compatibility
  t.barcode,
  t.status,
  t.created_at,
  
  tt.id as ticket_type_id,
  tt.name as ticket_name,
  tt.price,
  tt.currency,
  
  e.id as event_id,
  e.name as event_name,
  e.start_time as starts_at, -- Alias to match UI expectation
  e.location_name,
  
  p.user_id as owner_user_id

from public.tickets t
join public.registrations r on t.registration_id = r.id
join public.participants p on r.participant_id = p.id
join public.ticket_types tt on t.ticket_type_id = tt.id
join public.events e on tt.event_id = e.id
where t.status in ('valid', 'pending'); -- Only show relevant tickets

-- Security: Inherit permissions
alter view public.my_tickets_view set (security_invoker = true);
