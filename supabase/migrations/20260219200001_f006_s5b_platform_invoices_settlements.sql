-- ===========================================================================
-- F006 S5b: Platform Invoices & Settlements
-- ===========================================================================
-- Doel: Tables and RPCs for platform fee tracking, invoicing, and settlements.
--
-- COLOSS operates as agent (intermediary):
--   - Organizer is the seller
--   - COLOSS facilitates and invoices platform fees
--   - Platform fees always have 21% VAT (NL services)
--
-- Tables:
--   1. platform_fee_config    — fee configuration per org
--   2. platform_invoices      — COLOSS invoices to organizers
--   3. platform_invoice_items — line items per event on invoice
--   4. settlements            — payout summaries per event/period
--   5. settlement_lines       — VAT breakdown per rate per settlement
--
-- RPCs:
--   - next_platform_invoice_number(year) — gap-free sequential numbering
--   - generate_settlement(org_id, event_id?, period_start?, period_end?)
--   - generate_platform_invoice(org_id, period_start, period_end)
-- ===========================================================================

-- =====================================================
-- 1. PLATFORM FEE CONFIG
-- =====================================================

CREATE TABLE IF NOT EXISTS public.platform_fee_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  fee_type TEXT NOT NULL DEFAULT 'percentage' CHECK (fee_type IN ('percentage', 'flat', 'percentage_plus_flat')),
  percentage_rate NUMERIC(5,2) NOT NULL DEFAULT 5.00 CHECK (percentage_rate >= 0 AND percentage_rate <= 100),
  flat_fee_per_ticket NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (flat_fee_per_ticket >= 0),
  minimum_fee_per_order NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (minimum_fee_per_order >= 0),
  vat_percentage NUMERIC(4,2) NOT NULL DEFAULT 21.00 CHECK (vat_percentage >= 0 AND vat_percentage <= 100),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Only one active config per org at a time
  CONSTRAINT platform_fee_config_dates_check CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE INDEX IF NOT EXISTS idx_platform_fee_config_org_id ON public.platform_fee_config(org_id);
CREATE INDEX IF NOT EXISTS idx_platform_fee_config_effective ON public.platform_fee_config(org_id, effective_from, effective_until);

COMMENT ON TABLE public.platform_fee_config IS 'Platform fee configuration per organization. COLOSS charges these fees for facilitation.';

-- =====================================================
-- 2. PLATFORM INVOICES
-- =====================================================

CREATE TABLE IF NOT EXISTS public.platform_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.orgs(id) ON DELETE RESTRICT,
  invoice_number TEXT NOT NULL UNIQUE,
  invoice_year INT NOT NULL,
  invoice_sequence INT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  -- Amounts
  subtotal_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  vat_percentage NUMERIC(4,2) NOT NULL DEFAULT 21.00,
  vat_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,

  -- Status
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'cancelled')),

  -- Snapshot of company info at invoice time
  platform_company_name TEXT NOT NULL DEFAULT 'COLOSS B.V.',
  platform_vat_number TEXT NOT NULL DEFAULT '',
  platform_kvk_number TEXT NOT NULL DEFAULT '',
  platform_address TEXT NOT NULL DEFAULT '',

  org_company_name TEXT NOT NULL DEFAULT '',
  org_vat_number TEXT NOT NULL DEFAULT '',
  org_kvk_number TEXT NOT NULL DEFAULT '',
  org_address TEXT NOT NULL DEFAULT '',

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT platform_invoices_period_check CHECK (period_end >= period_start),
  CONSTRAINT platform_invoices_year_seq_unique UNIQUE (invoice_year, invoice_sequence)
);

CREATE INDEX IF NOT EXISTS idx_platform_invoices_org_id ON public.platform_invoices(org_id);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_status ON public.platform_invoices(status);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_period ON public.platform_invoices(period_start, period_end);

COMMENT ON TABLE public.platform_invoices IS 'COLOSS platform invoices to organizers for facilitation fees.';

-- =====================================================
-- 3. PLATFORM INVOICE ITEMS
-- =====================================================

CREATE TABLE IF NOT EXISTS public.platform_invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.platform_invoices(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  order_count INT NOT NULL DEFAULT 0,
  ticket_count INT NOT NULL DEFAULT 0,
  gross_revenue NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  fee_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_invoice_items_invoice_id ON public.platform_invoice_items(invoice_id);

COMMENT ON TABLE public.platform_invoice_items IS 'Line items per event on a platform invoice.';

-- =====================================================
-- 4. SETTLEMENTS
-- =====================================================

CREATE TABLE IF NOT EXISTS public.settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.orgs(id) ON DELETE RESTRICT,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  -- Revenue
  gross_ticket_revenue NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  gross_product_revenue NUMERIC(10,2) NOT NULL DEFAULT 0.00,

  -- Deductions
  total_refunds NUMERIC(10,2) NOT NULL DEFAULT 0.00,

  -- Platform fees
  platform_fees_excl_vat NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  platform_fees_vat NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  platform_fees_incl_vat NUMERIC(10,2) NOT NULL DEFAULT 0.00,

  -- Net payout
  net_payout_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid_out')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT settlements_period_check CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_settlements_org_id ON public.settlements(org_id);
CREATE INDEX IF NOT EXISTS idx_settlements_event_id ON public.settlements(event_id);
CREATE INDEX IF NOT EXISTS idx_settlements_status ON public.settlements(status);
CREATE INDEX IF NOT EXISTS idx_settlements_period ON public.settlements(period_start, period_end);

COMMENT ON TABLE public.settlements IS 'Payout summaries per event/period for organizers.';

-- =====================================================
-- 5. SETTLEMENT LINES
-- =====================================================

CREATE TABLE IF NOT EXISTS public.settlement_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id UUID NOT NULL REFERENCES public.settlements(id) ON DELETE CASCADE,
  vat_percentage NUMERIC(4,2) NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('ticket', 'product')),
  revenue_incl_vat NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  revenue_excl_vat NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  vat_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  item_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_settlement_lines_settlement_id ON public.settlement_lines(settlement_id);

COMMENT ON TABLE public.settlement_lines IS 'VAT breakdown per rate per settlement (ticket vs product).';

-- =====================================================
-- 6. RLS POLICIES
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE public.platform_fee_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_lines ENABLE ROW LEVEL SECURITY;

-- platform_fee_config: SELECT for org owner/admin/finance
DROP POLICY IF EXISTS "Org finance can view fee config" ON public.platform_fee_config;
CREATE POLICY "Org finance can view fee config"
ON public.platform_fee_config FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.org_members om
  WHERE om.org_id = platform_fee_config.org_id
    AND om.user_id = auth.uid()
    AND om.role IN ('owner', 'admin', 'finance')
));

-- platform_invoices: SELECT for org owner/admin/finance
DROP POLICY IF EXISTS "Org finance can view invoices" ON public.platform_invoices;
CREATE POLICY "Org finance can view invoices"
ON public.platform_invoices FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.org_members om
  WHERE om.org_id = platform_invoices.org_id
    AND om.user_id = auth.uid()
    AND om.role IN ('owner', 'admin', 'finance')
));

-- platform_invoice_items: SELECT via parent invoice
DROP POLICY IF EXISTS "View invoice items via parent" ON public.platform_invoice_items;
CREATE POLICY "View invoice items via parent"
ON public.platform_invoice_items FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.platform_invoices pi
  JOIN public.org_members om ON om.org_id = pi.org_id
  WHERE pi.id = platform_invoice_items.invoice_id
    AND om.user_id = auth.uid()
    AND om.role IN ('owner', 'admin', 'finance')
));

-- settlements: SELECT for org owner/admin/finance
DROP POLICY IF EXISTS "Org finance can view settlements" ON public.settlements;
CREATE POLICY "Org finance can view settlements"
ON public.settlements FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.org_members om
  WHERE om.org_id = settlements.org_id
    AND om.user_id = auth.uid()
    AND om.role IN ('owner', 'admin', 'finance')
));

-- settlement_lines: SELECT via parent settlement
DROP POLICY IF EXISTS "View settlement lines via parent" ON public.settlement_lines;
CREATE POLICY "View settlement lines via parent"
ON public.settlement_lines FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.settlements s
  JOIN public.org_members om ON om.org_id = s.org_id
  WHERE s.id = settlement_lines.settlement_id
    AND om.user_id = auth.uid()
    AND om.role IN ('owner', 'admin', 'finance')
));

-- =====================================================
-- 7. GRANTS
-- =====================================================

-- Read access for authenticated users (RLS enforces org membership)
GRANT SELECT ON public.platform_fee_config TO authenticated;
GRANT SELECT ON public.platform_invoices TO authenticated;
GRANT SELECT ON public.platform_invoice_items TO authenticated;
GRANT SELECT ON public.settlements TO authenticated;
GRANT SELECT ON public.settlement_lines TO authenticated;

-- Full access for service_role (Edge Functions)
GRANT ALL ON public.platform_fee_config TO service_role;
GRANT ALL ON public.platform_invoices TO service_role;
GRANT ALL ON public.platform_invoice_items TO service_role;
GRANT ALL ON public.settlements TO service_role;
GRANT ALL ON public.settlement_lines TO service_role;

-- =====================================================
-- 8. RPCs
-- =====================================================

-- Sequential invoice numbering with advisory lock (gap-free)
CREATE OR REPLACE FUNCTION public.next_platform_invoice_number(_year INT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_seq INT;
  v_invoice_number TEXT;
BEGIN
  -- Advisory lock prevents concurrent numbering races
  PERFORM pg_advisory_xact_lock(hashtext('platform_invoice_' || _year::TEXT));

  -- Get next sequence number for this year
  SELECT COALESCE(MAX(invoice_sequence), 0) + 1
  INTO v_next_seq
  FROM public.platform_invoices
  WHERE invoice_year = _year;

  -- Format: INV-2026-0001
  v_invoice_number := 'INV-' || _year::TEXT || '-' || LPAD(v_next_seq::TEXT, 4, '0');

  RETURN v_invoice_number;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_platform_invoice_number(INT) TO service_role;

-- Generate settlement for an org (optionally filtered by event and/or period)
CREATE OR REPLACE FUNCTION public.generate_settlement(
  _org_id UUID,
  _event_id UUID DEFAULT NULL,
  _period_start DATE DEFAULT NULL,
  _period_end DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settlement_id UUID;
  v_gross_ticket NUMERIC(10,2) := 0;
  v_gross_product NUMERIC(10,2) := 0;
  v_total_refunds NUMERIC(10,2) := 0;
  v_platform_fee_pct NUMERIC(5,2) := 5.00;
  v_platform_vat_pct NUMERIC(4,2) := 21.00;
  v_fees_excl NUMERIC(10,2);
  v_fees_vat NUMERIC(10,2);
  v_fees_incl NUMERIC(10,2);
  v_net_payout NUMERIC(10,2);
  v_effective_start DATE;
  v_effective_end DATE;
  v_fee_config RECORD;
BEGIN
  -- Default period: last 30 days
  v_effective_start := COALESCE(_period_start, (CURRENT_DATE - INTERVAL '30 days')::DATE);
  v_effective_end := COALESCE(_period_end, CURRENT_DATE);

  -- Look up fee config for org
  SELECT pfc.percentage_rate, pfc.vat_percentage
  INTO v_fee_config
  FROM public.platform_fee_config pfc
  WHERE pfc.org_id = _org_id
    AND pfc.effective_from <= v_effective_end
    AND (pfc.effective_until IS NULL OR pfc.effective_until >= v_effective_start)
  ORDER BY pfc.effective_from DESC
  LIMIT 1;

  IF FOUND THEN
    v_platform_fee_pct := v_fee_config.percentage_rate;
    v_platform_vat_pct := v_fee_config.vat_percentage;
  END IF;

  -- Calculate gross ticket revenue
  SELECT COALESCE(SUM(oi.total_price), 0) INTO v_gross_ticket
  FROM public.order_items oi
  JOIN public.orders o ON oi.order_id = o.id
  WHERE o.org_id = _org_id
    AND o.status = 'paid'
    AND o.created_at >= v_effective_start
    AND o.created_at < (v_effective_end + INTERVAL '1 day')
    AND oi.ticket_type_id IS NOT NULL
    AND (_event_id IS NULL OR o.event_id = _event_id);

  -- Calculate gross product revenue
  SELECT COALESCE(SUM(oi.total_price), 0) INTO v_gross_product
  FROM public.order_items oi
  JOIN public.orders o ON oi.order_id = o.id
  WHERE o.org_id = _org_id
    AND o.status = 'paid'
    AND o.created_at >= v_effective_start
    AND o.created_at < (v_effective_end + INTERVAL '1 day')
    AND oi.product_id IS NOT NULL
    AND (_event_id IS NULL OR o.event_id = _event_id);

  -- Calculate total refunds (amount_cents -> EUR)
  SELECT COALESCE(SUM(r.amount_cents), 0) / 100.0 INTO v_total_refunds
  FROM public.refunds r
  JOIN public.orders o ON r.order_id = o.id
  WHERE o.org_id = _org_id
    AND r.status IN ('completed', 'pending')
    AND r.created_at >= v_effective_start
    AND r.created_at < (v_effective_end + INTERVAL '1 day')
    AND (_event_id IS NULL OR o.event_id = _event_id);

  -- Calculate platform fees
  v_fees_excl := ROUND((v_gross_ticket + v_gross_product - v_total_refunds) * v_platform_fee_pct / 100, 2);
  IF v_fees_excl < 0 THEN v_fees_excl := 0; END IF;
  v_fees_vat := ROUND(v_fees_excl * v_platform_vat_pct / 100, 2);
  v_fees_incl := v_fees_excl + v_fees_vat;

  -- Calculate net payout
  v_net_payout := (v_gross_ticket + v_gross_product) - v_total_refunds - v_fees_incl;

  -- Create settlement
  INSERT INTO public.settlements (
    org_id, event_id, period_start, period_end,
    gross_ticket_revenue, gross_product_revenue, total_refunds,
    platform_fees_excl_vat, platform_fees_vat, platform_fees_incl_vat,
    net_payout_amount, status
  ) VALUES (
    _org_id, _event_id, v_effective_start, v_effective_end,
    v_gross_ticket, v_gross_product, v_total_refunds,
    v_fees_excl, v_fees_vat, v_fees_incl,
    v_net_payout, 'pending'
  )
  RETURNING id INTO v_settlement_id;

  -- Create settlement lines (VAT breakdown by rate and category)
  -- Ticket lines grouped by VAT rate
  INSERT INTO public.settlement_lines (settlement_id, vat_percentage, category, revenue_incl_vat, revenue_excl_vat, vat_amount, item_count)
  SELECT
    v_settlement_id,
    oi.vat_percentage,
    'ticket',
    SUM(oi.total_price),
    SUM(oi.total_price - oi.vat_amount),
    SUM(oi.vat_amount),
    SUM(oi.quantity)
  FROM public.order_items oi
  JOIN public.orders o ON oi.order_id = o.id
  WHERE o.org_id = _org_id
    AND o.status = 'paid'
    AND o.created_at >= v_effective_start
    AND o.created_at < (v_effective_end + INTERVAL '1 day')
    AND oi.ticket_type_id IS NOT NULL
    AND (_event_id IS NULL OR o.event_id = _event_id)
  GROUP BY oi.vat_percentage;

  -- Product lines grouped by VAT rate
  INSERT INTO public.settlement_lines (settlement_id, vat_percentage, category, revenue_incl_vat, revenue_excl_vat, vat_amount, item_count)
  SELECT
    v_settlement_id,
    oi.vat_percentage,
    'product',
    SUM(oi.total_price),
    SUM(oi.total_price - oi.vat_amount),
    SUM(oi.vat_amount),
    SUM(oi.quantity)
  FROM public.order_items oi
  JOIN public.orders o ON oi.order_id = o.id
  WHERE o.org_id = _org_id
    AND o.status = 'paid'
    AND o.created_at >= v_effective_start
    AND o.created_at < (v_effective_end + INTERVAL '1 day')
    AND oi.product_id IS NOT NULL
    AND (_event_id IS NULL OR o.event_id = _event_id)
  GROUP BY oi.vat_percentage;

  RETURN v_settlement_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_settlement(UUID, UUID, DATE, DATE) TO service_role;

-- Generate platform invoice for an org over a period
CREATE OR REPLACE FUNCTION public.generate_platform_invoice(
  _org_id UUID,
  _period_start DATE,
  _period_end DATE,
  _event_ids UUID[] DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_id UUID;
  v_invoice_number TEXT;
  v_year INT;
  v_sequence INT;
  v_subtotal NUMERIC(10,2) := 0;
  v_vat_pct NUMERIC(4,2) := 21.00;
  v_vat_amount NUMERIC(10,2);
  v_total NUMERIC(10,2);
  v_platform_fee_pct NUMERIC(5,2) := 5.00;
  v_fee_config RECORD;
  v_org_settings JSONB;
  v_event RECORD;
BEGIN
  v_year := EXTRACT(YEAR FROM _period_end)::INT;

  -- Look up fee config
  SELECT pfc.percentage_rate, pfc.vat_percentage
  INTO v_fee_config
  FROM public.platform_fee_config pfc
  WHERE pfc.org_id = _org_id
    AND pfc.effective_from <= _period_end
    AND (pfc.effective_until IS NULL OR pfc.effective_until >= _period_start)
  ORDER BY pfc.effective_from DESC
  LIMIT 1;

  IF FOUND THEN
    v_platform_fee_pct := v_fee_config.percentage_rate;
    v_vat_pct := v_fee_config.vat_percentage;
  END IF;

  -- Get org settings for company info snapshot
  SELECT setting_value INTO v_org_settings
  FROM public.org_settings
  WHERE org_id = _org_id AND domain = 'payments';

  -- Get next sequence number directly (under advisory lock within the RPC)
  PERFORM pg_advisory_xact_lock(hashtext('platform_invoice_' || v_year::TEXT));

  SELECT COALESCE(MAX(invoice_sequence), 0) + 1
  INTO v_sequence
  FROM public.platform_invoices
  WHERE invoice_year = v_year;

  v_invoice_number := 'INV-' || v_year::TEXT || '-' || LPAD(v_sequence::TEXT, 4, '0');

  -- Create invoice (amounts filled after items)
  INSERT INTO public.platform_invoices (
    org_id, invoice_number, invoice_year, invoice_sequence,
    period_start, period_end, vat_percentage, status,
    org_company_name, org_vat_number, org_kvk_number
  ) VALUES (
    _org_id, v_invoice_number, v_year, v_sequence,
    _period_start, _period_end, v_vat_pct, 'draft',
    COALESCE((SELECT name FROM public.orgs WHERE id = _org_id), ''),
    COALESCE(v_org_settings->>'vat_number', ''),
    COALESCE(v_org_settings->>'kvk_number', '')
  )
  RETURNING id INTO v_invoice_id;

  -- Add line items per event
  FOR v_event IN
    SELECT
      e.id AS event_id,
      e.name AS event_name,
      COUNT(DISTINCT o.id) AS order_count,
      COALESCE(SUM(oi.quantity), 0) AS ticket_count,
      COALESCE(SUM(oi.total_price), 0) AS gross_revenue
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    JOIN public.events e ON o.event_id = e.id
    WHERE o.org_id = _org_id
      AND o.status = 'paid'
      AND o.created_at >= _period_start
      AND o.created_at < (_period_end + INTERVAL '1 day')
      AND (_event_ids IS NULL OR o.event_id = ANY(_event_ids))
    GROUP BY e.id, e.name
  LOOP
    INSERT INTO public.platform_invoice_items (
      invoice_id, event_id, description, order_count, ticket_count, gross_revenue, fee_amount
    ) VALUES (
      v_invoice_id,
      v_event.event_id,
      'Platform fee: ' || v_event.event_name,
      v_event.order_count,
      v_event.ticket_count,
      v_event.gross_revenue,
      ROUND(v_event.gross_revenue * v_platform_fee_pct / 100, 2)
    );

    v_subtotal := v_subtotal + ROUND(v_event.gross_revenue * v_platform_fee_pct / 100, 2);
  END LOOP;

  -- Calculate totals
  v_vat_amount := ROUND(v_subtotal * v_vat_pct / 100, 2);
  v_total := v_subtotal + v_vat_amount;

  -- Update invoice with totals
  UPDATE public.platform_invoices
  SET subtotal_amount = v_subtotal,
      vat_amount = v_vat_amount,
      total_amount = v_total
  WHERE id = v_invoice_id;

  RETURN v_invoice_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_platform_invoice(UUID, DATE, DATE, UUID[]) TO service_role;

-- =====================================================
-- 9. UPDATED_AT TRIGGERS
-- =====================================================

CREATE OR REPLACE FUNCTION public.set_platform_fee_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS platform_fee_config_updated_at ON public.platform_fee_config;
CREATE TRIGGER platform_fee_config_updated_at
BEFORE UPDATE ON public.platform_fee_config
FOR EACH ROW EXECUTE FUNCTION public.set_platform_fee_config_updated_at();

CREATE OR REPLACE FUNCTION public.set_platform_invoices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS platform_invoices_updated_at ON public.platform_invoices;
CREATE TRIGGER platform_invoices_updated_at
BEFORE UPDATE ON public.platform_invoices
FOR EACH ROW EXECUTE FUNCTION public.set_platform_invoices_updated_at();

CREATE OR REPLACE FUNCTION public.set_settlements_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS settlements_updated_at ON public.settlements;
CREATE TRIGGER settlements_updated_at
BEFORE UPDATE ON public.settlements
FOR EACH ROW EXECUTE FUNCTION public.set_settlements_updated_at();

-- =====================================================
-- VERIFICATION
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'platform_fee_config') THEN
    RAISE EXCEPTION 'platform_fee_config table not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'platform_invoices') THEN
    RAISE EXCEPTION 'platform_invoices table not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'platform_invoice_items') THEN
    RAISE EXCEPTION 'platform_invoice_items table not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'settlements') THEN
    RAISE EXCEPTION 'settlements table not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'settlement_lines') THEN
    RAISE EXCEPTION 'settlement_lines table not created';
  END IF;

  RAISE NOTICE '--- F006 S5b: Platform Invoices & Settlements ---';
  RAISE NOTICE 'platform_fee_config table created with RLS';
  RAISE NOTICE 'platform_invoices table created with RLS';
  RAISE NOTICE 'platform_invoice_items table created with RLS';
  RAISE NOTICE 'settlements table created with RLS';
  RAISE NOTICE 'settlement_lines table created with RLS';
  RAISE NOTICE 'RPCs: next_platform_invoice_number, generate_settlement, generate_platform_invoice';
  RAISE NOTICE 'All RLS policies restrict to owner/admin/finance roles';
END $$;
