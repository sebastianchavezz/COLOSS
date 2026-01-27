-- LAYER 5+ EXTENSION: PAYMENTS & WEBHOOKS
-- Provider-backed payments (Mollie) met exactly-once webhook processing
-- IDEMPOTENT REWRITE

-- =====================================================
-- 1. PAYMENTS TABLE
-- =====================================================
create table if not exists public.payments (
    id uuid not null default gen_random_uuid(),
    constraint payments_pkey primary key (id)
);

-- Add columns idempotently
alter table public.payments add column if not exists org_id uuid not null;
alter table public.payments add column if not exists order_id uuid not null;
alter table public.payments add column if not exists provider text not null;
alter table public.payments add column if not exists provider_payment_id text not null;
alter table public.payments add column if not exists status text not null;
alter table public.payments add column if not exists amount integer not null;
alter table public.payments add column if not exists currency text not null default 'EUR';
alter table public.payments add column if not exists created_at timestamptz not null default now();
alter table public.payments add column if not exists updated_at timestamptz not null default now();
alter table public.payments add column if not exists deleted_at timestamptz;

-- Add constraints safely
do $$
begin
    -- Foreign Keys
    if not exists (select 1 from pg_constraint where conname = 'payments_org_id_fkey') then
        alter table public.payments add constraint payments_org_id_fkey 
        foreign key (org_id) references public.orgs(id) on delete restrict;
    end if;

    if not exists (select 1 from pg_constraint where conname = 'payments_order_id_fkey') then
        alter table public.payments add constraint payments_order_id_fkey 
        foreign key (order_id) references public.orders(id) on delete restrict;
    end if;

    -- Unique Constraint
    if not exists (select 1 from pg_constraint where conname = 'payments_provider_payment_unique') then
        alter table public.payments add constraint payments_provider_payment_unique 
        unique (provider, provider_payment_id);
    end if;

    -- Check Constraints
    -- provider check (cast to text to handle potential enum type mismatch)
    if not exists (select 1 from pg_constraint where conname = 'payments_provider_check') then
        alter table public.payments add constraint payments_provider_check 
        check (provider::text in ('mollie'));
    end if;

    -- status check (cast to text to handle potential enum type mismatch)
    if not exists (select 1 from pg_constraint where conname = 'payments_status_check') then
        alter table public.payments add constraint payments_status_check 
        check (status::text in ('created','open','pending','paid','failed','cancelled','expired','refunded'));
    end if;

    -- amount check
    if not exists (select 1 from pg_constraint where conname = 'payments_amount_check') then
        alter table public.payments add constraint payments_amount_check 
        check (amount >= 0);
    end if;

exception when duplicate_object then
    null;
end $$;

-- Indexes
create index if not exists idx_payments_org_id on public.payments(org_id);
create index if not exists idx_payments_order_id on public.payments(order_id);
create index if not exists idx_payments_org_created on public.payments(org_id, created_at desc);
create index if not exists idx_payments_status on public.payments(status) where deleted_at is null;

comment on table public.payments is 
  'Payment records linked to provider (Mollie). One payment per order attempt.';

-- =====================================================
-- 2. PAYMENT_EVENTS TABLE (Idempotency Gate)
-- =====================================================
create table if not exists public.payment_events (
    id uuid not null default gen_random_uuid(),
    constraint payment_events_pkey primary key (id)
);

-- Add columns idempotently
alter table public.payment_events add column if not exists provider text not null;
alter table public.payment_events add column if not exists provider_event_id text not null;
alter table public.payment_events add column if not exists provider_payment_id text null;
alter table public.payment_events add column if not exists event_type text;
alter table public.payment_events add column if not exists payload jsonb not null;
alter table public.payment_events add column if not exists received_at timestamptz not null default now();
alter table public.payment_events add column if not exists processed_at timestamptz null;

-- Add constraints safely
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'payment_events_unique_event') then
        alter table public.payment_events add constraint payment_events_unique_event 
        unique (provider, provider_event_id);
    end if;
exception when duplicate_object then
    null;
end $$;

-- Indexes
create index if not exists idx_payment_events_processed on public.payment_events(processed_at);
create index if not exists idx_payment_events_provider_payment on public.payment_events(provider_payment_id);

comment on table public.payment_events is 
  'Append-only log of webhook events. Unique constraint enforces exactly-once processing.';

-- =====================================================
-- 3. UPDATED_AT TRIGGER
-- =====================================================
drop trigger if exists handle_updated_at_payments on public.payments;
create trigger handle_updated_at_payments before update on public.payments
  for each row execute procedure extensions.moddatetime (updated_at);

-- =====================================================
-- 4. RLS POLICIES
-- =====================================================
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;

-- Drop existing policies to recreate them (idempotent)
drop policy if exists "Users can view own payments" on public.payments;
drop policy if exists "Org members can view org payments" on public.payments;

-- PAYMENTS POLICIES
create policy "Users can view own payments"
    on public.payments
    for select
    using (
        exists (
            select 1 from public.orders o
            where o.id = payments.order_id
            and o.user_id = auth.uid()
        )
    );

create policy "Org members can view org payments"
    on public.payments
    for select
    using (public.is_org_member(org_id));

comment on policy "Users can view own payments" on public.payments is 
  'Users can see payments for their own orders';
comment on policy "Org members can view org payments" on public.payments is 
  'Org members can see all payments for their org (finance/support role)';
