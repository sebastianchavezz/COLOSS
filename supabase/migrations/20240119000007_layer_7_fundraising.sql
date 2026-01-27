-- LAAG 7: FUNDRAISING (DECORATOR)
--
-- Doel: Geld inzamelen voor goede doelen (via externe partner).
-- Afhankelijkheid: Laag 4 (Tickets), Laag 3 (Registrations)
-- Architectuur: Sidecar pattern. Core weet niets van fundraising.

-- 1. ENUMS
create type fundraising_mode as enum ('disabled', 'optional', 'required');

-- 2. CONFIGURATIE TABELLEN

-- Global of Org-level goede doelen (master list)
create table public.fundraising_charities (
    id uuid not null default gen_random_uuid(),
    org_id uuid not null, -- Charity behoort tot een organisatie
    name text not null,
    external_id text not null, -- ID bij externe partner (Supporta)
    description text,
    logo_url text,
    
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    
    constraint fundraising_charities_pkey primary key (id),
    constraint fundraising_charities_org_fkey foreign key (org_id) references public.orgs(id) on delete cascade
);

-- Event-level configuratie
create table public.fundraising_event_settings (
    event_id uuid not null, -- 1-op-1 met core.events
    mode fundraising_mode not null default 'disabled',
    
    -- Timing & Gedrag
    create_page_timing text not null default 'post_registration', -- 'during_registration', 'post_registration'
    allow_charity_selection boolean not null default true, -- Mag deelnemer kiezen?
    
    -- Metadata
    title text, -- Titel voor fundraising blok
    description text,
    
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    
    constraint fundraising_event_settings_pkey primary key (event_id),
    constraint fundraising_event_settings_event_fkey foreign key (event_id) references public.events(id) on delete cascade
);

-- Welke charities zijn beschikbaar voor dit event?
create table public.fundraising_event_charities (
    event_id uuid not null,
    charity_id uuid not null,
    is_default boolean not null default false,
    is_exclusive boolean not null default false, -- Als true: alleen deze mag gekozen worden
    
    created_at timestamptz not null default now(),
    
    constraint fundraising_event_charities_pkey primary key (event_id, charity_id),
    constraint fundraising_event_charities_event_fkey foreign key (event_id) references public.events(id) on delete cascade,
    constraint fundraising_event_charities_charity_fkey foreign key (charity_id) references public.fundraising_charities(id) on delete cascade
);

-- Ticket-level overrides (Specifieke tickets kunnen fundraising verplichten)
create table public.fundraising_ticket_overrides (
    ticket_type_id uuid not null, -- 1-op-1 met core.ticket_types
    mode fundraising_mode not null default 'required', -- Vaak 'required' bij override
    
    -- Als dit ticket gekozen wordt, is dit specifieke doel verplicht?
    forced_charity_id uuid, 
    
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    
    constraint fundraising_ticket_overrides_pkey primary key (ticket_type_id),
    constraint fundraising_ticket_overrides_ticket_fkey foreign key (ticket_type_id) references public.ticket_types(id) on delete cascade,
    constraint fundraising_ticket_overrides_charity_fkey foreign key (forced_charity_id) references public.fundraising_charities(id)
);

-- 3. OPERATIONELE TABELLEN

-- De link tussen een registratie en de externe fundraising wereld
create table public.fundraising_participations (
    id uuid not null default gen_random_uuid(),
    registration_id uuid not null, -- 1-op-1 met core.registrations
    charity_id uuid not null, -- Het gekozen doel
    
    -- Status
    external_page_id text, -- ID van pagina bij Supporta
    external_page_url text, -- URL naar actiepagina
    status text not null default 'pending', -- 'pending', 'active', 'closed'
    
    -- Cache voor display (niet source of truth!)
    total_raised_cents bigint default 0,
    
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    
    constraint fundraising_participations_pkey primary key (id),
    constraint fundraising_participations_reg_fkey foreign key (registration_id) references public.registrations(id) on delete cascade,
    constraint fundraising_participations_charity_fkey foreign key (charity_id) references public.fundraising_charities(id),
    constraint fundraising_participations_unique_reg unique (registration_id)
);

-- Indexes
create index idx_fundraising_charities_org on public.fundraising_charities(org_id);
create index idx_fundraising_participations_reg on public.fundraising_participations(registration_id);
create index idx_fundraising_participations_charity on public.fundraising_participations(charity_id);

-- 4. RLS POLICIES
alter table public.fundraising_charities enable row level security;
alter table public.fundraising_event_settings enable row level security;
alter table public.fundraising_event_charities enable row level security;
alter table public.fundraising_ticket_overrides enable row level security;
alter table public.fundraising_participations enable row level security;

-- CONFIGURATIE POLICIES

-- Publiek mag charities zien (voor selectie)
create policy "Public can view charities"
    on public.fundraising_charities
    for select
    using (true);

-- Org members mogen beheren
create policy "Org members can manage charities"
    on public.fundraising_charities
    for all
    using ( public.is_org_member(org_id) );

-- Publiek mag event settings zien (als event published is)
create policy "Public can view fundraising settings"
    on public.fundraising_event_settings
    for select
    using (
        exists (
            select 1 from public.events e
            where e.id = fundraising_event_settings.event_id
            and e.status = 'published'
        )
    );

-- Org members mogen settings beheren
create policy "Org members can manage fundraising settings"
    on public.fundraising_event_settings
    for all
    using (
        exists (
            select 1 from public.events e
            where e.id = fundraising_event_settings.event_id
            and public.is_org_member(e.org_id)
        )
    );

-- Hetzelfde voor event_charities en ticket_overrides...
create policy "Public can view event charities"
    on public.fundraising_event_charities
    for select
    using (true);

create policy "Org members can manage event charities"
    on public.fundraising_event_charities
    for all
    using (
        exists (
            select 1 from public.events e
            where e.id = fundraising_event_charities.event_id
            and public.is_org_member(e.org_id)
        )
    );

create policy "Public can view ticket overrides"
    on public.fundraising_ticket_overrides
    for select
    using (true);

create policy "Org members can manage ticket overrides"
    on public.fundraising_ticket_overrides
    for all
    using (
        exists (
            select 1 from public.ticket_types tt
            join public.events e on tt.event_id = e.id
            where tt.id = fundraising_ticket_overrides.ticket_type_id
            and public.is_org_member(e.org_id)
        )
    );

-- PARTICIPATION POLICIES

-- Publiek mag participations zien (voor "X heeft al Y opgehaald")
create policy "Public can view fundraising participations"
    on public.fundraising_participations
    for select
    using (true);

-- Users mogen hun eigen participation aanmaken (tijdens checkout)
create policy "Users can create fundraising participation"
    on public.fundraising_participations
    for insert
    with check (
        exists (
            select 1 from public.registrations r
            join public.participants p on r.participant_id = p.id
            where r.id = fundraising_participations.registration_id
            and p.user_id = auth.uid()
        )
    );

-- Updates: Alleen service role (via webhook) of owner (charity wijzigen zolang pending)
create policy "Users can update own pending participation"
    on public.fundraising_participations
    for update
    using (
        exists (
            select 1 from public.registrations r
            join public.participants p on r.participant_id = p.id
            where r.id = fundraising_participations.registration_id
            and p.user_id = auth.uid()
        )
        and status = 'pending'
    );

-- 5. TRIGGERS
create trigger handle_updated_at_fundraising_charities before update on public.fundraising_charities
  for each row execute procedure extensions.moddatetime (updated_at);

create trigger handle_updated_at_fundraising_event_settings before update on public.fundraising_event_settings
  for each row execute procedure extensions.moddatetime (updated_at);

create trigger handle_updated_at_fundraising_ticket_overrides before update on public.fundraising_ticket_overrides
  for each row execute procedure extensions.moddatetime (updated_at);

create trigger handle_updated_at_fundraising_participations before update on public.fundraising_participations
  for each row execute procedure extensions.moddatetime (updated_at);
