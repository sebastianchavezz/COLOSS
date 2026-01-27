-- TICKET IDEMPOTENCY
-- Voorkomt dubbele ticket issuance bij webhook replay
-- IDEMPOTENT REWRITE

-- Voeg kolommen toe voor deterministische ticket creatie
alter table public.ticket_instances
add column if not exists order_item_id uuid references public.order_items(id),
add column if not exists sequence_no integer,
add column if not exists deleted_at timestamptz; -- Added for soft delete support

-- Unique constraint: prevent duplicates per order item
create unique index if not exists idx_ticket_instances_idempotency 
on public.ticket_instances(order_item_id, sequence_no) 
where deleted_at is null;

comment on column public.ticket_instances.order_item_id is 
  'Links ticket to specific order item for idempotency';
comment on column public.ticket_instances.sequence_no is 
  'Sequence number (1 to quantity) for deterministic creation';
