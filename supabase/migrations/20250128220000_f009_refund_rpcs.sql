-- F009 Refund RPCs
-- Creates the RPC functions for refund management

-- 1. get_order_refund_summary: Get refundable info for an order
CREATE OR REPLACE FUNCTION public.get_order_refund_summary(_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order RECORD;
    v_user_id UUID;
    v_total_paid_cents INTEGER;
    v_total_refunded_cents INTEGER;
    v_pending_refunds_cents INTEGER;
    v_refundable_cents INTEGER;
    v_refunds JSONB;
BEGIN
    -- Get current user
    v_user_id := auth.uid();

    -- Get order with permission check
    SELECT o.id, o.org_id, o.status, o.total_amount,
           p.id as payment_id, p.provider_payment_id, p.status as payment_status
    INTO v_order
    FROM orders o
    LEFT JOIN payments p ON p.order_id = o.id AND p.status = 'paid'
    JOIN org_members om ON om.org_id = o.org_id
        AND om.user_id = v_user_id
        AND om.role IN ('owner', 'admin')
    WHERE o.id = _order_id;

    IF v_order.id IS NULL THEN
        RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND_OR_UNAUTHORIZED');
    END IF;

    IF v_order.status != 'paid' THEN
        RETURN jsonb_build_object('error', 'ORDER_NOT_PAID', 'status', v_order.status);
    END IF;

    -- Calculate amounts
    v_total_paid_cents := ROUND(v_order.total_amount * 100)::INTEGER;

    -- Get completed refunds
    SELECT COALESCE(SUM(amount_cents), 0)::INTEGER INTO v_total_refunded_cents
    FROM refunds
    WHERE order_id = _order_id AND status = 'refunded';

    -- Get pending refunds (not yet completed)
    SELECT COALESCE(SUM(amount_cents), 0)::INTEGER INTO v_pending_refunds_cents
    FROM refunds
    WHERE order_id = _order_id AND status IN ('pending', 'queued', 'processing');

    -- Calculate refundable
    v_refundable_cents := v_total_paid_cents - v_total_refunded_cents - v_pending_refunds_cents;

    -- Get refund history
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', r.id,
        'amount_cents', r.amount_cents,
        'status', r.status,
        'reason', r.reason,
        'created_at', r.created_at,
        'refunded_at', r.refunded_at,
        'mollie_refund_id', r.mollie_refund_id
    ) ORDER BY r.created_at DESC), '[]'::jsonb)
    INTO v_refunds
    FROM refunds r
    WHERE r.order_id = _order_id;

    RETURN jsonb_build_object(
        'order_id', _order_id,
        'order_status', v_order.status,
        'payment_id', v_order.payment_id,
        'mollie_payment_id', v_order.provider_payment_id,
        'total_paid_cents', v_total_paid_cents,
        'total_refunded_cents', v_total_refunded_cents,
        'pending_refunds_cents', v_pending_refunds_cents,
        'refundable_cents', v_refundable_cents,
        'can_refund', v_refundable_cents > 0,
        'refunds', v_refunds
    );
END;
$$;

-- 2. void_tickets_for_refund: Void tickets when refund is completed
CREATE OR REPLACE FUNCTION public.void_tickets_for_refund(_refund_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_refund RECORD;
    v_voided_count INTEGER := 0;
BEGIN
    -- Get refund
    SELECT r.*, o.org_id
    INTO v_refund
    FROM refunds r
    JOIN orders o ON o.id = r.order_id
    WHERE r.id = _refund_id;

    IF v_refund.id IS NULL THEN
        RETURN jsonb_build_object('error', 'REFUND_NOT_FOUND');
    END IF;

    -- Only void for completed full refunds
    IF v_refund.status != 'refunded' THEN
        RETURN jsonb_build_object('error', 'REFUND_NOT_COMPLETED', 'status', v_refund.status);
    END IF;

    IF NOT v_refund.is_full_refund THEN
        RETURN jsonb_build_object('success', true, 'voided_count', 0, 'reason', 'PARTIAL_REFUND');
    END IF;

    IF v_refund.tickets_voided THEN
        RETURN jsonb_build_object('success', true, 'voided_count', 0, 'reason', 'ALREADY_VOIDED');
    END IF;

    -- Void all tickets for this order
    UPDATE ticket_instances
    SET status = 'voided',
        voided_at = NOW(),
        voided_reason = 'Full refund: ' || _refund_id::TEXT
    WHERE order_id = v_refund.order_id
      AND status IN ('valid', 'issued');

    GET DIAGNOSTICS v_voided_count = ROW_COUNT;

    -- Mark refund as tickets voided
    UPDATE refunds
    SET tickets_voided = true
    WHERE id = _refund_id;

    -- Audit log
    INSERT INTO audit_log (org_id, action, resource_type, resource_id, entity_type, entity_id, details)
    VALUES (
        v_refund.org_id,
        'tickets_voided_for_refund',
        'refund',
        _refund_id,
        'refund',
        _refund_id,
        jsonb_build_object(
            'refund_id', _refund_id,
            'order_id', v_refund.order_id,
            'voided_count', v_voided_count
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'voided_count', v_voided_count,
        'refund_id', _refund_id
    );
END;
$$;

-- 3. handle_refund_webhook: Process Mollie refund status updates
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
    v_refund RECORD;
    v_new_status refund_status;
    v_void_result JSONB;
BEGIN
    -- Find refund by Mollie ID
    SELECT r.*, o.org_id, o.email as order_email
    INTO v_refund
    FROM refunds r
    JOIN orders o ON o.id = r.order_id
    WHERE r.mollie_refund_id = _mollie_refund_id;

    IF v_refund.id IS NULL THEN
        RETURN jsonb_build_object('error', 'REFUND_NOT_FOUND');
    END IF;

    -- Map Mollie status to our status
    v_new_status := CASE _status
        WHEN 'queued' THEN 'queued'::refund_status
        WHEN 'pending' THEN 'processing'::refund_status
        WHEN 'processing' THEN 'processing'::refund_status
        WHEN 'refunded' THEN 'refunded'::refund_status
        WHEN 'failed' THEN 'failed'::refund_status
        WHEN 'canceled' THEN 'canceled'::refund_status
        ELSE 'processing'::refund_status
    END;

    -- Update refund status
    UPDATE refunds
    SET status = v_new_status,
        refunded_at = CASE WHEN v_new_status = 'refunded' THEN COALESCE(_refunded_at, NOW()) ELSE refunded_at END
    WHERE id = v_refund.id;

    -- If refunded, void tickets for full refunds
    IF v_new_status = 'refunded' AND v_refund.is_full_refund THEN
        v_void_result := void_tickets_for_refund(v_refund.id);
    END IF;

    -- Queue email notification for completed refund
    IF v_new_status = 'refunded' AND NOT v_refund.email_sent THEN
        INSERT INTO email_outbox (
            org_id,
            template_type,
            recipient_email,
            payload,
            scheduled_for
        )
        VALUES (
            v_refund.org_id,
            'refund_confirmation',
            v_refund.order_email,
            jsonb_build_object(
                'refund_id', v_refund.id,
                'order_id', v_refund.order_id,
                'amount_cents', v_refund.amount_cents,
                'is_full_refund', v_refund.is_full_refund
            ),
            NOW()
        );

        UPDATE refunds SET email_sent = true WHERE id = v_refund.id;
    END IF;

    -- Audit log
    INSERT INTO audit_log (org_id, action, resource_type, resource_id, entity_type, entity_id, details)
    VALUES (
        v_refund.org_id,
        'refund_status_updated',
        'refund',
        v_refund.id,
        'refund',
        v_refund.id,
        jsonb_build_object(
            'mollie_refund_id', _mollie_refund_id,
            'old_status', v_refund.status,
            'new_status', v_new_status,
            'void_result', v_void_result
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'refund_id', v_refund.id,
        'old_status', v_refund.status,
        'new_status', v_new_status,
        'tickets_voided', COALESCE((v_void_result->>'voided_count')::INTEGER, 0) > 0
    );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_order_refund_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_tickets_for_refund(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_refund_webhook(TEXT, TEXT, TIMESTAMPTZ) TO service_role;

-- Verification
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_order_refund_summary') THEN
        RAISE EXCEPTION 'get_order_refund_summary not created';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'void_tickets_for_refund') THEN
        RAISE EXCEPTION 'void_tickets_for_refund not created';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'handle_refund_webhook') THEN
        RAISE EXCEPTION 'handle_refund_webhook not created';
    END IF;
    RAISE NOTICE 'F009: All refund RPCs created successfully';
END$$;
