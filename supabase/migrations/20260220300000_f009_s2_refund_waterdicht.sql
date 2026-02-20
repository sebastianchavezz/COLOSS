-- ===========================================================================
-- F009 S2: Refund Flow Waterdicht
-- Migration: 20260220300000_f009_s2_refund_waterdicht.sql
--
-- Purpose:
-- 1. Fix handle_refund_webhook: update order status to 'refunded' on full refund
-- 2. Ensure void_tickets_for_refund is up-to-date (already fixed in F006 S7)
--
-- The critical Mollie API endpoint bug is fixed in the Edge Function,
-- not in the migration.
-- ===========================================================================

-- ===========================================================================
-- STAP 1: handle_refund_webhook - add order status transition
-- ===========================================================================
-- Bij een volledige refund moet de order status naar 'refunded' gaan.
-- Dit was nooit geimplementeerd - de order bleef op 'paid'.

CREATE OR REPLACE FUNCTION public.handle_refund_webhook(
    _mollie_refund_id TEXT,
    _status TEXT,
    _refunded_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_refund      RECORD;
    v_new_status  refund_status;
    v_void_result JSONB;
BEGIN
    -- 1. Terugbetaling opzoeken via Mollie refund ID
    SELECT r.*,
           o.org_id,
           o.email AS order_email
    INTO v_refund
    FROM public.refunds r
    JOIN public.orders o ON o.id = r.order_id
    WHERE r.mollie_refund_id = _mollie_refund_id;

    IF v_refund.id IS NULL THEN
        RETURN jsonb_build_object('error', 'REFUND_NOT_FOUND');
    END IF;

    -- 2. Mollie status vertalen naar interne status
    v_new_status := CASE _status
        WHEN 'queued'     THEN 'queued'::refund_status
        WHEN 'pending'    THEN 'processing'::refund_status
        WHEN 'processing' THEN 'processing'::refund_status
        WHEN 'refunded'   THEN 'refunded'::refund_status
        WHEN 'failed'     THEN 'failed'::refund_status
        WHEN 'canceled'   THEN 'canceled'::refund_status
        ELSE 'processing'::refund_status
    END;

    -- 3. Refund status bijwerken
    UPDATE public.refunds
    SET status      = v_new_status,
        refunded_at = CASE
                          WHEN v_new_status = 'refunded'
                          THEN COALESCE(_refunded_at, NOW())
                          ELSE refunded_at
                      END
    WHERE id = v_refund.id;

    -- 4. Bij volledige terugbetaling: tickets ongeldig maken + order status updaten
    IF v_new_status = 'refunded' AND v_refund.is_full_refund THEN
        -- Void tickets (fixed in F006 S7 - correcte enum + kolommen)
        v_void_result := void_tickets_for_refund(v_refund.id);

        -- FIX: Update order status naar 'refunded'
        -- Dit was nooit geimplementeerd - de order bleef op 'paid'
        UPDATE public.orders
        SET status = 'refunded', updated_at = NOW()
        WHERE id = v_refund.order_id
          AND status = 'paid';
    END IF;

    -- 5. Bevestigingsmail queuen (non-fatal)
    IF v_new_status = 'refunded' AND NOT v_refund.email_sent THEN
        BEGIN
            PERFORM queue_refund_confirmation_email(v_refund.id);
            UPDATE public.refunds SET email_sent = true WHERE id = v_refund.id;
        EXCEPTION WHEN OTHERS THEN
            -- Email mislukken is NIET fataal - refund is al verwerkt
            RAISE WARNING 'Refund confirmation email failed for refund %: %', v_refund.id, SQLERRM;
        END;
    END IF;

    -- 6. Audit log
    INSERT INTO public.audit_log (
        org_id,
        action,
        resource_type,
        resource_id,
        entity_type,
        entity_id,
        details
    )
    VALUES (
        v_refund.org_id,
        'refund_status_updated',
        'refund',
        v_refund.id,
        'refund',
        v_refund.id,
        jsonb_build_object(
            'mollie_refund_id', _mollie_refund_id,
            'old_status',       v_refund.status,
            'new_status',       v_new_status,
            'void_result',      v_void_result
        )
    );

    RETURN jsonb_build_object(
        'success',        true,
        'refund_id',      v_refund.id,
        'old_status',     v_refund.status,
        'new_status',     v_new_status,
        'tickets_voided', COALESCE((v_void_result->>'voided_count')::INTEGER, 0) > 0,
        'order_refunded', v_new_status = 'refunded' AND v_refund.is_full_refund
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.handle_refund_webhook(TEXT, TEXT, TIMESTAMPTZ) TO service_role;

-- ===========================================================================
-- STAP 2: Verificatie
-- ===========================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'handle_refund_webhook') THEN
        RAISE EXCEPTION 'F009 S2: handle_refund_webhook not found';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'void_tickets_for_refund') THEN
        RAISE EXCEPTION 'F009 S2: void_tickets_for_refund not found';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'queue_refund_confirmation_email') THEN
        RAISE EXCEPTION 'F009 S2: queue_refund_confirmation_email not found';
    END IF;

    RAISE NOTICE 'F009 S2: All verifications passed!';
    RAISE NOTICE '  - handle_refund_webhook: now updates order status to refunded';
    RAISE NOTICE '  - void_tickets_for_refund: verified (fixed in F006 S7)';
    RAISE NOTICE '  - queue_refund_confirmation_email: verified';
END$$;
