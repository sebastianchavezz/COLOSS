/*
 * F017: Kortingscodes & Promoties (Discount Codes & Promotions)
 *
 * Intent:
 * - Enable organizers to create discount codes (percentage or fixed amount)
 * - Support both event-specific and org-wide codes
 * - Track usage limits (total and per-user)
 * - Enforce validation rules (min order, expiry, capacity)
 * - Provide secure RPCs for validation and application during checkout
 *
 * Security:
 * - RLS-first: all tables have RLS enabled
 * - SECURITY DEFINER functions for checkout operations
 * - Multi-tenant isolation via org_id
 * - Soft delete for audit trail
 *
 * Usage:
 * 1. Organizer creates code via create_discount_code()
 * 2. Customer enters code at checkout
 * 3. Frontend calls validate_discount_code() to preview discount
 * 4. During checkout, apply_discount_to_order() records usage
 */

-- =====================================================
-- TABLE: discount_codes
-- =====================================================

CREATE TABLE IF NOT EXISTS public.discount_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE, -- NULL = org-wide code

  -- Code details
  code TEXT NOT NULL, -- will be stored uppercase
  description TEXT,

  -- Discount configuration
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed_amount')),
  discount_value NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
  currency TEXT DEFAULT 'EUR',

  -- Constraints
  min_order_amount NUMERIC(10,2) DEFAULT 0 CHECK (min_order_amount >= 0),
  max_discount_amount NUMERIC(10,2) CHECK (max_discount_amount IS NULL OR max_discount_amount > 0), -- cap for percentage discounts

  -- Usage limits
  max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0), -- NULL = unlimited
  max_uses_per_user INTEGER DEFAULT 1 CHECK (max_uses_per_user IS NULL OR max_uses_per_user > 0),

  -- Validity period
  valid_from TIMESTAMPTZ DEFAULT NOW(),
  valid_until TIMESTAMPTZ, -- NULL = no expiry

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Applicability
  applies_to TEXT DEFAULT 'all' CHECK (applies_to IN ('all', 'tickets_only', 'products_only')),
  ticket_type_ids UUID[], -- NULL = all ticket types, [] or specific UUIDs = restricted

  -- Audit
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ, -- soft delete

  -- Additional validation
  CONSTRAINT valid_percentage CHECK (
    discount_type != 'percentage' OR discount_value <= 100
  ),
  CONSTRAINT valid_dates CHECK (
    valid_until IS NULL OR valid_until > valid_from
  )
);

-- Unique constraints for code (case-insensitive)
-- Org-wide codes: unique per org
CREATE UNIQUE INDEX IF NOT EXISTS idx_discount_codes_org_code_unique
  ON public.discount_codes(org_id, UPPER(code))
  WHERE event_id IS NULL AND deleted_at IS NULL;

-- Event codes: unique per event
CREATE UNIQUE INDEX IF NOT EXISTS idx_discount_codes_event_code_unique
  ON public.discount_codes(event_id, UPPER(code))
  WHERE event_id IS NOT NULL AND deleted_at IS NULL;

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_discount_codes_org_id
  ON public.discount_codes(org_id);

CREATE INDEX IF NOT EXISTS idx_discount_codes_event_id
  ON public.discount_codes(event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_discount_codes_code
  ON public.discount_codes(UPPER(code));

CREATE INDEX IF NOT EXISTS idx_discount_codes_active
  ON public.discount_codes(org_id, is_active)
  WHERE deleted_at IS NULL AND is_active = true;

-- Enable RLS
ALTER TABLE public.discount_codes ENABLE ROW LEVEL SECURITY;

-- Comment
COMMENT ON TABLE public.discount_codes IS
  'Discount codes for events or org-wide promotions. Supports percentage and fixed amount discounts with usage limits.';

-- =====================================================
-- TABLE: discount_usage
-- =====================================================

CREATE TABLE IF NOT EXISTS public.discount_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discount_code_id UUID NOT NULL REFERENCES public.discount_codes(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  email TEXT NOT NULL, -- for per-user tracking
  discount_applied NUMERIC(10,2) NOT NULL CHECK (discount_applied >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_discount_usage_code_id
  ON public.discount_usage(discount_code_id);

CREATE INDEX IF NOT EXISTS idx_discount_usage_order_id
  ON public.discount_usage(order_id);

CREATE INDEX IF NOT EXISTS idx_discount_usage_email
  ON public.discount_usage(email);

-- Enable RLS
ALTER TABLE public.discount_usage ENABLE ROW LEVEL SECURITY;

-- Comment
COMMENT ON TABLE public.discount_usage IS
  'Tracks each use of a discount code. Append-only for audit trail.';

-- =====================================================
-- UPDATED_AT TRIGGER
-- =====================================================

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.discount_codes
  FOR EACH ROW
  EXECUTE PROCEDURE extensions.moddatetime(updated_at);

-- =====================================================
-- RLS POLICIES: discount_codes
-- =====================================================

-- SELECT: org members can see their org's codes
CREATE POLICY "Org members can view their org's discount codes"
  ON public.discount_codes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.org_members om
      WHERE om.org_id = discount_codes.org_id
        AND om.user_id = auth.uid()
        /* deleted_at not on org_members */
    )
  );

-- INSERT: org admin/owner can create
CREATE POLICY "Org admin/owner can create discount codes"
  ON public.discount_codes
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.org_members om
      WHERE om.org_id = discount_codes.org_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
        /* deleted_at not on org_members */
    )
  );

-- UPDATE: org admin/owner can update
CREATE POLICY "Org admin/owner can update discount codes"
  ON public.discount_codes
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.org_members om
      WHERE om.org_id = discount_codes.org_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
        /* deleted_at not on org_members */
    )
  );

-- No DELETE policy - use soft delete via updated_at

-- =====================================================
-- RLS POLICIES: discount_usage
-- =====================================================

-- SELECT: org admin/owner can view usage for their org's codes
CREATE POLICY "Org admin/owner can view discount usage"
  ON public.discount_usage
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.discount_codes dc
      JOIN public.org_members om ON om.org_id = dc.org_id
      WHERE dc.id = discount_usage.discount_code_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin', 'finance')
        /* deleted_at not on org_members */
    )
  );

-- INSERT: only via SECURITY DEFINER functions
-- (no policy - functions will use service role)

-- =====================================================
-- VIEW: v_discount_code_stats
-- =====================================================

CREATE OR REPLACE VIEW public.v_discount_code_stats AS
SELECT
  dc.id,
  dc.org_id,
  dc.event_id,
  dc.code,
  dc.discount_type,
  dc.discount_value,
  dc.max_uses,
  dc.max_uses_per_user,
  dc.is_active,
  dc.valid_from,
  dc.valid_until,
  dc.deleted_at,

  -- Usage statistics
  COALESCE(COUNT(du.id), 0)::INTEGER AS total_uses,
  COALESCE(SUM(du.discount_applied), 0) AS total_discount_given,
  COALESCE(COUNT(DISTINCT du.email), 0)::INTEGER AS unique_users,

  -- Remaining uses
  CASE
    WHEN dc.max_uses IS NULL THEN NULL
    ELSE GREATEST(0, dc.max_uses - COALESCE(COUNT(du.id), 0))
  END AS remaining_uses

FROM public.discount_codes dc
LEFT JOIN public.discount_usage du ON du.discount_code_id = dc.id
GROUP BY dc.id;

COMMENT ON VIEW public.v_discount_code_stats IS
  'Discount codes with aggregated usage statistics.';

-- =====================================================
-- RPC: validate_discount_code
-- =====================================================

CREATE OR REPLACE FUNCTION public.validate_discount_code(
  _event_id UUID,
  _code TEXT,
  _email TEXT,
  _cart_total NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code RECORD;
  v_total_uses INTEGER;
  v_user_uses INTEGER;
  v_discount_amount NUMERIC;
  v_new_total NUMERIC;
BEGIN
  -- Normalize code to uppercase
  _code := UPPER(TRIM(_code));

  -- Look up code (event-specific or org-wide)
  SELECT dc.* INTO v_code
  FROM public.discount_codes dc
  WHERE UPPER(dc.code) = _code
    AND dc.deleted_at IS NULL
    AND (
      dc.event_id = _event_id OR
      (dc.event_id IS NULL AND dc.org_id = (SELECT org_id FROM public.events WHERE id = _event_id))
    )
  ORDER BY dc.event_id NULLS LAST -- prioritize event-specific codes
  LIMIT 1;

  -- Code not found
  IF v_code.id IS NULL THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'INVALID_CODE'
    );
  END IF;

  -- Check if active
  IF NOT v_code.is_active THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'NOT_ACTIVE'
    );
  END IF;

  -- Check validity period
  IF v_code.valid_from > NOW() THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'NOT_YET_VALID'
    );
  END IF;

  IF v_code.valid_until IS NOT NULL AND v_code.valid_until < NOW() THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'EXPIRED'
    );
  END IF;

  -- Check total usage limit
  IF v_code.max_uses IS NOT NULL THEN
    SELECT COUNT(*) INTO v_total_uses
    FROM public.discount_usage
    WHERE discount_code_id = v_code.id;

    IF v_total_uses >= v_code.max_uses THEN
      RETURN jsonb_build_object(
        'valid', false,
        'error', 'USAGE_LIMIT_REACHED'
      );
    END IF;
  END IF;

  -- Check per-user usage limit
  IF v_code.max_uses_per_user IS NOT NULL THEN
    SELECT COUNT(*) INTO v_user_uses
    FROM public.discount_usage
    WHERE discount_code_id = v_code.id
      AND email = _email;

    IF v_user_uses >= v_code.max_uses_per_user THEN
      RETURN jsonb_build_object(
        'valid', false,
        'error', 'PER_USER_LIMIT_REACHED'
      );
    END IF;
  END IF;

  -- Check minimum order amount
  IF _cart_total < v_code.min_order_amount THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'MIN_ORDER_NOT_MET',
      'min_order_amount', v_code.min_order_amount
    );
  END IF;

  -- Calculate discount amount
  IF v_code.discount_type = 'percentage' THEN
    v_discount_amount := (_cart_total * v_code.discount_value / 100);

    -- Apply cap if set
    IF v_code.max_discount_amount IS NOT NULL THEN
      v_discount_amount := LEAST(v_discount_amount, v_code.max_discount_amount);
    END IF;
  ELSE
    -- Fixed amount
    v_discount_amount := v_code.discount_value;
  END IF;

  -- Ensure discount doesn't exceed cart total
  v_discount_amount := LEAST(v_discount_amount, _cart_total);
  v_discount_amount := ROUND(v_discount_amount, 2);

  v_new_total := GREATEST(0, _cart_total - v_discount_amount);

  -- Return success with calculated discount
  RETURN jsonb_build_object(
    'valid', true,
    'discount_code_id', v_code.id,
    'code', v_code.code,
    'discount_type', v_code.discount_type,
    'discount_value', v_code.discount_value,
    'discount_amount', v_discount_amount,
    'new_total', v_new_total,
    'applies_to', v_code.applies_to,
    'ticket_type_ids', v_code.ticket_type_ids
  );
END;
$$;

COMMENT ON FUNCTION public.validate_discount_code IS
  'Validates a discount code and calculates the discount amount. Returns validation result with discount details.';

-- =====================================================
-- RPC: apply_discount_to_order
-- =====================================================

CREATE OR REPLACE FUNCTION public.apply_discount_to_order(
  _order_id UUID,
  _discount_code_id UUID,
  _email TEXT,
  _discount_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_code RECORD;
BEGIN
  -- Get order details
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = _order_id;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'ORDER_NOT_FOUND'
    );
  END IF;

  -- Verify order is in pending status
  IF v_order.status != 'pending' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'ORDER_NOT_PENDING'
    );
  END IF;

  -- Get discount code
  SELECT * INTO v_code
  FROM public.discount_codes
  WHERE id = _discount_code_id;

  IF v_code.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'DISCOUNT_CODE_NOT_FOUND'
    );
  END IF;

  -- Validate discount amount is positive
  IF _discount_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_DISCOUNT_AMOUNT'
    );
  END IF;

  -- Insert usage record
  INSERT INTO public.discount_usage (
    discount_code_id,
    order_id,
    email,
    discount_applied
  ) VALUES (
    _discount_code_id,
    _order_id,
    _email,
    _discount_amount
  );

  -- Update order amounts
  -- subtotal_amount remains the original total
  -- discount_amount stores the discount
  -- total_amount is reduced
  UPDATE public.orders
  SET
    subtotal_amount = total_amount, -- preserve original as subtotal
    discount_amount = _discount_amount,
    total_amount = GREATEST(0, total_amount - _discount_amount),
    updated_at = NOW()
  WHERE id = _order_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', _order_id,
    'discount_applied', _discount_amount,
    'new_total', GREATEST(0, v_order.total_amount - _discount_amount)
  );
END;
$$;

COMMENT ON FUNCTION public.apply_discount_to_order IS
  'Applies a validated discount code to an order. Records usage and updates order totals. Must be called within checkout transaction.';

-- =====================================================
-- RPC: get_discount_codes
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_discount_codes(
  _event_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  org_id UUID,
  event_id UUID,
  code TEXT,
  description TEXT,
  discount_type TEXT,
  discount_value NUMERIC,
  currency TEXT,
  min_order_amount NUMERIC,
  max_discount_amount NUMERIC,
  max_uses INTEGER,
  max_uses_per_user INTEGER,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  is_active BOOLEAN,
  applies_to TEXT,
  ticket_type_ids UUID[],
  created_at TIMESTAMPTZ,
  total_uses INTEGER,
  total_discount_given NUMERIC,
  unique_users INTEGER,
  remaining_uses INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify user is org member
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members om
    JOIN public.events e ON e.org_id = om.org_id
    WHERE e.id = _event_id
      AND om.user_id = auth.uid()
      /* deleted_at not on org_members */
  ) AND _event_id IS NOT NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.org_id,
    s.event_id,
    s.code,
    dc.description,
    s.discount_type,
    s.discount_value,
    dc.currency,
    dc.min_order_amount,
    dc.max_discount_amount,
    s.max_uses,
    s.max_uses_per_user,
    s.valid_from,
    s.valid_until,
    s.is_active,
    dc.applies_to,
    dc.ticket_type_ids,
    dc.created_at,
    s.total_uses,
    s.total_discount_given,
    s.unique_users,
    s.remaining_uses
  FROM public.v_discount_code_stats s
  JOIN public.discount_codes dc ON dc.id = s.id
  WHERE s.deleted_at IS NULL
    AND (_event_id IS NULL OR s.event_id = _event_id OR (s.event_id IS NULL AND s.org_id = (
      SELECT org_id FROM public.events WHERE id = _event_id
    )))
  ORDER BY s.created_at DESC;
END;
$$;

COMMENT ON FUNCTION public.get_discount_codes IS
  'Returns discount codes for an event (including org-wide codes) with usage statistics. Restricted to org members.';

-- =====================================================
-- RPC: create_discount_code
-- =====================================================

CREATE OR REPLACE FUNCTION public.create_discount_code(
  _org_id UUID,
  _event_id UUID,
  _code TEXT,
  _description TEXT,
  _discount_type TEXT,
  _discount_value NUMERIC,
  _min_order_amount NUMERIC DEFAULT 0,
  _max_discount_amount NUMERIC DEFAULT NULL,
  _max_uses INTEGER DEFAULT NULL,
  _max_uses_per_user INTEGER DEFAULT 1,
  _valid_from TIMESTAMPTZ DEFAULT NOW(),
  _valid_until TIMESTAMPTZ DEFAULT NULL,
  _applies_to TEXT DEFAULT 'all',
  _ticket_type_ids UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code_id UUID;
BEGIN
  -- Verify user is org admin/owner
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = _org_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'UNAUTHORIZED'
    );
  END IF;

  -- Validate inputs
  IF _discount_type NOT IN ('percentage', 'fixed_amount') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_DISCOUNT_TYPE'
    );
  END IF;

  IF _discount_value <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_DISCOUNT_VALUE'
    );
  END IF;

  IF _discount_type = 'percentage' AND _discount_value > 100 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'PERCENTAGE_TOO_HIGH'
    );
  END IF;

  IF _applies_to NOT IN ('all', 'tickets_only', 'products_only') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_APPLIES_TO'
    );
  END IF;

  -- Normalize code
  _code := UPPER(TRIM(_code));

  -- Insert code
  INSERT INTO public.discount_codes (
    org_id,
    event_id,
    code,
    description,
    discount_type,
    discount_value,
    min_order_amount,
    max_discount_amount,
    max_uses,
    max_uses_per_user,
    valid_from,
    valid_until,
    applies_to,
    ticket_type_ids,
    created_by
  ) VALUES (
    _org_id,
    _event_id,
    _code,
    _description,
    _discount_type,
    _discount_value,
    _min_order_amount,
    _max_discount_amount,
    _max_uses,
    _max_uses_per_user,
    _valid_from,
    _valid_until,
    _applies_to,
    _ticket_type_ids,
    auth.uid()
  )
  RETURNING id INTO v_code_id;

  RETURN jsonb_build_object(
    'success', true,
    'discount_code_id', v_code_id
  );

EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'CODE_ALREADY_EXISTS'
    );
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'DATABASE_ERROR',
      'message', SQLERRM
    );
END;
$$;

COMMENT ON FUNCTION public.create_discount_code IS
  'Creates a new discount code. Restricted to org admin/owner.';

-- =====================================================
-- RPC: update_discount_code
-- =====================================================

CREATE OR REPLACE FUNCTION public.update_discount_code(
  _code_id UUID,
  _description TEXT DEFAULT NULL,
  _discount_value NUMERIC DEFAULT NULL,
  _min_order_amount NUMERIC DEFAULT NULL,
  _max_discount_amount NUMERIC DEFAULT NULL,
  _max_uses INTEGER DEFAULT NULL,
  _max_uses_per_user INTEGER DEFAULT NULL,
  _valid_from TIMESTAMPTZ DEFAULT NULL,
  _valid_until TIMESTAMPTZ DEFAULT NULL,
  _is_active BOOLEAN DEFAULT NULL,
  _applies_to TEXT DEFAULT NULL,
  _ticket_type_ids UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code RECORD;
BEGIN
  -- Get existing code
  SELECT * INTO v_code
  FROM public.discount_codes
  WHERE id = _code_id;

  IF v_code.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'CODE_NOT_FOUND'
    );
  END IF;

  -- Verify user is org admin/owner
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = v_code.org_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'UNAUTHORIZED'
    );
  END IF;

  -- Update code (only provided fields)
  UPDATE public.discount_codes
  SET
    description = COALESCE(_description, description),
    discount_value = COALESCE(_discount_value, discount_value),
    min_order_amount = COALESCE(_min_order_amount, min_order_amount),
    max_discount_amount = COALESCE(_max_discount_amount, max_discount_amount),
    max_uses = COALESCE(_max_uses, max_uses),
    max_uses_per_user = COALESCE(_max_uses_per_user, max_uses_per_user),
    valid_from = COALESCE(_valid_from, valid_from),
    valid_until = COALESCE(_valid_until, valid_until),
    is_active = COALESCE(_is_active, is_active),
    applies_to = COALESCE(_applies_to, applies_to),
    ticket_type_ids = COALESCE(_ticket_type_ids, ticket_type_ids),
    updated_at = NOW()
  WHERE id = _code_id;

  RETURN jsonb_build_object(
    'success', true,
    'discount_code_id', _code_id
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'DATABASE_ERROR',
      'message', SQLERRM
    );
END;
$$;

COMMENT ON FUNCTION public.update_discount_code IS
  'Updates an existing discount code. Only provided fields are updated. Restricted to org admin/owner.';

-- =====================================================
-- RPC: delete_discount_code (soft delete)
-- =====================================================

CREATE OR REPLACE FUNCTION public.delete_discount_code(
  _code_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code RECORD;
BEGIN
  -- Get existing code
  SELECT * INTO v_code
  FROM public.discount_codes
  WHERE id = _code_id;

  IF v_code.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'CODE_NOT_FOUND'
    );
  END IF;

  -- Verify user is org admin/owner
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = v_code.org_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'UNAUTHORIZED'
    );
  END IF;

  -- Soft delete
  UPDATE public.discount_codes
  SET
    deleted_at = NOW(),
    is_active = false,
    updated_at = NOW()
  WHERE id = _code_id;

  RETURN jsonb_build_object(
    'success', true,
    'discount_code_id', _code_id
  );
END;
$$;

COMMENT ON FUNCTION public.delete_discount_code IS
  'Soft deletes a discount code. Sets deleted_at and is_active = false. Restricted to org admin/owner.';

-- =====================================================
-- GRANT PERMISSIONS
-- =====================================================

-- Tables
GRANT SELECT ON public.discount_codes TO authenticated;
GRANT SELECT ON public.discount_usage TO authenticated;

-- View
GRANT SELECT ON public.v_discount_code_stats TO authenticated;

-- Functions
GRANT EXECUTE ON FUNCTION public.validate_discount_code TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.apply_discount_to_order TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_discount_codes TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_discount_code TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_discount_code TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_discount_code TO authenticated;
