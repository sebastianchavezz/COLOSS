-- ===========================================================================
-- F006 S7: Ticket Flow Waterdicht
-- Migration: 20260220100000_f006_s7_ticket_flow_waterdicht.sql
--
-- Purpose:
-- Fixes all critical bugs in the ticket flow to make it production-ready:
-- 1. Fix QR code generation (token_hash derived from qr_code)
-- 2. Fix void_tickets_for_refund (wrong enum, non-existent columns)
-- 3. Lock down INSERT RLS policies on ticket tables
-- 4. Fix handle_payment_webhook capacity + QR code generation
-- 5. Add cleanup_expired_transfers function
-- 6. Add overbooked order notification in webhook
-- 7. Backfill existing tickets with correct token_hash
--
-- Security: RLS INSERT policies locked to false (service role bypasses RLS)
-- ===========================================================================

-- ===========================================================================
-- STAP 1: Backfill bestaande tickets - fix token_hash mismatch
-- ===========================================================================
-- Bestaande tickets hebben mismatched token_hash/qr_code.
-- Fix: token_hash = sha256(qr_code) zodat scanning werkt.

DO $$
DECLARE
  v_fixed_count INTEGER;
BEGIN
  UPDATE public.ticket_instances
  SET token_hash = encode(extensions.digest(qr_code::bytea, 'sha256'::text), 'hex')
  WHERE qr_code IS NOT NULL
    AND token_hash IS NOT NULL
    AND token_hash != encode(extensions.digest(qr_code::bytea, 'sha256'::text), 'hex');

  GET DIAGNOSTICS v_fixed_count = ROW_COUNT;
  RAISE NOTICE 'F006 S7: Backfilled % ticket instances with corrected token_hash', v_fixed_count;
END$$;

-- ===========================================================================
-- STAP 2: Lock down INSERT RLS policies op ticket tabellen
-- ===========================================================================
-- KRITIEK: Huidige policies staan elke authenticated user toe om tickets aan te maken.
-- Ticket creatie MOET via SECURITY DEFINER functies (handle_payment_webhook, issue-tickets).
-- SECURITY DEFINER functies draaien als definer en bypassen RLS, dus WITH CHECK (false) blokkeert
-- alleen directe client INSERT, niet de server-side functies.

-- ticket_instances: verwijder open INSERT policy
DROP POLICY IF EXISTS "System can create ticket instances" ON public.ticket_instances;

-- Nieuwe policy: blokkeer directe INSERT (service role bypassed RLS sowieso)
CREATE POLICY "Deny direct ticket instance creation"
    ON public.ticket_instances
    FOR INSERT
    WITH CHECK (false);

-- tickets (legacy): verwijder open INSERT policy
DROP POLICY IF EXISTS "System/Users can create tickets" ON public.tickets;

-- Nieuwe policy: blokkeer directe INSERT
CREATE POLICY "Deny direct ticket creation"
    ON public.tickets
    FOR INSERT
    WITH CHECK (false);

-- NOTICE: INSERT RLS policies locked down on ticket_instances and tickets

-- ===========================================================================
-- STAP 3: Fix handle_payment_webhook - QR code generatie + overbooked handling
-- ===========================================================================
-- Fixes:
-- 1. QR code en token_hash uit ZELFDE UUID (via lateral join)
-- 2. Overbooked orders krijgen email notificatie + audit log

CREATE OR REPLACE FUNCTION public.handle_payment_webhook(
  _order_id UUID,
  _payment_id TEXT,
  _status TEXT,
  _amount NUMERIC,
  _currency TEXT DEFAULT 'EUR'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_order                      RECORD;
  v_order_item                 RECORD;
  v_ticket_type                RECORD;
  v_sold_count                 INTEGER;
  v_available                  INTEGER;
  v_is_overbooked              BOOLEAN := FALSE;
  v_tickets_issued             INTEGER := 0;
  v_existing_tickets           INTEGER := 0;
  v_payment_status             payment_status;
  v_batch_count                INTEGER := 0;
  v_confirmation_email_result  JSONB;
  v_delivery_email_result      JSONB;
BEGIN
  -- 1. Payment status enum cast (met fallback naar 'open')
  BEGIN
    v_payment_status := _status::payment_status;
  EXCEPTION WHEN OTHERS THEN
    v_payment_status := 'open'::payment_status;
  END;

  -- 2. Payments tabel bijwerken
  UPDATE public.payments
  SET status = v_payment_status, updated_at = NOW()
  WHERE provider = 'mollie' AND provider_payment_id = _payment_id;

  -- 3. Order ophalen met row-level lock
  SELECT id, event_id, org_id, status, total_amount, email, user_id, purchaser_name
  INTO v_order
  FROM public.orders
  WHERE id = _order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND', 'paid', false);
  END IF;

  -- 4. Status transitie
  IF _status = 'paid' THEN

    -- Idempotent: order is al betaald, geen dubbele verwerking
    IF v_order.status = 'paid' THEN
      RETURN jsonb_build_object('paid', false, 'message', 'Order already paid');
    END IF;

    -- Order -> paid
    UPDATE public.orders SET status = 'paid', updated_at = NOW() WHERE id = _order_id;

    -- Legacy tickets bijwerken (backwards compat)
    UPDATE public.tickets
    SET status = 'valid'::ticket_status, updated_at = NOW()
    WHERE order_id = _order_id AND status = 'pending';

    -- Registraties bevestigen
    UPDATE public.registrations
    SET status = 'confirmed', updated_at = NOW()
    WHERE id IN (
        SELECT registration_id FROM public.tickets WHERE order_id = _order_id
    ) AND status = 'pending';

    -- 5. Ticket instances uitgeven (per order_item met ticket_type)
    FOR v_order_item IN
      SELECT oi.id, oi.ticket_type_id, oi.quantity
      FROM public.order_items oi
      WHERE oi.order_id = _order_id AND oi.ticket_type_id IS NOT NULL
    LOOP
      -- Idempotency: al uitgegeven tickets overslaan
      SELECT COUNT(*) INTO v_existing_tickets
      FROM public.ticket_instances ti
      WHERE ti.order_item_id = v_order_item.id;

      IF v_existing_tickets > 0 THEN
        v_tickets_issued := v_tickets_issued + v_existing_tickets;
        CONTINUE;
      END IF;

      -- Capaciteitscheck met row-level lock op ticket_type
      SELECT tt.id, tt.name, tt.capacity_total
      INTO v_ticket_type
      FROM public.ticket_types tt
      WHERE tt.id = v_order_item.ticket_type_id
      FOR UPDATE;

      IF FOUND THEN
        SELECT COALESCE(COUNT(*), 0) INTO v_sold_count
        FROM public.ticket_instances ti
        WHERE ti.ticket_type_id = v_order_item.ticket_type_id
          AND ti.status IN ('issued', 'checked_in');

        v_available := COALESCE(v_ticket_type.capacity_total, 999999) - v_sold_count;

        IF v_available < v_order_item.quantity THEN
          v_is_overbooked := TRUE;

          -- Cancel de order
          UPDATE public.orders SET status = 'cancelled', updated_at = NOW() WHERE id = _order_id;

          -- Audit log voor overbooked order
          INSERT INTO public.audit_log (
            org_id, actor_user_id, action, entity_type, entity_id, metadata
          ) VALUES (
            v_order.org_id,
            NULL,
            'ORDER_OVERBOOKED_CANCELLED',
            'order',
            _order_id,
            jsonb_build_object(
              'ticket_type', v_ticket_type.name,
              'ticket_type_id', v_ticket_type.id,
              'available', v_available,
              'requested', v_order_item.quantity,
              'payment_id', _payment_id,
              'amount', _amount
            )
          );

          -- Queue overbooked notificatie email naar klant
          BEGIN
            INSERT INTO public.email_outbox (
              org_id,
              event_id,
              idempotency_key,
              from_name,
              from_email,
              to_email,
              subject,
              html_body,
              scheduled_at,
              status
            ) VALUES (
              v_order.org_id,
              v_order.event_id,
              'overbooked:' || _order_id::text,
              'COLOSS',
              'noreply@coloss.nl',
              v_order.email,
              'Je bestelling kon niet worden verwerkt',
              '<p>Hoi ' || COALESCE(v_order.purchaser_name, 'daar') || ',</p>'
                || '<p>Helaas was het tickettype <strong>' || v_ticket_type.name || '</strong> uitverkocht op het moment dat je betaling binnenkwam.</p>'
                || '<p>Je bestelling (€' || _amount::text || ') is geannuleerd en je ontvangt automatisch een terugbetaling.</p>'
                || '<p>Excuses voor het ongemak.</p>',
              NOW(),
              'queued'
            );
          EXCEPTION WHEN OTHERS THEN
            -- Email queue failure is non-fatal
            NULL;
          END;

          RETURN jsonb_build_object(
            'paid',       false,
            'overbooked', true,
            'message',    'Capacity exceeded. Order cancelled. Customer notified.',
            'ticket_type', v_ticket_type.name,
            'available',   v_available,
            'requested',   v_order_item.quantity
          );
        END IF;

        -- FIX: Genereer 1 raw token per ticket, leid qr_code EN token_hash daarvan af
        -- Voorheen werden twee aparte gen_random_uuid() calls gebruikt,
        -- waardoor token_hash != sha256(qr_code) en scanning NIET werkte.
        -- LATERAL subquery garandeert unieke UUID per rij, en dezelfde UUID
        -- wordt gebruikt voor zowel qr_code als token_hash.
        INSERT INTO public.ticket_instances (
          event_id, ticket_type_id, order_id, order_item_id, sequence_no,
          owner_user_id, token_hash, qr_code, status
        )
        SELECT
          v_order.event_id,
          v_order_item.ticket_type_id,
          _order_id,
          v_order_item.id,
          gs.seq,
          v_order.user_id,
          encode(digest(t.raw_token::bytea, 'sha256'), 'hex'),
          t.raw_token,
          'issued'::ticket_instance_status
        FROM generate_series(1, v_order_item.quantity) AS gs(seq)
        CROSS JOIN LATERAL (SELECT gen_random_uuid()::text AS raw_token) AS t;

        GET DIAGNOSTICS v_batch_count = ROW_COUNT;
        v_tickets_issued := v_tickets_issued + v_batch_count;
      END IF;
    END LOOP;

    -- 6. Bestelbevestiging email queuen (NIET fataal)
    BEGIN
      v_confirmation_email_result := queue_order_confirmation_email(_order_id);
    EXCEPTION WHEN OTHERS THEN
      v_confirmation_email_result := jsonb_build_object(
        'status', 'error',
        'error',  SQLERRM
      );
    END;

    -- 7. Ticket delivery email queuen (NIET fataal)
    BEGIN
      v_delivery_email_result := queue_ticket_delivery_email(_order_id);
    EXCEPTION WHEN OTHERS THEN
      v_delivery_email_result := jsonb_build_object(
        'status', 'error',
        'error',  SQLERRM
      );
    END;

    -- 8. Resultaat
    RETURN jsonb_build_object(
      'paid',                       true,
      'order_id',                   _order_id,
      'tickets_issued',             v_tickets_issued,
      'order_confirmation_queued',  COALESCE((v_confirmation_email_result->>'status') = 'queued', false),
      'order_confirmation_result',  v_confirmation_email_result,
      'email_queued',               COALESCE((v_delivery_email_result->>'status') = 'queued', false),
      'email_result',               v_delivery_email_result
    );

  ELSIF _status IN ('failed', 'expired', 'canceled') THEN
    -- Betaling mislukt: order en legacy tickets annuleren
    IF v_order.status = 'pending' THEN
      UPDATE public.orders SET status = 'cancelled', updated_at = NOW() WHERE id = _order_id;
      UPDATE public.tickets
      SET status = 'cancelled'::ticket_status, updated_at = NOW()
      WHERE order_id = _order_id;
    END IF;
    RETURN jsonb_build_object('paid', false, 'cancelled', true, 'reason', _status);

  ELSE
    -- Overige statussen (open, etc.): geen actie
    RETURN jsonb_build_object('paid', false, 'status', _status, 'message', 'No action for this status');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.handle_payment_webhook(UUID, TEXT, TEXT, NUMERIC, TEXT) TO service_role;

-- ===========================================================================
-- STAP 4: Fix void_tickets_for_refund
-- ===========================================================================
-- Fixes:
-- 1. 'voided' -> 'void' (correcte enum waarde)
-- 2. Verwijder voided_at/voided_reason (bestaan niet)
-- 3. 'valid' -> alleen 'issued' (correcte enum)
-- 4. Fix audit_log kolom namen (resource_type -> entity_type, etc.)

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

    -- Void all ticket instances for this order
    -- FIX: 'voided' -> 'void' (correcte ticket_instance_status enum)
    -- FIX: verwijder voided_at/voided_reason (bestaan niet op ticket_instances)
    -- FIX: 'valid' is geen geldige enum waarde, alleen 'issued' filteren
    UPDATE ticket_instances
    SET status = 'void'::ticket_instance_status,
        updated_at = NOW()
    WHERE order_id = v_refund.order_id
      AND status = 'issued'::ticket_instance_status;

    GET DIAGNOSTICS v_voided_count = ROW_COUNT;

    -- Mark refund as tickets voided
    UPDATE refunds
    SET tickets_voided = true
    WHERE id = _refund_id;

    -- Audit log
    -- FIX: gebruik correcte kolom namen (entity_type/entity_id/metadata ipv resource_type/resource_id/details)
    INSERT INTO audit_log (org_id, action, entity_type, entity_id, metadata)
    VALUES (
        v_refund.org_id,
        'tickets_voided_for_refund',
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

GRANT EXECUTE ON FUNCTION public.void_tickets_for_refund(UUID) TO service_role;

-- ===========================================================================
-- STAP 5: cleanup_expired_transfers (NIEUW)
-- ===========================================================================
-- Verloopt pending transfers die hun expires_at hebben gepasseerd.
-- Dit voorkomt dat de unique partial index (idx_transfers_unique_pending)
-- nieuwe transfers voor hetzelfde ticket blokkeert.

CREATE OR REPLACE FUNCTION public.cleanup_expired_transfers()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH expired AS (
    UPDATE public.ticket_transfers
    SET status = 'expired',
        updated_at = NOW()
    WHERE status = 'pending'
      AND expires_at < NOW()
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM expired;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_expired_transfers() TO service_role;

COMMENT ON FUNCTION public.cleanup_expired_transfers IS
  'Expires pending transfers past their expires_at. Should be called periodically via cron/Edge Function.';

-- ===========================================================================
-- STAP 6: cleanup-jobs Edge Function support
-- ===========================================================================
-- Maak cleanup_stale_pending_orders ook aanroepbaar (bestaat al, maar grant check)
-- Al bestaand, maar zorg dat grants correct zijn
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'cleanup_stale_pending_orders') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.cleanup_stale_pending_orders() TO service_role';
    RAISE NOTICE 'F006 S7: cleanup_stale_pending_orders grant verified';
  ELSE
    RAISE NOTICE 'F006 S7: cleanup_stale_pending_orders does not exist yet';
  END IF;
END$$;

-- ===========================================================================
-- STAP 7: Verificatie
-- ===========================================================================
DO $$
DECLARE
  v_policy_count INTEGER;
  v_backfill_mismatches INTEGER;
BEGIN
  -- Verify RLS policies are locked
  SELECT COUNT(*) INTO v_policy_count
  FROM pg_policies
  WHERE tablename = 'ticket_instances'
    AND policyname = 'Deny direct ticket instance creation';

  IF v_policy_count = 0 THEN
    RAISE EXCEPTION 'F006 S7: ticket_instances INSERT deny policy NOT found';
  END IF;

  SELECT COUNT(*) INTO v_policy_count
  FROM pg_policies
  WHERE tablename = 'tickets'
    AND policyname = 'Deny direct ticket creation';

  IF v_policy_count = 0 THEN
    RAISE EXCEPTION 'F006 S7: tickets INSERT deny policy NOT found';
  END IF;

  -- Verify no more token_hash mismatches
  SELECT COUNT(*) INTO v_backfill_mismatches
  FROM public.ticket_instances
  WHERE qr_code IS NOT NULL
    AND token_hash IS NOT NULL
    AND token_hash != encode(extensions.digest(qr_code::bytea, 'sha256'::text), 'hex');

  IF v_backfill_mismatches > 0 THEN
    RAISE EXCEPTION 'F006 S7: Still % ticket instances with mismatched token_hash', v_backfill_mismatches;
  END IF;

  -- Verify functions exist
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'cleanup_expired_transfers') THEN
    RAISE EXCEPTION 'F006 S7: cleanup_expired_transfers not created';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'void_tickets_for_refund') THEN
    RAISE EXCEPTION 'F006 S7: void_tickets_for_refund not created';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'handle_payment_webhook') THEN
    RAISE EXCEPTION 'F006 S7: handle_payment_webhook not created';
  END IF;

  RAISE NOTICE 'F006 S7: All verifications passed!';
  RAISE NOTICE '  - INSERT RLS policies locked on ticket_instances and tickets';
  RAISE NOTICE '  - Token hash backfill complete (0 mismatches)';
  RAISE NOTICE '  - cleanup_expired_transfers created';
  RAISE NOTICE '  - void_tickets_for_refund fixed';
  RAISE NOTICE '  - handle_payment_webhook fixed (QR + overbooked handling)';
END$$;
