-- LAAG 2: EVENT CORE
--
-- Doel: Het centrale object 'Event' definiëren.
-- Afhankelijkheid: Laag 1 (Orgs)

-- 1. ENUMS
create type event_status as enum ('draft', 'published', 'closed');

-- 2. TABELLEN

-- Events
create table public.events (
    id uuid not null default gen_random_uuid(),
    org_id uuid not null,
    slug text not null,
    name text not null,
    description text,
    location_name text,
    start_time timestamptz not null,
    end_time timestamptz,
    status event_status not null default 'draft',
    
    -- Metadata
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz, -- Soft delete support
    
    constraint events_pkey primary key (id),
    constraint events_org_id_fkey foreign key (org_id) references public.orgs(id) on delete cascade,
    constraint events_org_slug_key unique (org_id, slug) -- Slug uniek per org
);

-- Event Settings (1-op-1 relatie met event voor uitgebreide config)
create table public.event_settings (
    event_id uuid not null,
    
    -- Configuraties
    currency text not null default 'EUR',
    vat_percentage numeric(4,2) not null default 21.00,
    support_email text,
    
    -- Toggles
    is_public_visible boolean not null default false, -- Mag de wereld dit zien?
    allow_waitlist boolean not null default false,
    
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    
    constraint event_settings_pkey primary key (event_id),
    constraint event_settings_event_id_fkey foreign key (event_id) references public.events(id) on delete cascade
);

-- Indexes
create index idx_events_org_id on public.events(org_id);
create index idx_events_slug on public.events(slug);
create index idx_events_start_time on public.events(start_time);

-- 3. RLS POLICIES
alter table public.events enable row level security;
alter table public.event_settings enable row level security;

-- EVENTS POLICIES

-- Publieke leesrechten (alleen als published EN niet deleted)
create policy "Public can view published events"
    on public.events
    for select
    using (
        status = 'published' 
        and deleted_at is null
    );

-- Org members mogen ALLES zien van hun org (ook drafts)
create policy "Org members can view all org events"
    on public.events
    for select
    using ( public.is_org_member(org_id) );

-- Alleen admins/owners mogen events aanmaken/bewerken
create policy "Admins can manage events"
    on public.events
    for all
    using ( 
        public.has_role(org_id, 'admin') 
        or public.has_role(org_id, 'owner') 
    );

-- EVENT SETTINGS POLICIES

-- Publiek mag settings lezen als het event published is (bv. voor currency display)
create policy "Public can view settings of published events"
    on public.event_settings
    for select
    using (
        exists (
            select 1 from public.events e
            where e.id = event_settings.event_id
            and e.status = 'published'
            and e.deleted_at is null
        )
    );

-- Org members mogen settings zien
create policy "Org members can view settings"
    on public.event_settings
    for select
    using (
        exists (
            select 1 from public.events e
            where e.id = event_settings.event_id
            and public.is_org_member(e.org_id)
        )
    );

-- Alleen admins/owners mogen settings wijzigen
create policy "Admins can update settings"
    on public.event_settings
    for update
    using (
        exists (
            select 1 from public.events e
            where e.id = event_settings.event_id
            and (public.has_role(e.org_id, 'admin') or public.has_role(e.org_id, 'owner'))
        )
    );

-- 4. TRIGGERS

-- Auto-create settings bij aanmaken event
create or replace function public.handle_new_event()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.event_settings (event_id)
  values (new.id);
  return new;
end;
$$;

create trigger on_event_created
  after insert on public.events
  for each row execute procedure public.handle_new_event();

-- Updated_at triggers
create trigger handle_updated_at_events before update on public.events
  for each row execute procedure extensions.moddatetime (updated_at);

create trigger handle_updated_at_event_settings before update on public.event_settings
  for each row execute procedure extensions.moddatetime (updated_at);
