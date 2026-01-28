-- ===========================================================================
-- F014: Team Management RPCs
-- ===========================================================================
-- Simple RBAC member management for organizations
-- ===========================================================================

-- ============================================================
-- RPC: list_org_members
-- ============================================================

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
    ORDER BY
        CASE om.role
            WHEN 'owner' THEN 1
            WHEN 'admin' THEN 2
            WHEN 'support' THEN 3
            WHEN 'finance' THEN 4
        END,
        om.created_at;
END;
$$;

-- ============================================================
-- RPC: invite_org_member
-- ============================================================

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

    -- Find user by email (case insensitive)
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE lower(email) = lower(_email);

    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('error', 'USER_NOT_FOUND', 'message', 'Geen gebruiker gevonden met dit emailadres');
    END IF;

    -- Check if already member
    IF EXISTS (SELECT 1 FROM org_members WHERE org_id = _org_id AND user_id = v_user_id) THEN
        RETURN jsonb_build_object('error', 'ALREADY_MEMBER', 'message', 'Deze gebruiker is al lid van de organisatie');
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

-- ============================================================
-- RPC: update_member_role
-- ============================================================

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

-- ============================================================
-- RPC: remove_org_member
-- ============================================================

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

-- ============================================================
-- RPC: get_current_user_role (helper)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_current_user_role(_org_id UUID)
RETURNS app_role
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role app_role;
BEGIN
    SELECT role INTO v_role
    FROM org_members
    WHERE org_id = _org_id AND user_id = auth.uid();

    RETURN v_role;
END;
$$;

-- ============================================================
-- GRANTS
-- ============================================================

GRANT EXECUTE ON FUNCTION public.list_org_members(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_org_member(UUID, TEXT, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_member_role(UUID, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_org_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_user_role(UUID) TO authenticated;

-- ============================================================
-- DONE
-- ============================================================

DO $$
BEGIN
    RAISE NOTICE 'F014: Team Management RPCs - Migration complete';
END$$;
