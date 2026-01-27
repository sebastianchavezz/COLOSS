-- Ensure constraints for Org Bootstrap safety

-- 1. Orgs Slug Unique
-- Already defined in layer_1_identity.sql but reinforcing here if needed.
-- constraint orgs_slug_key unique (slug)

-- 2. Org Members Unique (org_id, user_id)
-- Already defined in layer_1_identity.sql:
-- constraint org_members_org_user_unique unique (org_id, user_id)

-- 3. Org Members Role Enum Check
-- Already defined via type app_role enum ('owner', 'admin', 'support', 'finance');

-- This migration is just a sanity check / placeholder if we need to add anything new.
-- Currently, Layer 1 covers all requirements.
-- We will add a comment to confirm.

comment on table public.orgs is 'Organizations (Tenants). Slug must be unique.';
comment on table public.org_members is 'Links Users to Orgs. Unique constraint on (org_id, user_id) ensures one role per user per org.';
