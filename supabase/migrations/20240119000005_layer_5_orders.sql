-- LAAG 5: ORDERS & BETALINGEN
--
-- Doel: Geldstromen veilig verwerken.
-- Afhankelijkheid: Laag 4 (Tickets)

-- 1. ENUMS
create type order_status as enum ('pending', 'paid', 'failed', 'cancelled', 'refunded');
create type payment_status as enum ('pending', 'paid', 'failed', 'cancelled', 'refunded');

-- 2. TABELLEN

-- Orders: De 'cart' of transactie
create table public.orders (
    id uuid not null default gen_random_uuid(),
    event_id uuid not null,
    user_id uuid, -- Optioneel: als ingelogd
    email text not null, -- Altijd nodig voor gasten
    
    status order_status not null default 'pending',
    total_amount numeric(10,2) not null default 0.00,
    currency text not null default 'EUR',
    
    -- Idempotency & Provider refs
    checkout_session_id text, -- bv. Stripe Session ID
    idempotency_key text, -- Om dubbele orders te voorkomen
    
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    
    constraint orders_pkey primary key (id),
    constraint orders_event_id_fkey foreign key (event_id) references public.events(id) on delete restrict,
    constraint orders_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null
);

-- Order Items: Wat zit er in de order?
create table public.order_items (
    id uuid not null default gen_random_uuid(),
    order_id uuid not null,
    
    -- Link naar product/ticket
    ticket_type_id uuid, -- Als het een ticket is
    -- product_id uuid, -- Voor later: merchandise
    
    quantity integer not null default 1,
    unit_price numeric(10,2) not null,
    total_price numeric(10,2) not null, -- quantity * unit_price
    
    constraint order_items_pkey primary key (id),
    constraint order_items_order_id_fkey foreign key (order_id) references public.orders(id) on delete cascade,
    constraint order_items_ticket_type_id_fkey foreign key (ticket_type_id) references public.ticket_types(id)
);

-- Payments: Daadwerkelijke betalingen (kan 1-op-N zijn met orders bij deelsbetalingen, maar meestal 1-op-1)
create table public.payments (
    id uuid not null default gen_random_uuid(),
    order_id uuid not null,
    
    provider text not null, -- 'stripe', 'mollie'
    provider_payment_id text not null, -- ID bij provider
    amount numeric(10,2) not null,
    currency text not null default 'EUR',
    status payment_status not null default 'pending',
    
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    
    constraint payments_pkey primary key (id),
    constraint payments_order_id_fkey foreign key (order_id) references public.orders(id) on delete restrict,
    constraint payments_provider_unique unique (provider, provider_payment_id)
);

-- Payment Events: Raw webhook logs (Audit trail)
create table public.payment_events (
    id uuid not null default gen_random_uuid(),
    provider text not null,
    provider_event_id text, -- Uniek ID van het event bij provider
    event_type text not null, -- bv. 'payment.succeeded'
    payload jsonb not null, -- De volledige JSON body
    processed boolean not null default false,
    error_message text,
    
    created_at timestamptz not null default now(),
    
    constraint payment_events_pkey primary key (id),
    constraint payment_events_provider_unique unique (provider, provider_event_id) -- Idempotency op webhook niveau!
);

-- Indexes
create index idx_orders_event_id on public.orders(event_id);
create index idx_orders_user_id on public.orders(user_id);
create index idx_orders_email on public.orders(email);
create index idx_order_items_order_id on public.order_items(order_id);
create index idx_payments_order_id on public.payments(order_id);

-- 3. RLS POLICIES
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security; -- Alleen internal/service role

-- ORDERS POLICIES

-- Users zien eigen orders
create policy "Users can view own orders"
    on public.orders
    for select
    using (
        user_id = auth.uid() 
        or email = (select email from auth.users where id = auth.uid()) -- Fallback als email matcht
    );

-- Org members zien orders van hun events
create policy "Org members can view orders"
    on public.orders
    for select
    using (
        exists (
            select 1 from public.events e
            where e.id = orders.event_id
            and public.is_org_member(e.org_id)
        )
    );

-- Iedereen mag order aanmaken (checkout)
create policy "Public can create orders"
    on public.orders
    for insert
    with check (true);

-- ORDER ITEMS POLICIES
create policy "Users can view own order items"
    on public.order_items
    for select
    using (
        exists (
            select 1 from public.orders o
            where o.id = order_items.order_id
            and (o.user_id = auth.uid())
        )
    );

create policy "Org members can view order items"
    on public.order_items
    for select
    using (
        exists (
            select 1 from public.orders o
            join public.events e on o.event_id = e.id
            where o.id = order_items.order_id
            and public.is_org_member(e.org_id)
        )
    );

create policy "Public can create order items"
    on public.order_items
    for insert
    with check (true);

-- PAYMENTS POLICIES
-- Users zien eigen payments
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

-- Org members zien payments (Finance rol)
create policy "Org members can view payments"
    on public.payments
    for select
    using (
        exists (
            select 1 from public.orders o
            join public.events e on o.event_id = e.id
            where o.id = payments.order_id
            and public.is_org_member(e.org_id)
        )
    );

-- PAYMENT EVENTS POLICIES
-- Niemand mag dit zien behalve service role (default deny is genoeg, geen policies nodig)
-- Tenzij we admins willen laten debuggen:
create policy "Admins can view payment events"
    on public.payment_events
    for select
    using (
        -- Dit is lastig want payment_events hebben geen directe link naar org.
        -- Voor nu: alleen service role.
        false
    );

-- 4. TRIGGERS
create trigger handle_updated_at_orders before update on public.orders
  for each row execute procedure extensions.moddatetime (updated_at);

create trigger handle_updated_at_payments before update on public.payments
  for each row execute procedure extensions.moddatetime (updated_at);
