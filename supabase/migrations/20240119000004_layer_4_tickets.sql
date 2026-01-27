-- LAAG 4: TICKETS & CAPACITEIT
--
-- Doel: Wat koopt de deelnemer? Toegangsbewijzen en voorraadbeheer.
-- Afhankelijkheid: Laag 3 (Registrations)

-- 1. ENUMS
create type ticket_status as enum ('valid', 'used', 'cancelled');

-- 2. TABELLEN

-- Ticket Types: De 'producten' die je kan kopen (bv. "Early Bird", "VIP")
create table public.ticket_types (
    id uuid not null default gen_random_uuid(),
    event_id uuid not null,
    name text not null,
    description text,
    
    -- Financieel
    price numeric(10,2) not null default 0.00, -- Prijs in event currency
    vat_percentage numeric(4,2) not null default 21.00,
    
    -- Capaciteit & Timing
    capacity_total integer not null, -- Harde limiet
    sales_start timestamptz,
    sales_end timestamptz,
    
    -- Metadata
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz, -- Soft delete
    
    constraint ticket_types_pkey primary key (id),
    constraint ticket_types_event_id_fkey foreign key (event_id) references public.events(id) on delete cascade,
    constraint ticket_types_capacity_check check (capacity_total >= 0),
    constraint ticket_types_price_check check (price >= 0)
);

-- Tickets: Het daadwerkelijke toegangsbewijs (1-op-1 of 1-op-N met registratie)
-- In dit model: 1 ticket hoort bij 1 registratie.
create table public.tickets (
    id uuid not null default gen_random_uuid(),
    registration_id uuid not null,
    ticket_type_id uuid not null,
    
    -- Identificatie
    barcode text not null, -- Unieke code voor QR (bv. UUID of random string)
    status ticket_status not null default 'valid',
    
    -- Metadata
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    
    constraint tickets_pkey primary key (id),
    constraint tickets_registration_id_fkey foreign key (registration_id) references public.registrations(id) on delete restrict,
    constraint tickets_ticket_type_id_fkey foreign key (ticket_type_id) references public.ticket_types(id) on delete restrict,
    
    -- Unieke barcode binnen het systeem (of per event, maar globaal is veiliger)
    constraint tickets_barcode_key unique (barcode)
);

-- Indexes
create index idx_ticket_types_event_id on public.ticket_types(event_id);
create index idx_tickets_registration_id on public.tickets(registration_id);
create index idx_tickets_ticket_type_id on public.tickets(ticket_type_id);
create index idx_tickets_barcode on public.tickets(barcode);

-- 3. RLS POLICIES
alter table public.ticket_types enable row level security;
alter table public.tickets enable row level security;

-- TICKET TYPES POLICIES

-- Publiek mag ticket types zien als event published is (voor aankoop)
create policy "Public can view ticket types of published events"
    on public.ticket_types
    for select
    using (
        exists (
            select 1 from public.events e
            where e.id = ticket_types.event_id
            and e.status = 'published'
            and e.deleted_at is null
        )
        and deleted_at is null
    );

-- Org members mogen alles zien
create policy "Org members can view ticket types"
    on public.ticket_types
    for select
    using (
        exists (
            select 1 from public.events e
            where e.id = ticket_types.event_id
            and public.is_org_member(e.org_id)
        )
    );

-- Admins mogen beheren
create policy "Admins can manage ticket types"
    on public.ticket_types
    for all
    using (
        exists (
            select 1 from public.events e
            where e.id = ticket_types.event_id
            and (public.has_role(e.org_id, 'admin') or public.has_role(e.org_id, 'owner'))
        )
    );

-- TICKETS POLICIES

-- Users mogen hun eigen tickets zien
create policy "Users can view own tickets"
    on public.tickets
    for select
    using (
        exists (
            select 1 from public.registrations r
            join public.participants p on r.participant_id = p.id
            where r.id = tickets.registration_id
            and p.user_id = auth.uid()
        )
    );

-- Org members mogen tickets zien (voor scannen/support)
create policy "Org members can view tickets"
    on public.tickets
    for select
    using (
        exists (
            select 1 from public.ticket_types tt
            join public.events e on tt.event_id = e.id
            where tt.id = tickets.ticket_type_id
            and public.is_org_member(e.org_id)
        )
    );

-- Tickets worden aangemaakt door systeem (checkout) of admins
-- Voor nu: insert allowed voor authenticated (tijdens checkout flow, later inperken tot service role als we strict zijn)
create policy "System/Users can create tickets"
    on public.tickets
    for insert
    with check (true); 

-- Updates (bv. status naar 'used') alleen door org members of service role
create policy "Org members can update tickets"
    on public.tickets
    for update
    using (
        exists (
            select 1 from public.ticket_types tt
            join public.events e on tt.event_id = e.id
            where tt.id = tickets.ticket_type_id
            and public.is_org_member(e.org_id)
        )
    );

-- 4. TRIGGERS
create trigger handle_updated_at_ticket_types before update on public.ticket_types
  for each row execute procedure extensions.moddatetime (updated_at);

create trigger handle_updated_at_tickets before update on public.tickets
  for each row execute procedure extensions.moddatetime (updated_at);
