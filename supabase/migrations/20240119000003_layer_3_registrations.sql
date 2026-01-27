-- LAAG 3: PARTICIPANTS & REGISTRATIONS
--
-- Doel: Wie doet er mee? (Los van betaling)
-- Afhankelijkheid: Laag 2 (Events)

-- 1. ENUMS
create type registration_status as enum ('pending', 'confirmed', 'waitlist', 'cancelled');

-- 2. TABELLEN

-- Participants: Profielen van deelnemers
-- Kan gekoppeld zijn aan een Auth User, of een 'guest' zijn (bv. bij groepsinschrijving)
create table public.participants (
    id uuid not null default gen_random_uuid(),
    user_id uuid, -- Optioneel: link naar auth.users
    email text not null,
    first_name text not null,
    last_name text not null,
    
    -- Metadata
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    
    constraint participants_pkey primary key (id),
    constraint participants_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null
);

-- Registrations: De koppeling tussen Participant en Event
create table public.registrations (
    id uuid not null default gen_random_uuid(),
    event_id uuid not null,
    participant_id uuid not null,
    status registration_status not null default 'pending',
    
    -- Metadata
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    
    constraint registrations_pkey primary key (id),
    constraint registrations_event_id_fkey foreign key (event_id) references public.events(id) on delete cascade,
    constraint registrations_participant_id_fkey foreign key (participant_id) references public.participants(id) on delete restrict,
    
    -- Een deelnemer mag zich maar 1x inschrijven voor een event (tenzij cancelled?)
    -- Voor nu strikt: uniek paar.
    constraint registrations_event_participant_unique unique (event_id, participant_id)
);

-- Registration Answers: Antwoorden op dynamische vragen (JSONB zou ook kunnen, maar dit is strikter)
create table public.registration_answers (
    id uuid not null default gen_random_uuid(),
    registration_id uuid not null,
    question_key text not null, -- bv. 'tshirt_size', 'emergency_contact'
    answer_value text not null,
    
    created_at timestamptz not null default now(),
    
    constraint registration_answers_pkey primary key (id),
    constraint registration_answers_registration_id_fkey foreign key (registration_id) references public.registrations(id) on delete cascade
);

-- Indexes
create index idx_participants_user_id on public.participants(user_id);
create index idx_participants_email on public.participants(email);
create index idx_registrations_event_id on public.registrations(event_id);
create index idx_registrations_participant_id on public.registrations(participant_id);
create index idx_registration_answers_registration_id on public.registration_answers(registration_id);

-- 3. RLS POLICIES
alter table public.participants enable row level security;
alter table public.registrations enable row level security;
alter table public.registration_answers enable row level security;

-- PARTICIPANTS POLICIES

-- Users mogen hun eigen profiel zien
create policy "Users can view own participant profile"
    on public.participants
    for select
    using ( user_id = auth.uid() );

-- Users mogen hun eigen profiel updaten
create policy "Users can update own participant profile"
    on public.participants
    for update
    using ( user_id = auth.uid() );

-- Org members mogen participants zien die geregistreerd zijn voor hun events
create policy "Org members can view participants of their events"
    on public.participants
    for select
    using (
        exists (
            select 1 from public.registrations r
            join public.events e on r.event_id = e.id
            where r.participant_id = participants.id
            and public.is_org_member(e.org_id)
        )
    );

-- Iedereen mag een participant aanmaken (tijdens checkout flow)
create policy "Public can create participants"
    on public.participants
    for insert
    with check (true);

-- REGISTRATIONS POLICIES

-- Users mogen hun eigen registraties zien (via participant link)
create policy "Users can view own registrations"
    on public.registrations
    for select
    using (
        exists (
            select 1 from public.participants p
            where p.id = registrations.participant_id
            and p.user_id = auth.uid()
        )
    );

-- Org members mogen alle registraties voor hun events zien
create policy "Org members can view event registrations"
    on public.registrations
    for select
    using (
        exists (
            select 1 from public.events e
            where e.id = registrations.event_id
            and public.is_org_member(e.org_id)
        )
    );

-- Iedereen mag een registratie aanmaken (tijdens checkout)
-- Let op: status transities moeten via server-side functies of triggers beveiligd worden
create policy "Public can create registrations"
    on public.registrations
    for insert
    with check (true);

-- REGISTRATION ANSWERS POLICIES

-- Users mogen hun eigen antwoorden zien
create policy "Users can view own answers"
    on public.registration_answers
    for select
    using (
        exists (
            select 1 from public.registrations r
            join public.participants p on r.participant_id = p.id
            where r.id = registration_answers.registration_id
            and p.user_id = auth.uid()
        )
    );

-- Org members mogen antwoorden zien
create policy "Org members can view answers"
    on public.registration_answers
    for select
    using (
        exists (
            select 1 from public.registrations r
            join public.events e on r.event_id = e.id
            where r.id = registration_answers.registration_id
            and public.is_org_member(e.org_id)
        )
    );

-- Iedereen mag antwoorden aanmaken (tijdens checkout)
create policy "Public can create answers"
    on public.registration_answers
    for insert
    with check (true);

-- 4. TRIGGERS
create trigger handle_updated_at_participants before update on public.participants
  for each row execute procedure extensions.moddatetime (updated_at);

create trigger handle_updated_at_registrations before update on public.registrations
  for each row execute procedure extensions.moddatetime (updated_at);
