-- PAYMENT WEBHOOK LOGIC & SCHEMA FIX
--
-- Doel: Link tickets aan orders en implementeer de payment webhook logica.
-- Context: Mollie integratie.

-- 1. SCHEMA UPDATE: Link Tickets -> Orders
-- We voegen order_id toe aan tickets zodat we weten welke tickets bij welke order horen.
alter table public.tickets 
  add column if not exists order_id uuid references public.orders(id) on delete restrict;

create index if not exists idx_tickets_order_id on public.tickets(order_id);


-- 2. RPC: Handle Payment Webhook (Atomic Transaction)
create or replace function public.handle_payment_webhook(
  _order_id uuid,
  _payment_id text,
  _status text, -- 'paid', 'open', 'failed', etc.
  _amount numeric,
  _currency text
)
returns void
language plpgsql
security definer -- Draait als superuser om RLS te bypassen en alles te updaten
set search_path = public
as $$
declare
  v_current_order_status order_status;
begin
  -- 1. Update Payments tabel
  -- We zoeken de payment op provider_payment_id OF maken een nieuwe als die nog niet bestaat (upsert)
  -- Maar in onze flow maakt create-mollie-payment hem al aan.
  update public.payments
  set 
    status = _status::payment_status,
    updated_at = now()
  where provider = 'mollie' and provider_payment_id = _payment_id;
  
  -- Als er geen row geupdate is (edge case), insert hem dan alsnog?
  -- Voor nu gaan we ervan uit dat hij bestaat.

  -- 2. Bepaal Order Status
  -- Mapping Mollie status -> Order status
  -- 'paid' -> 'paid'
  -- 'expired', 'canceled', 'failed' -> 'failed' / 'cancelled'
  -- 'open', 'pending' -> 'pending'
  
  if _status = 'paid' then
    update public.orders
    set status = 'paid', updated_at = now()
    where id = _order_id;
    
    -- 3. Update Tickets & Registrations (ALLEEN als paid)
    
    -- Zet tickets op 'valid'
    update public.tickets
    set status = 'valid', updated_at = now()
    where order_id = _order_id;
    
    -- Zet gekoppelde registrations op 'confirmed'
    -- We joinen via de tickets die bij deze order horen
    update public.registrations
    set status = 'confirmed', updated_at = now()
    where id in (
      select registration_id 
      from public.tickets 
      where order_id = _order_id
    );
    
  elsif _status in ('expired', 'canceled', 'failed') then
    update public.orders
    set status = 'failed', updated_at = now() -- Of 'cancelled' afh van mapping
    where id = _order_id;
    
    -- Optioneel: Tickets/Registrations ook cancellen?
    -- Vaak wel, om capaciteit vrij te geven.
    update public.tickets
    set status = 'cancelled', updated_at = now()
    where order_id = _order_id;
    
    update public.registrations
    set status = 'cancelled', updated_at = now()
    where id in (
      select registration_id 
      from public.tickets 
      where order_id = _order_id
    );
  end if;

end;
$$;
