-- EVENTS MODULE: Schema improvements
-- 
-- Dit verbetert het events schema met:
-- 1. Partial unique index op (org_id, slug) waar deleted_at is null
--    Dit zorgt dat soft-deleted events niet conflicteren met nieuwe events
-- 2. Composite index op (org_id, starts_at) voor efficiënte lijst queries

-- Drop de bestaande unique constraint en maak een partial unique index
-- Dit is veiliger: soft-deleted events blokkeren geen nieuwe slugs
alter table public.events drop constraint if exists events_org_slug_key;

-- Partial unique index: slug moet uniek zijn per org, maar alleen voor niet-verwijderde events
create unique index if not exists idx_events_org_slug_active 
    on public.events(org_id, slug) 
    where deleted_at is null;

-- Composite index voor lijst queries (events per org gesorteerd op datum)
create index if not exists idx_events_org_starts_at 
    on public.events(org_id, start_time);

-- Verifieer dat updated_at trigger bestaat (al aangemaakt in layer_2, maar voor de zekerheid)
-- Geen actie nodig als deze al bestaat

comment on index idx_events_org_slug_active is 
    'Unieke slug per org voor actieve (niet soft-deleted) events';
comment on index idx_events_org_starts_at is 
    'Optimizeert queries voor event lijsten per org gesorteerd op datum';
