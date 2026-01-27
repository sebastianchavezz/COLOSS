-- Drop existing function first to handle signature changes
drop function if exists public.fulfill_order(uuid);

create or replace function public.fulfill_order(_order_id uuid)
returns table (ticket_instance_id uuid, order_item_id uuid, ticket_type_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
begin
  -- Lock order row (avoid concurrent double-fulfillment)
  select *
    into v_order
  from public.orders
  where id = _order_id
  for update;

  if not found then
    raise exception 'Order % not found', _order_id;
  end if;

  if v_order.status <> 'paid' then
    raise exception 'Order % is not paid (status=%)', _order_id, v_order.status;
  end if;

  /*
    Idempotency strategy:
    - For each order_item: we count existing ticket_instances linked to that order_item_id
    - If less than quantity, we insert the remaining number
  */
  return query
  with oi as (
    select
      i.id as order_item_id,
      i.ticket_type_id,
      i.quantity,
      o.id as order_id,
      o.event_id,
      o.user_id as owner_user_id
    from public.order_items i
    join public.orders o on o.id = i.order_id
    where i.order_id = _order_id
      and i.ticket_type_id is not null
  ),
  checks as (
    select
      oi.*,
      tt.status as ticket_type_status,
      tt.deleted_at as ticket_type_deleted_at,
      tt.sales_start,
      tt.sales_end,
      tt.capacity_total,
      -- current issued count for capacity (ignores deleted)
      (select count(*) from public.ticket_instances ti
        where ti.ticket_type_id = oi.ticket_type_id
          and ti.deleted_at is null
      ) as currently_issued,
      -- existing count for this order_item (idempotency)
      (select count(*) from public.ticket_instances ti
        where ti.order_item_id = oi.order_item_id
          and ti.deleted_at is null
      ) as already_for_item
    from oi
    join public.ticket_types tt on tt.id = oi.ticket_type_id
  ),
  validated as (
    select *
    from checks
    where ticket_type_deleted_at is null
      and ticket_type_status = 'published'
      -- We skip sales window check for fulfillment because the order was already created validly
      -- and we must honor paid orders even if window closed in the meantime.
  ),
  to_insert as (
    select
      v.*,
      greatest(v.quantity - v.already_for_item, 0) as remaining
    from validated v
  ),
  enforce as (
    select *
    from to_insert
  )
  select
    ti.id as ticket_instance_id,
    ti.order_item_id,
    ti.ticket_type_id
  from enforce e
  join lateral (
    select *
    from generate_series(1, e.remaining)
  ) gs(n) on true
  join lateral (
    insert into public.ticket_instances (
        event_id, 
        ticket_type_id, 
        order_id, 
        owner_user_id, 
        order_item_id,
        status,
        qr_code
    )
    values (
        e.event_id, 
        e.ticket_type_id, 
        e.order_id, 
        e.owner_user_id, 
        e.order_item_id,
        'valid', -- Default to valid upon fulfillment
        encode(gen_random_bytes(16), 'hex') -- Generate a random QR code
    )
    returning *
  ) ti on true;

end;
$$;

revoke all on function public.fulfill_order(uuid) from public;
grant execute on function public.fulfill_order(uuid) to service_role;
