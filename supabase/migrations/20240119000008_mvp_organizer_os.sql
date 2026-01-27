-- MVP ORGANIZER OS & IDENTITY FIXES
--
-- Doel: Profiles toevoegen, account verplicht maken, RLS aanscherpen.
-- Context: Organizer OS MVP.

-- 1. PROFILES (Global Identity)
-- Fix 1: Email nullable voor Apple/OTP support. Phone toegevoegd.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  phone text,
  full_name text,
  avatar_url text,
  updated_at timestamptz default now()
);

alter table public.profiles enable row level security;

-- Trigger: Keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

-- Trigger: Create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, phone, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.phone,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do update
    set email = excluded.email,
        phone = excluded.phone,
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
        updated_at = now();
  return new;
end;
$$;

-- Drop trigger if exists to avoid duplication errors during re-runs
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();


-- 2. PARTICIPANTS (Account Verplicht)
-- We maken user_id verplicht.
-- Let op: Dit faalt als er al participants zijn zonder user_id. 
-- In dev omgeving is truncate acceptabel, in prod zou je data migration moeten doen.
-- Voor nu gaan we ervan uit dat het kan.

-- Eerst oude constraint droppen (uit Layer 3)
alter table public.participants drop constraint if exists participants_user_id_fkey;

-- Kolom aanpassen
alter table public.participants alter column user_id set not null;

-- Nieuwe constraint (cascade delete)
alter table public.participants
  add constraint participants_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

-- Opmerking over unieke index:
-- De tabel 'participants' heeft geen 'event_id' kolom in het huidige schema (Laag 3).
-- De koppeling met events zit in de 'registrations' tabel.
-- Daarom voegen we GEEN unieke index op (event_id, user_id) toe aan participants.
-- Wel zorgen we dat registrations uniek zijn per participant/event (bestaat al in Laag 3).


-- 3. RLS HELPERS
-- (Herhaling/Update van Laag 1 voor zekerheid)

create or replace function public.is_org_member(_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = _org_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(_org_id uuid, _roles app_role[])
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = _org_id
      and m.user_id = auth.uid()
      and m.role = any(_roles)
  );
$$;


-- 4. RLS POLICIES (MVP Set)

-- PROFILES
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
for select using (id = auth.uid());

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
for update using (id = auth.uid())
with check (id = auth.uid());

-- EVENTS
-- Organizer full access, Participant read published
drop policy if exists "Org members can view all org events" on public.events;
drop policy if exists "Admins can manage events" on public.events;
drop policy if exists "Public can view published events" on public.events;

create policy "org members manage events" on public.events
for all
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

create policy "participants read published events" on public.events
for select
using (status = 'published');

-- REGISTRATIONS
-- Participant eigen, Organizer via event
drop policy if exists "Users can view own registrations" on public.registrations;
drop policy if exists "Org members can view event registrations" on public.registrations;
drop policy if exists "Public can create registrations" on public.registrations;

create policy "participants read own registrations" on public.registrations
for select using (
  exists (
    select 1
    from public.participants p
    where p.id = registrations.participant_id
      and p.user_id = auth.uid()
  )
);

create policy "org members manage registrations" on public.registrations
for all using (
  exists (select 1 from public.events e
          where e.id = registrations.event_id
            and public.is_org_member(e.org_id))
)
with check (
  exists (select 1 from public.events e
          where e.id = registrations.event_id
            and public.is_org_member(e.org_id))
);

-- Public create policy voor registrations (nodig voor checkout?)
-- Als account verplicht is, is het 'Authenticated users can create registrations'
create policy "authenticated users create registrations" on public.registrations
for insert
with check (
  auth.role() = 'authenticated'
  -- Eventueel extra check: mag user zich inschrijven?
);
