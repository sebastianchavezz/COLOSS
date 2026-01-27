-- TICKET INSTANCES: Daadwerkelijke verkochte/uitgegeven tickets
--
-- Doel: Elk ticket dat verkocht is krijgt een instance met QR code en status.
-- Dit is het fundament voor scan/check-in functionaliteit.
--
-- Relaties:
-- - ticket_instances.ticket_type_id -> ticket_types (welk type ticket)
-- - ticket_instances.order_id -> orders (via welke order gekocht)
-- - ticket_instances.owner_user_id -> auth.users (wie bezit dit ticket, nullable voor gasten)

-- 1. ENUM voor ticket instance status
create type ticket_instance_status as enum ('issued', 'void', 'checked_in');

comment on type ticket_instance_status is 
  'Status van een ticket instance: issued=geldig, void=ongeldig gemaakt, checked_in=ingescand';

-- 2. TABEL: ticket_instances
create table public.ticket_instances (
    id uuid not null default gen_random_uuid(),
    
    -- Relaties
    event_id uuid not null,           -- Event waar dit ticket voor geldt
    ticket_type_id uuid not null,     -- Type ticket (Early Bird, VIP, etc.)
    order_id uuid not null,           -- Order waarmee dit ticket gekocht is
    owner_user_id uuid,                -- Optioneel: gebruiker die dit ticket bezit
    
    -- QR/Barcode (uniek binnen het systeem)
    qr_code text not null unique,     -- Unieke code voor QR (UUID of signed token later)
    
    -- Status en check-in tracking
    status ticket_instance_status not null default 'issued',
    checked_in_at timestamptz,        -- Wanneer ingescand
    checked_in_by uuid,                -- Welke org member heeft ingescand
    
    -- Metadata
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    
    constraint ticket_instances_pkey primary key (id),
    constraint ticket_instances_event_id_fkey foreign key (event_id) 
        references public.events(id) on delete restrict,
    constraint ticket_instances_ticket_type_id_fkey foreign key (ticket_type_id) 
        references public.ticket_types(id) on delete restrict,
    constraint ticket_instances_order_id_fkey foreign key (order_id) 
        references public.orders(id) on delete restrict,
    constraint ticket_instances_owner_user_id_fkey foreign key (owner_user_id) 
        references auth.users(id) on delete set null,
    constraint ticket_instances_checked_in_by_fkey foreign key (checked_in_by) 
        references auth.users(id) on delete set null,
    
    -- Constraint: checked_in_at en checked_in_by moeten beiden gezet zijn of beiden null
    constraint ticket_instances_check_in_consistency check (
        (checked_in_at is null and checked_in_by is null) or 
        (checked_in_at is not null and checked_in_by is not null)
    )
);

comment on table public.ticket_instances is 
  'Daadwerkelijke verkochte tickets met QR codes en check-in status';
comment on column public.ticket_instances.qr_code is 
  'Unieke QR code, kan later signed token worden voor extra security';
comment on column public.ticket_instances.status is 
  'issued=geldig, void=geannuleerd, checked_in=ingescand op event';

-- 3. INDEXES
create index idx_ticket_instances_event_id on public.ticket_instances(event_id);
create index idx_ticket_instances_ticket_type_id on public.ticket_instances(ticket_type_id);
create index idx_ticket_instances_order_id on public.ticket_instances(order_id);
create index idx_ticket_instances_owner_user_id on public.ticket_instances(owner_user_id);
create index idx_ticket_instances_qr_code on public.ticket_instances(qr_code);
create index idx_ticket_instances_status on public.ticket_instances(status);

-- Composite index voor statistieken: hoeveel tickets per type en status
create index idx_ticket_instances_type_status on public.ticket_instances(ticket_type_id, status);

-- 4. RLS POLICIES
alter table public.ticket_instances enable row level security;

-- Users kunnen hun eigen tickets zien
create policy "Users can view own ticket instances"
    on public.ticket_instances
    for select
    using (
        owner_user_id = auth.uid()
        or exists (
            select 1 from public.orders o
            where o.id = ticket_instances.order_id
            and o.user_id = auth.uid()
        )
    );

-- Org members kunnen alle tickets van hun events zien
create policy "Org members can view ticket instances"
    on public.ticket_instances
    for select
    using (
        exists (
            select 1 from public.events e
            where e.id = ticket_instances.event_id
            and public.is_org_member(e.org_id)
        )
    );

-- Alleen system (Edge Functions met service role) mag tickets aanmaken
-- Voor nu: insert allowed voor authenticated (later inperken tot service role)
create policy "System can create ticket instances"
    on public.ticket_instances
    for insert
    with check (true);

-- Org members kunnen status updaten (voor check-in)
create policy "Org members can update ticket instances"
    on public.ticket_instances
    for update
    using (
        exists (
            select 1 from public.events e
            where e.id = ticket_instances.event_id
            and public.is_org_member(e.org_id)
        )
    );

-- 5. TRIGGERS
create trigger handle_updated_at_ticket_instances before update on public.ticket_instances
    for each row execute procedure extensions.moddatetime (updated_at);

-- 6. HELPFUL VIEW: Ticket instance met order status (om te bepalen of betaald)
create or replace view public.ticket_instances_with_payment as
select 
    ti.*,
    o.status as order_status,
    o.email as order_email,
    o.user_id as order_user_id,
    tt.name as ticket_type_name,
    tt.price as ticket_type_price,
    e.name as event_name
from public.ticket_instances ti
join public.orders o on ti.order_id = o.id
join public.ticket_types tt on ti.ticket_type_id = tt.id
join public.events e on ti.event_id = e.id;

comment on view public.ticket_instances_with_payment is 
  'Helper view: ticket instances met order status om betaalstatus te kunnen checken';

-- RLS moet ook op de view (zelfde policies als ticket_instances)
alter view public.ticket_instances_with_payment set (security_invoker = true);
