/**
 * INVITATION CODES SYSTEM
 *
 * Enables organizations to create invitation codes that:
 * - Grant access to private events
 * - Gate discounts (code required for discount)
 * - Track usage limits (global max, per-email max)
 * - Enforce time windows (valid_from/valid_until)
 *
 * Architecture:
 * - invitation_codes: Master record (org-scoped or event-scoped)
 * - invitation_code_uses: Append-only ledger for usage tracking
 *
 * Idempotency:
 * - Unique constraint on (invitation_code_id, order_id) prevents duplicate uses
 *
 * RLS:
 * - Org members (owner/admin/finance) can manage codes
 * - Public can validate codes for event registration
 * - Usage ledger is org-readable only
 */

-- ============================================================================
-- TABLE: invitation_codes
-- ============================================================================
CREATE TABLE IF NOT EXISTS invitation_codes (
    -- Identity
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,

    -- Code
    code TEXT NOT NULL,

    -- Metadata
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,

    -- Usage Limits
    max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
    max_uses_per_email INTEGER CHECK (max_uses_per_email IS NULL OR max_uses_per_email > 0),

    -- Time Window
    valid_from TIMESTAMPTZ,
    valid_until TIMESTAMPTZ,

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_at TIMESTAMPTZ,

    -- Constraints
    CONSTRAINT invitation_codes_time_window_check
        CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until),

    CONSTRAINT invitation_codes_org_event_code_unique
        UNIQUE (org_id, event_id, code),

    CONSTRAINT invitation_codes_org_code_unique_when_no_event
        UNIQUE (org_id, code) WHERE event_id IS NULL
);

COMMENT ON TABLE invitation_codes IS 'Invitation codes for event access and discount gating';
COMMENT ON COLUMN invitation_codes.code IS 'Case-insensitive alphanumeric code (normalized to uppercase)';
COMMENT ON COLUMN invitation_codes.event_id IS 'NULL = org-wide code, set = event-specific';
COMMENT ON COLUMN invitation_codes.max_uses IS 'NULL = unlimited total uses';
COMMENT ON COLUMN invitation_codes.max_uses_per_email IS 'NULL = unlimited per email';

-- Indexes
CREATE INDEX idx_invitation_codes_org_id ON invitation_codes(org_id);
CREATE INDEX idx_invitation_codes_event_id ON invitation_codes(event_id) WHERE event_id IS NOT NULL;
CREATE INDEX idx_invitation_codes_code_lookup ON invitation_codes(org_id, UPPER(code)) WHERE is_active = true;

-- ============================================================================
-- TABLE: invitation_code_uses
-- ============================================================================
CREATE TABLE IF NOT EXISTS invitation_code_uses (
    -- Identity
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invitation_code_id UUID NOT NULL REFERENCES invitation_codes(id) ON DELETE CASCADE,

    -- Context
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    email TEXT NOT NULL,

    -- Audit
    used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Idempotency: One code use per order
    CONSTRAINT invitation_code_uses_code_order_unique
        UNIQUE (invitation_code_id, order_id)
);

COMMENT ON TABLE invitation_code_uses IS 'Append-only ledger of invitation code usage';
COMMENT ON COLUMN invitation_code_uses.email IS 'Normalized email (lowercase) for per-email limit enforcement';

-- Indexes
CREATE INDEX idx_invitation_code_uses_code_id ON invitation_code_uses(invitation_code_id);
CREATE INDEX idx_invitation_code_uses_order_id ON invitation_code_uses(order_id);
CREATE INDEX idx_invitation_code_uses_email ON invitation_code_uses(invitation_code_id, LOWER(email));

-- ============================================================================
-- FUNCTION: normalize_invitation_code
-- ============================================================================
CREATE OR REPLACE FUNCTION normalize_invitation_code()
RETURNS TRIGGER AS $$
BEGIN
    -- Normalize code to uppercase and trim whitespace
    NEW.code = UPPER(TRIM(NEW.code));

    -- Validate code format (alphanumeric only, 3-50 chars)
    IF NEW.code !~ '^[A-Z0-9]{3,50}$' THEN
        RAISE EXCEPTION 'Invalid invitation code format. Must be 3-50 alphanumeric characters.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger
CREATE TRIGGER normalize_invitation_code_trigger
    BEFORE INSERT OR UPDATE OF code ON invitation_codes
    FOR EACH ROW
    EXECUTE FUNCTION normalize_invitation_code();

-- ============================================================================
-- FUNCTION: validate_invitation_code_usage
-- ============================================================================
CREATE OR REPLACE FUNCTION validate_invitation_code_usage(
    _code TEXT,
    _event_id UUID,
    _email TEXT
) RETURNS JSONB AS $$
DECLARE
    v_code RECORD;
    v_total_uses INTEGER;
    v_email_uses INTEGER;
    v_normalized_email TEXT;
    v_normalized_code TEXT;
BEGIN
    -- Normalize inputs
    v_normalized_code := UPPER(TRIM(_code));
    v_normalized_email := LOWER(TRIM(_email));

    -- Find code (org-wide or event-specific)
    SELECT ic.* INTO v_code
    FROM invitation_codes ic
    WHERE ic.code = v_normalized_code
      AND ic.is_active = true
      AND (ic.event_id IS NULL OR ic.event_id = _event_id)
      AND ic.org_id = (SELECT org_id FROM events WHERE id = _event_id)
    ORDER BY ic.event_id NULLS LAST -- Prefer event-specific over org-wide
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'valid', false,
            'error', 'INVALID_CODE',
            'message', 'Invitation code not found or inactive'
        );
    END IF;

    -- Check time window
    IF (v_code.valid_from IS NOT NULL AND NOW() < v_code.valid_from) THEN
        RETURN jsonb_build_object(
            'valid', false,
            'error', 'CODE_NOT_YET_VALID',
            'message', 'Invitation code is not yet valid',
            'valid_from', v_code.valid_from
        );
    END IF;

    IF (v_code.valid_until IS NOT NULL AND NOW() > v_code.valid_until) THEN
        RETURN jsonb_build_object(
            'valid', false,
            'error', 'CODE_EXPIRED',
            'message', 'Invitation code has expired',
            'valid_until', v_code.valid_until
        );
    END IF;

    -- Check total usage limit
    IF v_code.max_uses IS NOT NULL THEN
        SELECT COUNT(*) INTO v_total_uses
        FROM invitation_code_uses
        WHERE invitation_code_id = v_code.id;

        IF v_total_uses >= v_code.max_uses THEN
            RETURN jsonb_build_object(
                'valid', false,
                'error', 'CODE_MAX_USES_REACHED',
                'message', 'Invitation code has reached maximum uses'
            );
        END IF;
    END IF;

    -- Check per-email usage limit
    IF v_code.max_uses_per_email IS NOT NULL THEN
        SELECT COUNT(*) INTO v_email_uses
        FROM invitation_code_uses
        WHERE invitation_code_id = v_code.id
          AND LOWER(email) = v_normalized_email;

        IF v_email_uses >= v_code.max_uses_per_email THEN
            RETURN jsonb_build_object(
                'valid', false,
                'error', 'CODE_MAX_USES_PER_EMAIL_REACHED',
                'message', 'You have reached the maximum uses for this code'
            );
        END IF;
    END IF;

    -- Valid!
    RETURN jsonb_build_object(
        'valid', true,
        'code_id', v_code.id,
        'code', v_code.code,
        'description', v_code.description
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION validate_invitation_code_usage IS 'Validates an invitation code for a given event and email. Returns validation result with error details.';

-- ============================================================================
-- FUNCTION: record_invitation_code_use
-- ============================================================================
CREATE OR REPLACE FUNCTION record_invitation_code_use(
    _invitation_code_id UUID,
    _order_id UUID,
    _user_id UUID,
    _email TEXT
) RETURNS VOID AS $$
BEGIN
    -- Insert usage record (idempotent due to unique constraint)
    INSERT INTO invitation_code_uses (
        invitation_code_id,
        order_id,
        user_id,
        email
    ) VALUES (
        _invitation_code_id,
        _order_id,
        _user_id,
        LOWER(TRIM(_email))
    )
    ON CONFLICT (invitation_code_id, order_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION record_invitation_code_use IS 'Records invitation code usage in append-only ledger. Idempotent.';

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS
ALTER TABLE invitation_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitation_code_uses ENABLE ROW LEVEL SECURITY;

-- Policy: Org members can manage invitation codes
CREATE POLICY invitation_codes_org_members_manage
    ON invitation_codes
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM org_members om
            WHERE om.org_id = invitation_codes.org_id
              AND om.user_id = auth.uid()
              AND om.role IN ('owner', 'admin', 'finance')
        )
    );

-- Policy: Public can validate codes (via RPC only - SECURITY DEFINER handles this)
-- No direct SELECT policy needed since validation is done via RPC

-- Policy: Org members can view usage ledger
CREATE POLICY invitation_code_uses_org_members_view
    ON invitation_code_uses
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM invitation_codes ic
            INNER JOIN org_members om ON om.org_id = ic.org_id
            WHERE ic.id = invitation_code_uses.invitation_code_id
              AND om.user_id = auth.uid()
              AND om.role IN ('owner', 'admin', 'finance')
        )
    );

-- Policy: System can insert usage records (via SECURITY DEFINER RPC)
-- No INSERT policy needed since insertion is done via SECURITY DEFINER function
