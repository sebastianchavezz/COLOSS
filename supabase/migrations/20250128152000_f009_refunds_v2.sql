-- F009 Refunds - Fix migration (tables may not have been created)
-- This is idempotent - safe to run multiple times

-- 1. ENUM (if not exists)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'refund_status') THEN
        CREATE TYPE refund_status AS ENUM (
            'pending', 'queued', 'processing', 'refunded', 'failed', 'canceled'
        );
    END IF;
END$$;

-- 2. REFUNDS TABLE (if not exists)
CREATE TABLE IF NOT EXISTS public.refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.orgs(id) ON DELETE RESTRICT,
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
    payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
    mollie_refund_id TEXT UNIQUE,
    mollie_payment_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    currency TEXT NOT NULL DEFAULT 'EUR',
    status refund_status NOT NULL DEFAULT 'pending',
    reason TEXT,
    internal_note TEXT,
    description TEXT,
    idempotency_key UUID NOT NULL UNIQUE,
    is_full_refund BOOLEAN NOT NULL DEFAULT false,
    tickets_voided BOOLEAN NOT NULL DEFAULT false,
    email_sent BOOLEAN NOT NULL DEFAULT false,
    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    refunded_at TIMESTAMPTZ
);

-- 3. REFUND_ITEMS TABLE (if not exists)
CREATE TABLE IF NOT EXISTS public.refund_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    refund_id UUID NOT NULL REFERENCES public.refunds(id) ON DELETE CASCADE,
    order_item_id UUID NOT NULL REFERENCES public.order_items(id) ON DELETE RESTRICT,
    ticket_instance_id UUID REFERENCES public.ticket_instances(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(refund_id, order_item_id)
);

-- 4. INDEXES (idempotent)
CREATE INDEX IF NOT EXISTS idx_refunds_org_id ON public.refunds(org_id);
CREATE INDEX IF NOT EXISTS idx_refunds_order_id ON public.refunds(order_id);
CREATE INDEX IF NOT EXISTS idx_refunds_payment_id ON public.refunds(payment_id);
CREATE INDEX IF NOT EXISTS idx_refunds_status ON public.refunds(status);
CREATE INDEX IF NOT EXISTS idx_refunds_mollie_refund_id ON public.refunds(mollie_refund_id) WHERE mollie_refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_refunds_created_at ON public.refunds(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refund_items_refund_id ON public.refund_items(refund_id);

-- 5. TRIGGER
CREATE OR REPLACE FUNCTION public.set_refunds_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS refunds_updated_at ON public.refunds;
CREATE TRIGGER refunds_updated_at
BEFORE UPDATE ON public.refunds
FOR EACH ROW EXECUTE FUNCTION public.set_refunds_updated_at();

-- 6. RLS
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org admins can view refunds" ON public.refunds;
DROP POLICY IF EXISTS "Org admins can create refunds" ON public.refunds;
DROP POLICY IF EXISTS "View refund items via parent" ON public.refund_items;
DROP POLICY IF EXISTS "Insert refund items via parent" ON public.refund_items;

CREATE POLICY "Org admins can view refunds"
ON public.refunds FOR SELECT TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.org_members om
    WHERE om.org_id = refunds.org_id AND om.user_id = auth.uid() AND om.role IN ('owner', 'admin')
));

CREATE POLICY "Org admins can create refunds"
ON public.refunds FOR INSERT TO authenticated
WITH CHECK (EXISTS (
    SELECT 1 FROM public.org_members om
    WHERE om.org_id = refunds.org_id AND om.user_id = auth.uid() AND om.role IN ('owner', 'admin')
));

CREATE POLICY "View refund items via parent"
ON public.refund_items FOR SELECT TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.refunds r
    JOIN public.org_members om ON om.org_id = r.org_id
    WHERE r.id = refund_items.refund_id AND om.user_id = auth.uid() AND om.role IN ('owner', 'admin')
));

CREATE POLICY "Insert refund items via parent"
ON public.refund_items FOR INSERT TO authenticated
WITH CHECK (EXISTS (
    SELECT 1 FROM public.refunds r
    JOIN public.org_members om ON om.org_id = r.org_id
    WHERE r.id = refund_items.refund_id AND om.user_id = auth.uid() AND om.role IN ('owner', 'admin')
));

-- 7. GRANTS
GRANT SELECT, INSERT ON public.refunds TO authenticated;
GRANT SELECT, INSERT ON public.refund_items TO authenticated;
GRANT UPDATE ON public.refunds TO service_role;

-- 8. VERIFICATION
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'refunds') THEN
        RAISE EXCEPTION 'refunds table not created';
    END IF;
    RAISE NOTICE 'F009: Refund tables verified';
END$$;
