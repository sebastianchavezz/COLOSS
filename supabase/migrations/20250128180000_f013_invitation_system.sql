-- ===========================================================================
-- F013: Invitation System
-- ===========================================================================
-- Tables: invitation_codes, invitation_redemptions
-- RPCs: generate_invitation_code, validate_invitation_code, redeem_invitation_code, get_invitation_stats
-- ===========================================================================

-- ============================================================
-- TABLE: invitation_codes
-- ============================================================

CREATE TABLE IF NOT EXISTS public.invitation_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Scope
    org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,  -- NULL = org-wide

    -- Code
    code VARCHAR(12) NOT NULL UNIQUE,

    -- Limits
    max_uses INTEGER,                    -- NULL = unlimited
    uses_count INTEGER NOT NULL DEFAULT 0,

    -- Validity
    expires_at TIMESTAMPTZ,              -- NULL = never expires
    is_active BOOLEAN NOT NULL DEFAULT true,

    -- Metadata
    label VARCHAR(100),                  -- Optional label ("Summer Campaign")
    created_by UUID REFERENCES auth.users(id),

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_invitation_codes_org ON invitation_codes(org_id);
CREATE INDEX IF NOT EXISTS idx_invitation_codes_event ON invitation_codes(event_id);
CREATE INDEX IF NOT EXISTS idx_invitation_codes_code ON invitation_codes(code);
CREATE INDEX IF NOT EXISTS idx_invitation_codes_active ON invitation_codes(is_active) WHERE is_active = true;

-- RLS
ALTER TABLE invitation_codes ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "org_members_manage_codes" ON invitation_codes;
DROP POLICY IF EXISTS "anyone_can_validate_codes" ON invitation_codes;

-- Organizers can manage their org's codes
CREATE POLICY "org_members_manage_codes" ON invitation_codes
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM org_members om
            WHERE om.org_id = invitation_codes.org_id
            AND om.user_id = auth.uid()
            AND om.role IN ('owner', 'admin')
        )
    );

-- Anyone can read active codes (for validation via RPC)
CREATE POLICY "anyone_can_validate_codes" ON invitation_codes
    FOR SELECT
    USING (is_active = true);

-- ============================================================
-- TABLE: invitation_redemptions
-- ============================================================

CREATE TABLE IF NOT EXISTS public.invitation_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- References
    invitation_code_id UUID NOT NULL REFERENCES invitation_codes(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id),

    -- Context
    email VARCHAR(255),                  -- For guest redemptions
    ip_address INET,
    user_agent TEXT,

    -- Timestamps
    redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_invitation_redemptions_code ON invitation_redemptions(invitation_code_id);
CREATE INDEX IF NOT EXISTS idx_invitation_redemptions_user ON invitation_redemptions(user_id);
CREATE INDEX IF NOT EXISTS idx_invitation_redemptions_date ON invitation_redemptions(redeemed_at);

-- RLS
ALTER TABLE invitation_redemptions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "org_members_view_redemptions" ON invitation_redemptions;
DROP POLICY IF EXISTS "service_insert_redemptions" ON invitation_redemptions;

-- Organizers can view redemptions
CREATE POLICY "org_members_view_redemptions" ON invitation_redemptions
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM invitation_codes ic
            JOIN org_members om ON om.org_id = ic.org_id
            WHERE ic.id = invitation_redemptions.invitation_code_id
            AND om.user_id = auth.uid()
        )
    );

-- ============================================================
-- RPC: generate_invitation_code
-- ============================================================

CREATE OR REPLACE FUNCTION public.generate_invitation_code(
    _org_id UUID,
    _event_id UUID DEFAULT NULL,
    _max_uses INTEGER DEFAULT NULL,
    _expires_at TIMESTAMPTZ DEFAULT NULL,
    _label VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code VARCHAR(8);
    v_result invitation_codes;
BEGIN
    -- Check permissions
    IF NOT EXISTS (
        SELECT 1 FROM org_members
        WHERE org_id = _org_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'admin')
    ) THEN
        RETURN jsonb_build_object('error', 'UNAUTHORIZED');
    END IF;

    -- Generate unique code (8 chars alphanumeric)
    LOOP
        v_code := upper(substr(md5(gen_random_uuid()::text), 1, 8));
        EXIT WHEN NOT EXISTS (SELECT 1 FROM invitation_codes WHERE code = v_code);
    END LOOP;

    -- Insert
    INSERT INTO invitation_codes (org_id, event_id, code, max_uses, expires_at, label, created_by)
    VALUES (_org_id, _event_id, v_code, _max_uses, _expires_at, _label, auth.uid())
    RETURNING * INTO v_result;

    RETURN jsonb_build_object(
        'success', true,
        'code', v_result.code,
        'id', v_result.id,
        'activation_link', '/invite/' || v_result.code
    );
END;
$$;

-- ============================================================
-- RPC: validate_invitation_code
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_invitation_code(_code VARCHAR)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_invitation invitation_codes;
    v_event events;
    v_org orgs;
BEGIN
    -- Find code (case insensitive)
    SELECT * INTO v_invitation
    FROM invitation_codes
    WHERE code = upper(_code)
    AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('valid', false, 'error', 'CODE_NOT_FOUND');
    END IF;

    -- Check expiry
    IF v_invitation.expires_at IS NOT NULL AND v_invitation.expires_at < NOW() THEN
        RETURN jsonb_build_object('valid', false, 'error', 'CODE_EXPIRED');
    END IF;

    -- Check uses
    IF v_invitation.max_uses IS NOT NULL AND v_invitation.uses_count >= v_invitation.max_uses THEN
        RETURN jsonb_build_object('valid', false, 'error', 'CODE_EXHAUSTED');
    END IF;

    -- Get org context
    SELECT * INTO v_org FROM orgs WHERE id = v_invitation.org_id;

    -- Get event context if applicable
    IF v_invitation.event_id IS NOT NULL THEN
        SELECT * INTO v_event FROM events WHERE id = v_invitation.event_id;
    END IF;

    RETURN jsonb_build_object(
        'valid', true,
        'code_id', v_invitation.id,
        'code', v_invitation.code,
        'org', jsonb_build_object('id', v_org.id, 'name', v_org.name, 'slug', v_org.slug),
        'event', CASE WHEN v_event IS NOT NULL THEN
            jsonb_build_object('id', v_event.id, 'name', v_event.name, 'slug', v_event.slug)
        ELSE NULL END,
        'uses_remaining', CASE WHEN v_invitation.max_uses IS NOT NULL
            THEN v_invitation.max_uses - v_invitation.uses_count
            ELSE NULL END,
        'label', v_invitation.label
    );
END;
$$;

-- ============================================================
-- RPC: redeem_invitation_code
-- ============================================================

CREATE OR REPLACE FUNCTION public.redeem_invitation_code(
    _code VARCHAR,
    _email VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_invitation invitation_codes;
    v_validation JSONB;
    v_user_id UUID;
    v_event_slug VARCHAR;
BEGIN
    -- Validate first
    v_validation := validate_invitation_code(_code);

    IF NOT (v_validation->>'valid')::boolean THEN
        RETURN v_validation;
    END IF;

    v_user_id := auth.uid();

    -- Get invitation with lock
    SELECT * INTO v_invitation
    FROM invitation_codes
    WHERE code = upper(_code)
    FOR UPDATE;

    -- Check if already redeemed by this user
    IF v_user_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM invitation_redemptions
        WHERE invitation_code_id = v_invitation.id
        AND user_id = v_user_id
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'ALREADY_REDEEMED');
    END IF;

    -- Record redemption
    INSERT INTO invitation_redemptions (invitation_code_id, user_id, email)
    VALUES (v_invitation.id, v_user_id, _email);

    -- Increment counter
    UPDATE invitation_codes
    SET uses_count = uses_count + 1, updated_at = NOW()
    WHERE id = v_invitation.id;

    -- Get redirect URL
    IF v_invitation.event_id IS NOT NULL THEN
        SELECT slug INTO v_event_slug FROM events WHERE id = v_invitation.event_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'org_id', v_invitation.org_id,
        'event_id', v_invitation.event_id,
        'redirect', CASE
            WHEN v_event_slug IS NOT NULL THEN '/e/' || v_event_slug
            ELSE '/events'
        END
    );
END;
$$;

-- ============================================================
-- RPC: get_invitation_stats
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_invitation_stats(
    _org_id UUID,
    _event_id UUID DEFAULT NULL,
    _from_date TIMESTAMPTZ DEFAULT NOW() - INTERVAL '7 days',
    _to_date TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total_codes INTEGER;
    v_total_redemptions INTEGER;
    v_codes_data JSONB;
    v_daily_data JSONB;
BEGIN
    -- Check permissions
    IF NOT EXISTS (
        SELECT 1 FROM org_members
        WHERE org_id = _org_id
        AND user_id = auth.uid()
    ) THEN
        RETURN jsonb_build_object('error', 'UNAUTHORIZED');
    END IF;

    -- Count codes
    SELECT COUNT(*) INTO v_total_codes
    FROM invitation_codes
    WHERE org_id = _org_id
    AND (_event_id IS NULL OR event_id = _event_id);

    -- Count redemptions in period
    SELECT COUNT(*) INTO v_total_redemptions
    FROM invitation_redemptions ir
    JOIN invitation_codes ic ON ic.id = ir.invitation_code_id
    WHERE ic.org_id = _org_id
    AND (_event_id IS NULL OR ic.event_id = _event_id)
    AND ir.redeemed_at BETWEEN _from_date AND _to_date;

    -- Codes breakdown
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', ic.id,
        'code', ic.code,
        'label', ic.label,
        'uses_count', ic.uses_count,
        'max_uses', ic.max_uses,
        'is_active', ic.is_active,
        'expires_at', ic.expires_at,
        'created_at', ic.created_at
    ) ORDER BY ic.created_at DESC), '[]'::jsonb)
    INTO v_codes_data
    FROM invitation_codes ic
    WHERE ic.org_id = _org_id
    AND (_event_id IS NULL OR ic.event_id = _event_id);

    -- Daily breakdown
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'date', d.date::text,
        'count', COALESCE(r.cnt, 0)
    ) ORDER BY d.date), '[]'::jsonb)
    INTO v_daily_data
    FROM generate_series(_from_date::date, _to_date::date, '1 day') AS d(date)
    LEFT JOIN (
        SELECT DATE(ir.redeemed_at) AS date, COUNT(*) AS cnt
        FROM invitation_redemptions ir
        JOIN invitation_codes ic ON ic.id = ir.invitation_code_id
        WHERE ic.org_id = _org_id
        AND (_event_id IS NULL OR ic.event_id = _event_id)
        AND ir.redeemed_at BETWEEN _from_date AND _to_date
        GROUP BY DATE(ir.redeemed_at)
    ) r ON r.date = d.date;

    RETURN jsonb_build_object(
        'total_codes', v_total_codes,
        'total_redemptions', v_total_redemptions,
        'period', jsonb_build_object('from', _from_date, 'to', _to_date),
        'codes', v_codes_data,
        'daily', v_daily_data
    );
END;
$$;

-- ============================================================
-- RPC: deactivate_invitation_code
-- ============================================================

CREATE OR REPLACE FUNCTION public.deactivate_invitation_code(_code_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_invitation invitation_codes;
BEGIN
    -- Get invitation
    SELECT * INTO v_invitation
    FROM invitation_codes
    WHERE id = _code_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'NOT_FOUND');
    END IF;

    -- Check permissions
    IF NOT EXISTS (
        SELECT 1 FROM org_members
        WHERE org_id = v_invitation.org_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'admin')
    ) THEN
        RETURN jsonb_build_object('error', 'UNAUTHORIZED');
    END IF;

    -- Deactivate
    UPDATE invitation_codes
    SET is_active = false, updated_at = NOW()
    WHERE id = _code_id;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- GRANTS
-- ============================================================

GRANT EXECUTE ON FUNCTION public.generate_invitation_code(UUID, UUID, INTEGER, TIMESTAMPTZ, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_invitation_code(VARCHAR) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_invitation_code(VARCHAR, VARCHAR) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_invitation_stats(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_invitation_code(UUID) TO authenticated;

-- ============================================================
-- DONE
-- ============================================================

DO $$
BEGIN
    RAISE NOTICE 'F013: Invitation System - Migration complete';
END$$;
