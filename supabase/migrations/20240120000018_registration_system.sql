-- SPRINT 5: REGISTRATION SYSTEM
-- Migration: 20240120000018_registration_system.sql

-- 1. ENUMS
-- Update registration_status if needed (add values idempotently)
alter type public.registration_status add value if not exists 'draft';
alter type public.registration_status add value if not exists 'pending_payment';
alter type public.registration_status add value if not exists 'transferred';

-- Create new enums
do $$ begin
    create type public.question_type as enum (
        'text', 'textarea', 'number', 'select', 'checkbox', 'date', 'file'
    );
exception when duplicate_object then null; end $$;

do $$ begin
    create type public.gender_type as enum ('M', 'F', 'X', 'O');
exception when duplicate_object then null; end $$;

-- 2. PARTICIPANTS (Update existing table)
alter table public.participants 
    add column if not exists birth_date date,
    add column if not exists gender public.gender_type,
    add column if not exists phone text,
    add column if not exists address text,
    add column if not exists city text,
    add column if not exists country text default 'NL',
    add column if not exists deleted_at timestamptz;

-- 3. REGISTRATIONS (Update existing table)
alter table public.registrations
    add column if not exists ticket_type_id uuid references public.ticket_types(id) on delete restrict,
    add column if not exists bib_number text,
    add column if not exists start_wave text,
    add column if not exists order_item_id uuid references public.order_items(id),
    add column if not exists ticket_instance_id uuid references public.ticket_instances(id),
    add column if not exists deleted_at timestamptz;

-- Update constraints for registrations
-- Drop old unique constraint if it exists (was (event_id, participant_id))
alter table public.registrations drop constraint if exists registrations_event_participant_unique;

-- Add new unique constraint (event_id, participant_id, ticket_type_id, deleted_at)
-- Note: unique nulls not distinct is PG15+. If older, use partial index.
-- Assuming PG15+ for Supabase. If not, we use a unique index.
-- Let's use a unique index with WHERE clause for safety and compatibility.
create unique index if not exists idx_registrations_unique_participant 
    on public.registrations(event_id, participant_id, ticket_type_id) 
    where deleted_at is null;

-- Indexes
create index if not exists idx_registrations_event_status on public.registrations(event_id, status);

-- 4. REGISTRATION QUESTIONS (New Table)
create table if not exists public.registration_questions (
    id uuid not null default gen_random_uuid(),
    event_id uuid not null references public.events(id) on delete cascade,
    ticket_type_id uuid references public.ticket_types(id) on delete cascade, -- Null = all tickets
    
    question_type public.question_type not null,
    label text not null,
    description text,
    options jsonb,
    
    is_required boolean not null default false,
    is_medical boolean not null default false,
    sort_order integer not null default 0,
    
    created_at timestamptz not null default now(),

    constraint registration_questions_pkey primary key (id)
);

create index if not exists idx_questions_event on public.registration_questions(event_id, sort_order);

-- 5. REGISTRATION ANSWERS (Re-create for new schema)
-- We drop the old table because the schema is fundamentally different (key vs foreign key)
drop table if exists public.registration_answers;

create table public.registration_answers (
    id uuid not null default gen_random_uuid(),
    registration_id uuid not null references public.registrations(id) on delete cascade,
    question_id uuid not null references public.registration_questions(id) on delete restrict,
    
    answer_value jsonb not null,
    
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint registration_answers_pkey primary key (id),
    constraint answers_unique_per_registration unique (registration_id, question_id)
);

create index if not exists idx_answers_registration on public.registration_answers(registration_id);

-- 6. RLS POLICIES
-- Enable RLS
alter table public.participants enable row level security;
alter table public.registrations enable row level security;
alter table public.registration_questions enable row level security;
alter table public.registration_answers enable row level security;

-- PARTICIPANTS
drop policy if exists "Users can view own participant profile" on public.participants;
drop policy if exists "Users can update own participant profile" on public.participants;
drop policy if exists "Org members can view participants of their events" on public.participants;
drop policy if exists "Public can create participants" on public.participants;
drop policy if exists "Users manage own participants" on public.participants;
drop policy if exists "Orgs view event participants" on public.participants;

create policy "Users manage own participants" on public.participants
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy "Orgs view event participants" on public.participants
    for select using (
        exists (
            select 1 from public.registrations r
            join public.events e on r.event_id = e.id
            where r.participant_id = participants.id
            and public.is_org_member(e.org_id)
        )
    );

-- REGISTRATIONS
drop policy if exists "Users can view own registrations" on public.registrations;
drop policy if exists "Org members can view event registrations" on public.registrations;
drop policy if exists "Public can create registrations" on public.registrations;
drop policy if exists "Orgs manage event registrations" on public.registrations;

create policy "Users view own registrations" on public.registrations
    for select using (
        exists (
            select 1 from public.participants p
            where p.id = registrations.participant_id
            and p.user_id = auth.uid()
        )
    );

create policy "Orgs manage event registrations" on public.registrations
    using (
        exists (
            select 1 from public.events e
            where e.id = registrations.event_id
            and public.is_org_member(e.org_id)
        )
    );

-- REGISTRATION QUESTIONS
-- Public read (for checkout), Org manage
create policy "Public can view questions" on public.registration_questions
    for select using (true);

create policy "Orgs manage questions" on public.registration_questions
    using (
        exists (
            select 1 from public.events e
            where e.id = registration_questions.event_id
            and public.is_org_member(e.org_id)
        )
    );

-- REGISTRATION ANSWERS
drop policy if exists "Users can view own answers" on public.registration_answers;
drop policy if exists "Org members can view answers" on public.registration_answers;
drop policy if exists "Public can create answers" on public.registration_answers;
drop policy if exists "Users view own answers" on public.registration_answers;
drop policy if exists "Orgs view answers with privacy" on public.registration_answers;

-- Users view own
create policy "Users view own answers" on public.registration_answers
    for select using (
        exists (
            select 1 from public.registrations r
            join public.participants p on r.participant_id = p.id
            where r.id = registration_answers.registration_id
            and p.user_id = auth.uid()
        )
    );

-- Users insert own (during checkout)
create policy "Users insert own answers" on public.registration_answers
    for insert with check (
        exists (
            select 1 from public.registrations r
            join public.participants p on r.participant_id = p.id
            where r.id = registration_answers.registration_id
            and p.user_id = auth.uid()
        )
    );

-- Orgs view with privacy
create policy "Orgs view answers with privacy" on public.registration_answers
    for select using (
        exists (
            select 1 from public.registrations r
            join public.events e on r.event_id = e.id
            join public.org_members om on om.org_id = e.org_id
            join public.registration_questions q on q.id = registration_answers.question_id
            where r.id = registration_answers.registration_id
            and om.user_id = auth.uid()
            and (
                om.role in ('owner', 'admin', 'support')
                or 
                (om.role = 'finance' and q.is_medical = false)
            )
        )
    );

-- 7. AUDIT TRIGGER
create or replace function public.audit_registration_change()
returns trigger as $$
begin
  if (tg_op = 'UPDATE' and old.status != new.status) then
    insert into public.audit_log (
      org_id,
      actor_user_id,
      action,
      entity_type,
      entity_id,
      before_state,
      after_state,
      metadata
    )
    select 
      e.org_id,
      auth.uid(),
      'REGISTRATION_STATUS_CHANGED',
      'registration',
      new.id,
      jsonb_build_object('status', old.status),
      jsonb_build_object('status', new.status),
      jsonb_build_object('event_id', new.event_id)
    from public.events e where e.id = new.event_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists audit_registration_status on public.registrations;
create trigger audit_registration_status
after update on public.registrations
for each row execute function public.audit_registration_change();

-- 8. Updated_at triggers
drop trigger if exists handle_updated_at_registration_answers on public.registration_answers;
create trigger handle_updated_at_registration_answers before update on public.registration_answers
  for each row execute procedure extensions.moddatetime (updated_at);

comment on table public.registration_questions is 'Dynamic questions configuration per event/ticket';
comment on table public.registration_answers is 'Answers to dynamic questions. Medical data protected via RLS.';
