-- SPRINT: MOLLIE PAYMENTS
-- Context: Backend-driven payment flow.
-- Goal: Ensure payments/payment_events tables and handle_payment_webhook RPC are correct.

-- 1. Ensure Payment Events Table (Idempotency)
create table if not exists public.payment_events (
    id uuid not null default gen_random_uuid(),
    provider text not null,
    provider_event_id text not null,
    provider_payment_id text,
    event_type text,
    payload jsonb not null,
    processed_at timestamptz,
    created_at timestamptz not null default now(),
    
    constraint payment_events_pkey primary key (id),
    constraint payment_events_unique_event unique (provider, provider_event_id)
);

alter table public.payment_events enable row level security;

-- 2. RPC: Handle Payment Webhook (Improved)
-- Drop existing function first to handle return type changes
drop function if exists public.handle_payment_webhook(uuid, text, text, numeric, text);

create or replace function public.handle_payment_webhook(
  _order_id uuid,
  _payment_id text,
  _status text, -- 'paid', 'open', 'failed', etc.
  _amount numeric,
  _currency text
)
returns boolean -- Returns true if order became paid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_status order_status;
  v_is_paid boolean := false;
begin
  -- 1. Update Payments table
  update public.payments
  set 
    status = _status::payment_status,
    updated_at = now()
  where provider = 'mollie' and provider_payment_id = _payment_id;
  
  -- 2. Handle Status Transitions
  if _status = 'paid' then
    -- Check current status to avoid double processing (though idempotent update is safe)
    select status into v_order_status from public.orders where id = _order_id;
    
    if v_order_status != 'paid' then
        -- Update Order
        update public.orders
        set status = 'paid', updated_at = now()
        where id = _order_id;
        
        -- Update Tickets (pending -> valid)
        update public.tickets
        set status = 'valid', updated_at = now()
        where order_id = _order_id;
        
        -- Update Registrations (pending -> confirmed)
        update public.registrations
        set status = 'confirmed', updated_at = now()
        where id in (
          select registration_id from public.tickets where order_id = _order_id
        );
        
        v_is_paid := true;
    end if;
    
  elsif _status in ('expired', 'canceled', 'failed') then
    -- Update Order
    update public.orders
    set status = 'failed', updated_at = now()
    where id = _order_id;
    
    -- Update Tickets (pending -> cancelled)
    update public.tickets
    set status = 'cancelled', updated_at = now()
    where order_id = _order_id;
    
    -- Update Registrations
    update public.registrations
    set status = 'cancelled', updated_at = now()
    where id in (
      select registration_id from public.tickets where order_id = _order_id
    );
  end if;

  return v_is_paid;
end;
$$;
