-- LAAG 1: IDENTITEIT & MULTI-TENANT ISOLATIE
--
-- Doel: Fundament leggen voor organisaties en toegang.
-- Security: RLS is leidend. Default deny.

-- 0. EXTENSIONS
create extension if not exists "moddatetime" schema "extensions";

-- 1. ENUMS & TYPES
create type app_role as enum ('owner', 'admin', 'support', 'finance');

-- 2. TABELLEN

-- Orgs: De tenants
create table public.orgs (
    id uuid not null default gen_random_uuid(),
    name text not null,
    slug text not null, -- voor mooie urls / unieke herkenning
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    
    constraint orgs_pkey primary key (id),
    constraint orgs_slug_key unique (slug),
    constraint orgs_name_check check (char_length(name) >= 3)
);

-- Org Members: Koppeling User <-> Org
create table public.org_members (
    id uuid not null default gen_random_uuid(),
    org_id uuid not null,
    user_id uuid not null default auth.uid(), -- Link naar auth.users
    role app_role not null default 'support',
    created_at timestamptz not null default now(),
    
    constraint org_members_pkey primary key (id),
    constraint org_members_org_id_fkey foreign key (org_id) references public.orgs(id) on delete cascade,
    constraint org_members_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
    constraint org_members_org_user_unique unique (org_id, user_id)
);

-- Indexes voor performance
create index idx_org_members_user_id on public.org_members(user_id);
create index idx_org_members_org_id on public.org_members(org_id);

-- 3. ROW LEVEL SECURITY (RLS)
-- Zet RLS aan op alle tabellen (Verplichting uit Constitution)
alter table public.orgs enable row level security;
alter table public.org_members enable row level security;

-- Helper functie om recursie te voorkomen in policies
-- Checkt of de huidige user lid is van de org
create or replace function public.is_org_member(_org_id uuid)
returns boolean
language sql
security definer -- draait als owner om org_members te mogen lezen
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.org_members
    where org_id = _org_id
    and user_id = auth.uid()
  );
$$;

-- Helper functie om rol te checken
create or replace function public.has_role(_org_id uuid, _role app_role)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.org_members
    where org_id = _org_id
    and user_id = auth.uid()
    and role = _role
  );
$$;

-- POLICIES: ORGS

-- Iedereen mag een org aanmaken (wordt daarna owner via trigger of app logic)
create policy "Users can create organizations"
    on public.orgs
    for insert
    with check (auth.uid() is not null);

-- Alleen leden mogen hun org zien
create policy "Members can view their own organizations"
    on public.orgs
    for select
    using ( public.is_org_member(id) );

-- Alleen owners mogen org details updaten
create policy "Owners can update their organization"
    on public.orgs
    for update
    using ( public.has_role(id, 'owner') );

-- POLICIES: ORG_MEMBERS

-- Leden mogen zien wie er in hun org zit
create policy "Members can view other members of their org"
    on public.org_members
    for select
    using ( 
        public.is_org_member(org_id) 
        -- Of: user ziet zichzelf altijd (voor initial bootstrap)
        or user_id = auth.uid() 
    );

-- Alleen owners mogen leden toevoegen/beheren
create policy "Owners can manage members"
    on public.org_members
    for all
    using ( public.has_role(org_id, 'owner') );

-- 4. TRIGGERS & AUTOMATION

-- Automatisch 'updated_at' bijwerken
-- Let op: we gebruiken expliciet extensions.moddatetime
create trigger handle_updated_at before update on public.orgs
  for each row execute procedure extensions.moddatetime (updated_at);

-- Zorg dat de maker van een org direct owner wordt
-- Dit is cruciaal, anders kan je je eigen aangemaakte org niet zien/beheren
create or replace function public.handle_new_org()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.org_members (org_id, user_id, role)
  values (new.id, auth.uid(), 'owner');
  return new;
end;
$$;

create trigger on_org_created
  after insert on public.orgs
  for each row execute procedure public.handle_new_org();
