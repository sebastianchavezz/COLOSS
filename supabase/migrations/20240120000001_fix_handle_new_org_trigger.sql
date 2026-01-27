-- FIX: handle_new_org trigger fails when using service role
-- 
-- Problem: When Edge Functions insert into orgs using service_role key,
-- auth.uid() returns NULL because there's no authenticated user context.
-- The trigger tries to insert into org_members with user_id = NULL, which
-- violates the foreign key constraint.
--
-- Solution: Guard the trigger to skip if auth.uid() is NULL.
-- In that case, the Edge Function is responsible for creating the org_member.
--
-- This is safe because:
-- 1. Normal user inserts still work (auth.uid() exists)
-- 2. Service role inserts skip the trigger (Edge Function handles membership)

create or replace function public.handle_new_org()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Guard: Only auto-create membership if we have an authenticated user.
  -- Service role calls (from Edge Functions) will have auth.uid() = NULL
  -- and must handle membership creation explicitly in the function.
  if auth.uid() is not null then
    insert into public.org_members (org_id, user_id, role)
    values (new.id, auth.uid(), 'owner');
  end if;
  
  return new;
end;
$$;

comment on function public.handle_new_org() is 
  'Auto-creates owner membership when user creates org. Skipped when auth.uid() is NULL (service role calls).';
