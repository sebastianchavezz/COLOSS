-- RPC FUNCTION: handle_payment_webhook
-- Transactionele verwerking van Mollie webhook
-- Called from mollie-webhook Edge Function

create or replace function public.handle_payment_webhook(
    _order_id uuid,
    _payment_id text,
    _status text,
    _amount text,
    _currency text
) returns jsonb
language plpgsql
security definer -- Runs with function owner privileges
as $$
declare
    _org_id uuid;
    _old_order_status text;
    _new_order_status text;
    _payment_db_id uuid;
    _tickets_issued integer := 0;
begin
    -- 1. Get order org_id and current status
    select org_id, status into _org_id, _old_order_status
    from public.orders
    where id = _order_id
    and deleted_at is null;

    if not found then
        raise exception 'Order not found: %', _order_id;
    end if;

    -- 2. Upsert payment record
    insert into public.payments (
        org_id,
        order_id,
        provider,
        provider_payment_id,
        status,
        amount,
        currency
    ) values (
        _org_id,
        _order_id,
        'mollie',
        _payment_id,
        _status,
        ((_amount::numeric * 100)::integer), -- Convert "10.00" -> 1000 cents
        _currency
    )
    on conflict (provider, provider_payment_id) 
    do update set
        status = excluded.status,
        updated_at = now()
    returning id into _payment_db_id;

    -- 3. Determine new order status based on payment status
    _new_order_status := case
        when _status = 'paid' then 'paid'
        when _status in ('failed', 'cancelled', 'expired') then 'failed'
        else _old_order_status -- Keep current status for intermediate states
    end;

    -- 4. Update order status (only if changed)
    if _new_order_status != _old_order_status then
        update public.orders
        set status = _new_order_status,
        updated_at = now()
        where id = _order_id;

        -- Log audit entry
        insert into public.audit_log (
            org_id,
            actor_user_id,
            action,
            entity_type,
            entity_id,
            before_state,
            after_state,
            metadata
        ) values (
            _org_id,
            null, -- System action
            'ORDER_STATUS_CHANGED',
            'order',
            _order_id,
            jsonb_build_object('status', _old_order_status),
            jsonb_build_object('status', _new_order_status),
            jsonb_build_object('payment_id', _payment_id, 'trigger', 'webhook')
        );
    end if;

    -- 5. Issue tickets if payment is paid and order newly transitioned to paid
    if _status = 'paid' and _old_order_status != 'paid' then
        -- This will be handled by calling issue-tickets Edge function
        -- We set a flag here for the Edge Function to act on
        _tickets_issued := -1; -- Marker: tickets should be issued by edge function
    end if;

    return jsonb_build_object(
        'success', true,
        'order_id', _order_id,
        'old_status', _old_order_status,
        'new_status', _new_order_status,
        'payment_id', _payment_db_id,
        'issue_tickets', (_tickets_issued = -1)
    );
end;
$$;

comment on function public.handle_payment_webhook(uuid, text, text, text, text) is 
  'Transactional webhook processing: updates payment + order status. Called by mollie-webhook function.';
