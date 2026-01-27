-- AUDIT LOG TABLE
-- Append-only log voor kritieke acties
-- IDEMPOTENT REWRITE

create table if not exists public.audit_log (
    id uuid not null default gen_random_uuid(),
    constraint audit_log_pkey primary key (id)
);

-- Add columns
alter table public.audit_log add column if not exists org_id uuid not null;
alter table public.audit_log add column if not exists actor_user_id uuid;
alter table public.audit_log add column if not exists action text not null;
alter table public.audit_log add column if not exists entity_type text not null;
alter table public.audit_log add column if not exists entity_id uuid;
alter table public.audit_log add column if not exists before_state jsonb;
alter table public.audit_log add column if not exists after_state jsonb;
alter table public.audit_log add column if not exists metadata jsonb;
alter table public.audit_log add column if not exists created_at timestamptz not null default now();

-- Constraints
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'audit_log_org_id_fkey') then
        alter table public.audit_log add constraint audit_log_org_id_fkey 
        foreign key (org_id) references public.orgs(id) on delete restrict;
    end if;
exception when duplicate_object then null;
end $$;

-- Indexes
create index if not exists idx_audit_log_org_id on public.audit_log(org_id, created_at desc);
create index if not exists idx_audit_log_action on public.audit_log(action, created_at desc);
create index if not exists idx_audit_log_entity on public.audit_log(entity_type, entity_id);

-- RLS
alter table public.audit_log enable row level security;

drop policy if exists "Org members can view audit logs" on public.audit_log;
create policy "Org members can view audit logs"
    on public.audit_log
    for select
    using (public.is_org_member(org_id));

comment on table public.audit_log is 
  'Append-only audit trail for critical actions. Only readable by org members.';
