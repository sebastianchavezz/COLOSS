-- SPRINT 4: CHECK-IN SYSTEM
-- Migration: 20240120000016_checkin_system.sql
-- IDEMPOTENT REWRITE

-- 1. Enable pgcrypto for hashing in SQL
create extension if not exists pgcrypto;

-- 2. Create ticket_checkins table
create table if not exists public.ticket_checkins (
    id uuid not null default gen_random_uuid(),
    constraint ticket_checkins_pkey primary key (id)
);

-- Add columns
alter table public.ticket_checkins add column if not exists org_id uuid not null;
alter table public.ticket_checkins add column if not exists event_id uuid not null;
alter table public.ticket_checkins add column if not exists ticket_instance_id uuid not null;
alter table public.ticket_checkins add column if not exists checked_in_at timestamptz not null default now();
alter table public.ticket_checkins add column if not exists checked_in_by uuid not null;
alter table public.ticket_checkins add column if not exists source text not null default 'scan';
alter table public.ticket_checkins add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.ticket_checkins add column if not exists created_at timestamptz not null default now();
alter table public.ticket_checkins add column if not exists deleted_at timestamptz null;

-- Constraints
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'ticket_checkins_org_fkey') then
        alter table public.ticket_checkins add constraint ticket_checkins_org_fkey 
        foreign key (org_id) references public.orgs(id);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'ticket_checkins_event_fkey') then
        alter table public.ticket_checkins add constraint ticket_checkins_event_fkey 
        foreign key (event_id) references public.events(id);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'ticket_checkins_ticket_fkey') then
        alter table public.ticket_checkins add constraint ticket_checkins_ticket_fkey 
        foreign key (ticket_instance_id) references public.ticket_instances(id);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'ticket_checkins_user_fkey') then
        alter table public.ticket_checkins add constraint ticket_checkins_user_fkey 
        foreign key (checked_in_by) references auth.users(id);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'ticket_checkins_unique_ticket') then
        alter table public.ticket_checkins add constraint ticket_checkins_unique_ticket 
        unique (ticket_instance_id);
    end if;
exception when duplicate_object then null;
end $$;

-- 3. Indexes
create index if not exists idx_ticket_checkins_event_date on public.ticket_checkins(event_id, checked_in_at desc);
create index if not exists idx_ticket_checkins_org_date on public.ticket_checkins(org_id, checked_in_at desc);
create index if not exists idx_ticket_checkins_by_date on public.ticket_checkins(checked_in_by, checked_in_at desc);

-- 4. RLS
alter table public.ticket_checkins enable row level security;

drop policy if exists "Org members can view check-ins" on public.ticket_checkins;
create policy "Org members can view check-ins"
    on public.ticket_checkins
    for select
    using (
        public.is_org_member(org_id)
    );

comment on table public.ticket_checkins is 'Audit trail for ticket check-ins. Immutable.';
