-- TICKETS MODULE: Schema improvements
-- 
-- Voegt ontbrekende velden toe aan ticket_types:
-- - status (draft/published/closed) voor zichtbaarheid in frontend
-- - sort_order voor volgorde in UI
-- - currency (nu expliciet per ticket, niet alleen uit event_settings)

-- Voeg status veld toe
do $$ 
begin
    -- Check of de kolom al bestaat
    if not exists (
        select 1 from information_schema.columns 
        where table_schema = 'public' 
        and table_name = 'ticket_types' 
        and column_name = 'status'
    ) then
        -- Voeg status toe als text met check constraint
        alter table public.ticket_types 
            add column status text not null default 'draft';
        
        -- Voeg check constraint toe
        alter table public.ticket_types
            add constraint ticket_types_status_check 
            check (status in ('draft', 'published', 'closed'));
        
        -- Comment
        comment on column public.ticket_types.status is 
            'Ticket visibility: draft=alleen admins, published=zichtbaar voor kopers, closed=niet meer verkrijgbaar';
    end if;
end $$;

-- Voeg sort_order veld toe
do $$ 
begin
    if not exists (
        select 1 from information_schema.columns 
        where table_schema = 'public' 
        and table_name = 'ticket_types' 
        and column_name = 'sort_order'
    ) then
        alter table public.ticket_types 
            add column sort_order integer not null default 0;
        
        comment on column public.ticket_types.sort_order is 
            'Volgorde in UI, lager = hoger in lijst';
    end if;
end $$;

-- Voeg currency veld toe (override van event default)
do $$ 
begin
    if not exists (
        select 1 from information_schema.columns 
        where table_schema = 'public' 
        and table_name = 'ticket_types' 
        and column_name = 'currency'
    ) then
        alter table public.ticket_types 
            add column currency text not null default 'EUR';
        
        comment on column public.ticket_types.currency is 
            'Valuta voor dit ticket (default EUR)';
    end if;
end $$;

-- Indexes voor performance
create index if not exists idx_ticket_types_event_sort 
    on public.ticket_types(event_id, sort_order);

create index if not exists idx_ticket_types_event_status 
    on public.ticket_types(event_id, status);

-- Partial unique index: naam uniek per event voor niet-verwijderde tickets
create unique index if not exists idx_ticket_types_event_name_active
    on public.ticket_types(event_id, name)
    where deleted_at is null;

comment on index idx_ticket_types_event_sort is 
    'Optimizeert gesorteerde lijst queries per event';
comment on index idx_ticket_types_event_status is 
    'Optimizeert filtering op status per event';
comment on index idx_ticket_types_event_name_active is 
    'Voorkomt duplicate ticket namen binnen een event';
