# F013 S1: Architecture - Invitation System

## Database Design

### Table: `invitation_codes`

```sql
CREATE TABLE public.invitation_codes (
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
CREATE INDEX idx_invitation_codes_org ON invitation_codes(org_id);
CREATE INDEX idx_invitation_codes_event ON invitation_codes(event_id);
CREATE INDEX idx_invitation_codes_code ON invitation_codes(code);
CREATE INDEX idx_invitation_codes_active ON invitation_codes(is_active) WHERE is_active = true;
```

### Table: `invitation_redemptions`

```sql
CREATE TABLE public.invitation_redemptions (
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
CREATE INDEX idx_invitation_redemptions_code ON invitation_redemptions(invitation_code_id);
CREATE INDEX idx_invitation_redemptions_user ON invitation_redemptions(user_id);
CREATE INDEX idx_invitation_redemptions_date ON invitation_redemptions(redeemed_at);
```

## RLS Policies

### invitation_codes
```sql
-- Enable RLS
ALTER TABLE invitation_codes ENABLE ROW LEVEL SECURITY;

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

-- Anyone can read active codes (for validation)
CREATE POLICY "anyone_can_validate_codes" ON invitation_codes
    FOR SELECT
    USING (is_active = true);
```

### invitation_redemptions
```sql
-- Enable RLS
ALTER TABLE invitation_redemptions ENABLE ROW LEVEL SECURITY;

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

-- Service role inserts (via RPC)
CREATE POLICY "service_insert_redemptions" ON invitation_redemptions
    FOR INSERT
    WITH CHECK (true);  -- RPC handles validation
```

## RPC Functions

### generate_invitation_code

```sql
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

    -- Generate unique code
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
        'activation_link', 'https://coloss.app/invite/' || v_result.code
    );
END;
$$;
```

### validate_invitation_code

```sql
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
    -- Find code
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

    -- Get context
    SELECT * INTO v_org FROM orgs WHERE id = v_invitation.org_id;

    IF v_invitation.event_id IS NOT NULL THEN
        SELECT * INTO v_event FROM events WHERE id = v_invitation.event_id;
    END IF;

    RETURN jsonb_build_object(
        'valid', true,
        'code_id', v_invitation.id,
        'org', jsonb_build_object('id', v_org.id, 'name', v_org.name),
        'event', CASE WHEN v_event IS NOT NULL THEN
            jsonb_build_object('id', v_event.id, 'name', v_event.name, 'slug', v_event.slug)
        ELSE NULL END,
        'uses_remaining', CASE WHEN v_invitation.max_uses IS NOT NULL
            THEN v_invitation.max_uses - v_invitation.uses_count
            ELSE NULL END
    );
END;
$$;
```

### redeem_invitation_code

```sql
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
BEGIN
    -- Validate first
    v_validation := validate_invitation_code(_code);

    IF NOT (v_validation->>'valid')::boolean THEN
        RETURN v_validation;
    END IF;

    v_user_id := auth.uid();

    -- Get invitation
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

    RETURN jsonb_build_object(
        'success', true,
        'org_id', v_invitation.org_id,
        'event_id', v_invitation.event_id,
        'redirect', CASE
            WHEN v_invitation.event_id IS NOT NULL THEN
                '/e/' || (SELECT slug FROM events WHERE id = v_invitation.event_id)
            ELSE '/events'
        END
    );
END;
$$;
```

### get_invitation_stats

```sql
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
    SELECT jsonb_agg(jsonb_build_object(
        'code', ic.code,
        'label', ic.label,
        'uses_count', ic.uses_count,
        'max_uses', ic.max_uses,
        'is_active', ic.is_active,
        'expires_at', ic.expires_at
    ))
    INTO v_codes_data
    FROM invitation_codes ic
    WHERE ic.org_id = _org_id
    AND (_event_id IS NULL OR ic.event_id = _event_id);

    -- Daily breakdown
    SELECT jsonb_agg(jsonb_build_object(
        'date', d.date,
        'count', COALESCE(r.cnt, 0)
    ))
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
        'codes', COALESCE(v_codes_data, '[]'::jsonb),
        'daily', COALESCE(v_daily_data, '[]'::jsonb)
    );
END;
$$;
```

## Frontend Components

### EventInvitations.tsx
- Code generation form (label, max uses, expiry)
- Active codes list with QR display
- Copy link button
- Statistics chart (daily new members)

### PublicInvite.tsx (route: /invite/:code)
- Code validation on load
- Display event/org info
- "Accept Invitation" button
- Redirect to event or signup

## File Structure

```
supabase/migrations/
└── 20250128170000_f013_invitation_system.sql

web/src/pages/
├── EventInvitations.tsx          # Organizer UI
└── public/
    └── PublicInvite.tsx          # Public accept page

web/src/data/
└── invitations.ts                # Data layer functions
```

## Security Considerations

1. **Code Generation**: Only org admins/owners can create codes
2. **Validation**: Public, but rate-limited
3. **Redemption**: Logged for audit, prevents double-use per user
4. **Statistics**: Org members only

## QR Code Generation

Frontend generates QR using `qrcode.react` library:
- Content: Activation link (`https://coloss.app/invite/{CODE}`)
- Size: 200x200px
- Error correction: Medium
