-- LAAG 6: SELF-SERVICE & MUTATIES
--
-- Doel: Deelnemers autonomie geven en alles loggen.
-- Afhankelijkheid: Laag 5 (Orders)

-- 1. TABELLEN

-- Ticket Transfers: Veilig overdragen van tickets
create table public.ticket_transfers (
    id uuid not null default gen_random_uuid(),
    ticket_id uuid not null, -- Het ticket dat overgedragen wordt
    
    from_user_id uuid, -- Huidige eigenaar (optioneel als guest)
    from_email text not null,
    
    to_email text not null, -- De ontvanger
    to_user_id uuid, -- Als ontvanger al account heeft
    
    transfer_token text not null, -- Veilige token voor in de mail
    status text not null default 'pending', -- 'pending', 'accepted', 'cancelled', 'expired'
    expires_at timestamptz not null,
    
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    
    constraint ticket_transfers_pkey primary key (id),
    constraint ticket_transfers_ticket_id_fkey foreign key (ticket_id) references public.tickets(id) on delete cascade
);

-- Audit Log: Append-only log van belangrijke acties
create table public.audit_log (
    id uuid not null default gen_random_uuid(),
    org_id uuid, -- Optioneel, als actie org-specifiek is
    event_id uuid, -- Optioneel
    user_id uuid, -- Wie deed het? (auth.uid)
    
    action text not null, -- bv. 'ticket.transfer', 'order.refund'
    resource_type text not null, -- bv. 'ticket', 'order'
    resource_id uuid not null,
    
    details jsonb, -- Wat is er veranderd? (diff)
    ip_address text,
    user_agent text,
    
    created_at timestamptz not null default now(),
    
    constraint audit_log_pkey primary key (id)
);

-- Indexes
create index idx_ticket_transfers_token on public.ticket_transfers(transfer_token);
create index idx_ticket_transfers_to_email on public.ticket_transfers(to_email);
create index idx_audit_log_resource on public.audit_log(resource_type, resource_id);
create index idx_audit_log_org_id on public.audit_log(org_id);

-- 2. RLS POLICIES
alter table public.ticket_transfers enable row level security;
alter table public.audit_log enable row level security;

-- TICKET TRANSFERS POLICIES

-- Sender mag zijn transfers zien
create policy "Senders can view own transfers"
    on public.ticket_transfers
    for select
    using (
        from_user_id = auth.uid()
        or from_email = (select email from auth.users where id = auth.uid())
    );

-- Receiver mag zien als hij ingelogd is (of via token, maar dat gaat via edge function)
create policy "Receivers can view incoming transfers"
    on public.ticket_transfers
    for select
    using (
        to_user_id = auth.uid()
        or to_email = (select email from auth.users where id = auth.uid())
    );

-- Org members mogen transfers zien (support)
create policy "Org members can view transfers"
    on public.ticket_transfers
    for select
    using (
        exists (
            select 1 from public.tickets t
            join public.ticket_types tt on t.ticket_type_id = tt.id
            join public.events e on tt.event_id = e.id
            where t.id = ticket_transfers.ticket_id
            and public.is_org_member(e.org_id)
        )
    );

-- Insert: Alleen via Edge Functions (security definer) of strikte policy
-- Voor nu: Users mogen inserten als ze eigenaar zijn van het ticket
create policy "Ticket owners can initiate transfer"
    on public.ticket_transfers
    for insert
    with check (
        exists (
            select 1 from public.tickets t
            join public.registrations r on t.registration_id = r.id
            join public.participants p on r.participant_id = p.id
            where t.id = ticket_transfers.ticket_id
            and p.user_id = auth.uid()
        )
    );

-- AUDIT LOG POLICIES

-- Alleen admins/owners mogen audit logs van hun org zien
create policy "Admins can view audit logs"
    on public.audit_log
    for select
    using (
        org_id is not null 
        and (public.has_role(org_id, 'admin') or public.has_role(org_id, 'owner'))
    );

-- Niemand mag audit logs wijzigen of verwijderen (Append-Only!)
-- Geen update/delete policies = default deny.

-- Insert: Iedereen mag logs schrijven (via triggers of app logic)
-- Maar veiliger is om dit via een SECURITY DEFINER functie te doen.
-- Voor nu: authenticated users mogen inserten (zodat client acties gelogd kunnen worden)
create policy "Authenticated users can insert audit logs"
    on public.audit_log
    for insert
    with check (auth.role() = 'authenticated');

-- 3. TRIGGERS
create trigger handle_updated_at_ticket_transfers before update on public.ticket_transfers
  for each row execute procedure extensions.moddatetime (updated_at);
