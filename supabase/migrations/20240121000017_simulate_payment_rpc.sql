-- TEST UTILITY: SIMULATE PAYMENT (SECURED)
-- Context: Testing payment flow without real Mollie integration.
-- Security: REVOKE all permissions. Only callable by SERVICE_ROLE (via Edge Function).

create or replace function public.simulate_payment_success(_order_id uuid)
returns void
language plpgsql
security definer -- Bypass RLS to update order/tickets
set search_path = public
as $$
declare
  v_order record;
  v_payment_id text := 'sim_' || gen_random_uuid();
begin
  -- 1. Fetch Order Details
  select * into v_order from public.orders where id = _order_id;
  
  if not found then
    raise exception 'Order not found';
  end if;

  -- 2. Create Fake Payment (Open)
  insert into public.payments (
    org_id, 
    order_id, 
    provider, 
    provider_payment_id, 
    amount, 
    currency, 
    status
  ) values (
    (select org_id from public.events where id = v_order.event_id),
    _order_id,
    'mollie',
    v_payment_id,
    v_order.total_amount,
    v_order.currency,
    'open'
  );

  -- 3. Call Webhook Handler to transition state
  perform public.handle_payment_webhook(
    _order_id,
    v_payment_id,
    'paid',
    v_order.total_amount,
    v_order.currency
  );

end;
$$;

-- SECURITY HARDENING
-- Revoke execution from everyone by default
revoke execute on function public.simulate_payment_success(uuid) from public;
revoke execute on function public.simulate_payment_success(uuid) from anon;
revoke execute on function public.simulate_payment_success(uuid) from authenticated;

-- Only service_role (postgres/superuser) can execute
-- (No explicit grant needed for superuser/owner, but ensuring no one else has it)
