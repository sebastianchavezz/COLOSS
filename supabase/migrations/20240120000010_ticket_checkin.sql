-- Ticket Check-in Support
--
-- 1. Add token_hash for secure check-in
-- 2. Make qr_code nullable (stores preview or legacy)
-- 3. Add index for fast lookup

alter table public.ticket_instances
add column if not exists token_hash text unique;

alter table public.ticket_instances
alter column qr_code drop not null;

create index if not exists idx_ticket_instances_token_hash on public.ticket_instances(token_hash);

-- Ensure status enum has checked_in (it should, but just in case)
-- alter type ticket_instance_status add value if not exists 'checked_in'; 
-- (Postgres doesn't support IF NOT EXISTS for enum values easily, assuming it exists from previous schema check)
