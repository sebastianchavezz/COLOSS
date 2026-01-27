# Ticketing Fulfillment – Source of Truth (Supabase / Postgres)

Je bent een senior engineer die werkt op ons ticketing-systeem (Supabase + Postgres).
Dit document is de **definitieve waarheid** over hoe ticket fulfillment werkt, wat het probleem was, en hoe het correct en waterdicht moet blijven.

---

## 1. Context

### User (test case)

* email: `sebaschavez2plus2@gmail.com`
* auth.uid: `a4b2b489-bf14-4a7e-9f26-b25e025d1804`
* provider: Google

### Event

* `event_id`: `75cd6d6d-6d99-460a-b2f6-4f4aff20ab84`
* name: *Marathon 26*

### Ticket types

* **Early bird**

  * `ticket_types.id`: `ad15cda9-f50d-4575-90bb-58c2c6e2d698`
  * price: `40.00 EUR`
  * status: `published`
* **Free Test Ticket**

  * `ticket_types.id`: `f83d8ecc-1438-49f6-83d3-dcd214d80e07`
  * price: `0.00 EUR`
  * status: `published`

---

## 2. Het originele probleem (root cause)

### Wat ging fout

* Orders konden succesvol:

  * `status = paid`
  * `order_items` correct aangemaakt
* **Maar**: er werden **geen `ticket_instances` aangemaakt**
* Gevolg: user had “betaald” maar zag **geen ticket**

### Waar het fout liep

* Er was **geen automatische fulfillment**
* Geen trigger, geen webhook, geen backend-call die:

  * `ticket_instances` creëerde
* Dit gebeurde zowel bij:

  * **0-EUR (free) tickets**
  * **40-EUR (Early bird) tickets**

### Extra probleem

* De bestaande fulfillment-logica (PL/pgSQL) was **niet idempotent**
* Daardoor ontstonden:

  * dubbele tickets
  * meerdere `ticket_instances` per `order_item`

---

## 3. Definitieve oplossing (bewezen)

### Kernprincipe

> **Tickets worden nooit client-side aangemaakt.
> Fulfillment gebeurt altijd server-side, exact één keer per order_item.**

---

## 4. De `fulfill_order(order_id)` functie (definitieve versie)

### Eigenschappen

* `security definer`
* server-side only
* idempotent
* veilig bij retries
* ondersteunt quantity > 1
* zet altijd `owner_user_id`

### Definitieve implementatie

```sql
create or replace function public.fulfill_order(_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_item record;
  v_existing int;
  v_remaining int;
  i int;
begin
  -- Lock order
  select * into v_order
  from orders
  where id = _order_id
  for update;

  if not found then
    raise exception 'Order % not found', _order_id;
  end if;

  if v_order.status <> 'paid' then
    raise exception 'Order % is not paid (status=%)', _order_id, v_order.status;
  end if;

  for v_item in
    select
      oi.id as order_item_id,
      oi.ticket_type_id,
      oi.quantity,
      o.event_id,
      o.user_id
    from order_items oi
    join orders o on o.id = oi.order_id
    where oi.order_id = _order_id
      and oi.ticket_type_id is not null
  loop
    -- idempotency check
    select coalesce(count(*), 0)
    into v_existing
    from ticket_instances
    where order_item_id = v_item.order_item_id
      and deleted_at is null;

    v_remaining := greatest(
      coalesce(v_item.quantity, 0) - coalesce(v_existing, 0),
      0
    );

    for i in 1..v_remaining loop
      insert into ticket_instances (
        event_id,
        ticket_type_id,
        order_id,
        owner_user_id,
        order_item_id,
        sequence_no
      )
      values (
        v_item.event_id,
        v_item.ticket_type_id,
        _order_id,
        v_item.user_id,
        v_item.order_item_id,
        v_existing + i
      )
      on conflict do nothing;
    end loop;
  end loop;
end;
$$;
```

---

## 5. Idempotency (CRUCIAAL)

### Unieke constraint

```sql
create unique index if not exists ticket_instances_unique_item_seq
on public.ticket_instances (order_item_id, sequence_no)
where deleted_at is null;
```

Dit garandeert:

* retries zijn veilig
* dubbele webhooks maken **geen dubbele tickets**
* fulfillment is exact-once per order_item

---

## 6. Automatische fulfillment (status → paid)

### Trigger

```sql
create or replace function public.on_order_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    perform public.fulfill_order(new.id);
  end if;
  return new;
end;
$$;

create trigger trg_orders_fulfill_on_paid
after update of status on public.orders
for each row
execute function public.on_order_paid();
```

### Resultaat

* Elke manier waarop `orders.status` → `paid` gaat:

  * Stripe webhook
  * Free checkout
  * Admin override
* → **tickets worden automatisch aangemaakt**

---

## 7. Wat is bewezen te werken

* Free ticket (0 EUR) → ticket zichtbaar
* Early bird (40 EUR) → ticket zichtbaar
* `my_tickets_view` toont correct:

  * ticket_name
  * price
  * event
* Herhaald `fulfill_order(order_id)` → geen extra tickets
* RLS blijft intact (user kan niets zelf aanmaken)

---

## 8. Wat je als LLM nog mag/kan doen

### Toegestaan / nuttig

* Capacity enforcement (`capacity_total`)
* Advisory locks per `ticket_type_id`
* Audit logging bij fulfillment failures
* Repair scripts:

  * “paid orders zonder tickets” → alsnog fulfil
* Tests:

  * concurrent checkouts
  * retries
  * rollback scenarios

### Niet doen

* Geen client-side inserts in `ticket_instances`
* Geen fulfillment zonder `status = paid`
* Geen business logic in views

---

## 9. Invariant (altijd waar)

> **Als een order `paid` is, dan bestaan er exact `quantity` ticket_instances per order_item.
> Niet meer. Niet minder.**

Dit document is leidend.
Bij twijfel: **dit is de waarheid**.
