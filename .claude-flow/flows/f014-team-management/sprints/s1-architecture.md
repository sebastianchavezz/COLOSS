# F014 S1: Architecture - Team Management

## Existing Schema

```sql
-- Already exists in layer_1_identity
create type app_role as enum ('owner', 'admin', 'support', 'finance');

create table public.org_members (
    id uuid primary key,
    org_id uuid references orgs(id),
    user_id uuid references auth.users(id),
    role app_role default 'support',
    created_at timestamptz default now()
);
```

## New RPC Functions

### list_org_members

```sql
CREATE OR REPLACE FUNCTION public.list_org_members(_org_id UUID)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    email TEXT,
    role app_role,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Check membership
    IF NOT public.is_org_member(_org_id) THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        om.id,
        om.user_id,
        au.email::text,
        om.role,
        om.created_at
    FROM org_members om
    JOIN auth.users au ON au.id = om.user_id
    WHERE om.org_id = _org_id
    ORDER BY om.created_at;
END;
$$;
```

### invite_org_member

```sql
CREATE OR REPLACE FUNCTION public.invite_org_member(
    _org_id UUID,
    _email TEXT,
    _role app_role DEFAULT 'support'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_member org_members;
BEGIN
    -- Only owners can invite
    IF NOT public.has_role(_org_id, 'owner') THEN
        RETURN jsonb_build_object('error', 'UNAUTHORIZED');
    END IF;

    -- Cannot assign owner role
    IF _role = 'owner' THEN
        RETURN jsonb_build_object('error', 'CANNOT_ASSIGN_OWNER');
    END IF;

    -- Find user by email
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE email = lower(_email);

    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('error', 'USER_NOT_FOUND');
    END IF;

    -- Check if already member
    IF EXISTS (SELECT 1 FROM org_members WHERE org_id = _org_id AND user_id = v_user_id) THEN
        RETURN jsonb_build_object('error', 'ALREADY_MEMBER');
    END IF;

    -- Add member
    INSERT INTO org_members (org_id, user_id, role)
    VALUES (_org_id, v_user_id, _role)
    RETURNING * INTO v_member;

    RETURN jsonb_build_object(
        'success', true,
        'member_id', v_member.id
    );
END;
$$;
```

### update_member_role

```sql
CREATE OR REPLACE FUNCTION public.update_member_role(
    _member_id UUID,
    _new_role app_role
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_member org_members;
BEGIN
    -- Get member
    SELECT * INTO v_member FROM org_members WHERE id = _member_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'NOT_FOUND');
    END IF;

    -- Only owners can change roles
    IF NOT public.has_role(v_member.org_id, 'owner') THEN
        RETURN jsonb_build_object('error', 'UNAUTHORIZED');
    END IF;

    -- Cannot change own role
    IF v_member.user_id = auth.uid() THEN
        RETURN jsonb_build_object('error', 'CANNOT_CHANGE_OWN_ROLE');
    END IF;

    -- Cannot assign owner role
    IF _new_role = 'owner' THEN
        RETURN jsonb_build_object('error', 'CANNOT_ASSIGN_OWNER');
    END IF;

    -- Cannot demote another owner
    IF v_member.role = 'owner' THEN
        RETURN jsonb_build_object('error', 'CANNOT_DEMOTE_OWNER');
    END IF;

    -- Update
    UPDATE org_members SET role = _new_role WHERE id = _member_id;

    RETURN jsonb_build_object('success', true);
END;
$$;
```

### remove_org_member

```sql
CREATE OR REPLACE FUNCTION public.remove_org_member(_member_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_member org_members;
BEGIN
    -- Get member
    SELECT * INTO v_member FROM org_members WHERE id = _member_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'NOT_FOUND');
    END IF;

    -- Only owners can remove
    IF NOT public.has_role(v_member.org_id, 'owner') THEN
        RETURN jsonb_build_object('error', 'UNAUTHORIZED');
    END IF;

    -- Cannot remove self
    IF v_member.user_id = auth.uid() THEN
        RETURN jsonb_build_object('error', 'CANNOT_REMOVE_SELF');
    END IF;

    -- Cannot remove owner
    IF v_member.role = 'owner' THEN
        RETURN jsonb_build_object('error', 'CANNOT_REMOVE_OWNER');
    END IF;

    -- Delete
    DELETE FROM org_members WHERE id = _member_id;

    RETURN jsonb_build_object('success', true);
END;
$$;
```

## Frontend Structure

```
web/src/
├── pages/
│   └── TeamPage.tsx          # /org/:orgSlug/team
└── data/
    └── team.ts               # Data layer
```

## Role Colors

| Role | Color | Badge |
|------|-------|-------|
| owner | Purple | bg-purple-100 text-purple-800 |
| admin | Blue | bg-blue-100 text-blue-800 |
| support | Green | bg-green-100 text-green-800 |
| finance | Yellow | bg-yellow-100 text-yellow-800 |
