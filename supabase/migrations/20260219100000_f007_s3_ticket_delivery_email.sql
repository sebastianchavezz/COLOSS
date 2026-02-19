-- ===========================================================================
-- F007 S3: Ticket Delivery Email + Payment Webhook Integration
-- ===========================================================================
-- Doel: Na succesvolle betaling automatisch tickets emailen naar de deelnemer.
--
-- STAP 1: queue_ticket_delivery_email() - Genereert HTML email met QR codes
--         en plaatst die in de email_outbox via queue_email() (F008).
--
-- STAP 2: handle_payment_webhook() - Uitgebreid met automatische email
--         queuing na succesvolle ticket uitgifte. Email failures zijn
--         NIET fataal: de betaling blijft geldig als de email mislukt.
--
-- Idempotency key: 'ticket-delivery:<order_id>'
-- ===========================================================================

-- ===========================================================================
-- STAP 0: HTML Escape helper (voorkomt XSS/HTML injection in emails)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.html_escape(input TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE STRICT
AS $$
  SELECT replace(replace(replace(replace(replace(
    input,
    '&', '&amp;'),
    '<', '&lt;'),
    '>', '&gt;'),
    '"', '&quot;'),
    '''', '&#39;')
$$;

-- ===========================================================================
-- STAP 1: queue_ticket_delivery_email()
-- ===========================================================================
-- Genereert een professionele HTML bevestigingsmail met QR codes voor alle
-- ticket_instances van een betaalde order, en plaatst die in de email_outbox.
--
-- Security: SECURITY DEFINER zodat de functie de benodigde tabellen kan lezen.
-- Alle user-supplied waarden worden ge-escaped via html_escape().
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.queue_ticket_delivery_email(_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_order         RECORD;
    v_event         RECORD;
    v_ticket        RECORD;
    v_email_id      UUID;
    v_html_body     TEXT;
    v_tickets_html  TEXT := '';
    v_ticket_count  INTEGER := 0;
    v_base_url      TEXT;
    v_tickets_url   TEXT;
    v_event_date    TEXT;
BEGIN
    -- 1. Order ophalen en valideren
    SELECT o.id, o.event_id, o.org_id, o.email, o.purchaser_name, o.total_amount, o.status
    INTO v_order
    FROM public.orders o
    WHERE o.id = _order_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'error', 'error', 'ORDER_NOT_FOUND', 'order_id', _order_id);
    END IF;

    IF v_order.status != 'paid' THEN
        RETURN jsonb_build_object('status', 'error', 'error', 'ORDER_NOT_PAID', 'order_status', v_order.status);
    END IF;

    -- 2. Event info ophalen
    SELECT e.name, e.start_time, COALESCE(e.location_name, '') AS location_name
    INTO v_event
    FROM public.events e
    WHERE e.id = v_order.event_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'error', 'error', 'EVENT_NOT_FOUND', 'event_id', v_order.event_id);
    END IF;

    -- 3. Datum formatteren
    v_event_date := to_char(v_event.start_time AT TIME ZONE 'Europe/Amsterdam', 'DD-MM-YYYY "om" HH24:MI');

    -- 4. Base URL bepalen
    BEGIN
        v_base_url := get_base_url();
    EXCEPTION WHEN OTHERS THEN
        v_base_url := 'https://coloss.nl';
    END;
    v_tickets_url := v_base_url || '/sporter/tickets';

    -- 5. HTML bouwen per ticket instance
    FOR v_ticket IN
        SELECT ti.id AS ticket_id, ti.qr_code, tt.name AS ticket_type_name, COALESCE(tt.price, 0) AS ticket_price
        FROM public.ticket_instances ti
        JOIN public.ticket_types tt ON tt.id = ti.ticket_type_id
        WHERE ti.order_id = _order_id AND ti.status = 'issued'
        ORDER BY ti.created_at ASC
    LOOP
        v_ticket_count := v_ticket_count + 1;

        v_tickets_html := v_tickets_html || '
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:16px;">
                <tr>
                    <td style="background-color:#0a0a0a;border:1px solid #222;border-radius:2px;padding:24px;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                            <tr>
                                <td style="vertical-align:top;padding-right:24px;">
                                    <p style="margin:0 0 4px;color:#666;font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;">TICKET ' || v_ticket_count || '</p>
                                    <p style="margin:0 0 8px;color:#fff;font-size:18px;font-weight:500;">' || html_escape(v_ticket.ticket_type_name) || '</p>
                                    <p style="margin:0;color:#888;font-size:12px;font-family:monospace;letter-spacing:1px;">ID: ' || LEFT(v_ticket.ticket_id::text, 8) || '</p>
                                </td>
                                <td style="vertical-align:top;text-align:right;width:120px;">
                                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&amp;data=' || replace(replace(v_ticket.qr_code, ' ', '%20'), '&', '%26') || '" alt="QR Code" width="100" height="100" style="display:block;border:2px solid #222;border-radius:2px;" />
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>';
    END LOOP;

    IF v_ticket_count = 0 THEN
        RETURN jsonb_build_object('status', 'error', 'error', 'NO_ISSUED_TICKETS', 'order_id', _order_id);
    END IF;

    -- 6. Volledige HTML email body
    v_html_body := '<!DOCTYPE html>
<html lang="nl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Je tickets voor ' || html_escape(v_event.name) || '</title></head>
<body style="margin:0;padding:0;background-color:#000;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#000;">
<tr><td align="center" style="padding:40px 20px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;">

<!-- Header -->
<tr><td align="center" style="padding-bottom:48px;">
<span style="font-size:32px;font-weight:700;color:#fff;letter-spacing:8px;text-transform:uppercase;">COLOSS</span>
</td></tr>

<!-- Card -->
<tr><td style="background:#0a0a0a;border:1px solid #222;border-radius:2px;padding:48px 40px;">

<!-- Badge -->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
<tr><td align="center" style="padding-bottom:32px;">
<span style="display:inline-block;padding:8px 24px;border:1px solid #10b981;color:#10b981;font-size:11px;font-weight:600;letter-spacing:3px;text-transform:uppercase;">INSCHRIJVING BEVESTIGD</span>
</td></tr>
</table>

<!-- Groet -->
<p style="margin:0 0 8px;color:#888;font-size:14px;">Hoi ' || html_escape(COALESCE(v_order.purchaser_name, 'daar')) || ',</p>
<h1 style="margin:0 0 32px;color:#fff;font-size:24px;font-weight:300;line-height:1.4;">
Je inschrijving voor <span style="color:#10b981;font-weight:600;">' || html_escape(v_event.name) || '</span> is bevestigd!
</h1>

<!-- Divider -->
<div style="height:1px;background:linear-gradient(90deg,transparent,#333,transparent);margin-bottom:32px;"></div>

<!-- Event Details -->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:32px;">
<tr><td style="background:#080808;border:1px solid #222;border-radius:2px;padding:24px;">
<p style="margin:0 0 16px;color:#666;font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;">EVENEMENT DETAILS</p>
<p style="margin:0 0 8px;color:#ccc;font-size:14px;">&#128197; ' || v_event_date || '</p>
' || CASE WHEN v_event.location_name != '' THEN '<p style="margin:0;color:#ccc;font-size:14px;">&#128205; ' || html_escape(v_event.location_name) || '</p>' ELSE '' END || '
</td></tr>
</table>

<!-- Tickets header -->
<p style="margin:0 0 16px;color:#666;font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;">JE TICKETS (' || v_ticket_count || ')</p>

' || v_tickets_html || '

<!-- Divider -->
<div style="height:1px;background:linear-gradient(90deg,transparent,#333,transparent);margin:24px 0;"></div>

<!-- CTA -->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:32px;">
<tr><td align="center">
<a href="' || v_tickets_url || '" style="display:inline-block;padding:14px 32px;background-color:#10b981;color:#000;font-size:14px;font-weight:600;text-decoration:none;letter-spacing:1px;text-transform:uppercase;border-radius:2px;">Bekijk mijn tickets</a>
</td></tr>
</table>

<p style="margin:0;color:#666;font-size:13px;text-align:center;">Tot op het evenement!</p>
<p style="margin:8px 0 0;color:#444;font-size:12px;text-align:center;">Het COLOSS team</p>

</td></tr>

<!-- Footer -->
<tr><td align="center" style="padding-top:32px;">
<p style="margin:0;color:#333;font-size:11px;letter-spacing:1px;text-transform:uppercase;">COLOSS &mdash; Sport Evenementen Platform</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>';

    -- 7. Email queuen via queue_email() (idempotent via idempotency_key)
    v_email_id := queue_email(
        _org_id          := v_order.org_id,
        _event_id        := v_order.event_id,
        _idempotency_key := 'ticket-delivery:' || _order_id::text,
        _to_email        := v_order.email,
        _subject         := 'Je tickets voor ' || regexp_replace(v_event.name, E'[\\r\\n]', '', 'g'),
        _html_body       := v_html_body,
        _email_type      := 'transactional',
        _from_name       := 'COLOSS',
        _from_email      := 'noreply@coloss.nl'
    );

    -- 8. Resultaat
    RETURN jsonb_build_object(
        'status', 'queued',
        'email_id', v_email_id,
        'ticket_count', v_ticket_count,
        'to_email', v_order.email,
        'order_id', _order_id
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'status', 'error',
        'error', SQLERRM,
        'sqlstate', SQLSTATE,
        'order_id', _order_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.queue_ticket_delivery_email(UUID) TO service_role;

-- ===========================================================================
-- STAP 2: handle_payment_webhook met email queuing
-- ===========================================================================
-- Volledige herschrijving met email integratie.
-- Email failures zijn NIET fataal: betaling blijft geldig.
-- ===========================================================================

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
  v_order            RECORD;
  v_order_item       RECORD;
  v_ticket_type      RECORD;
  v_sold_count       INTEGER;
  v_available        INTEGER;
  v_is_overbooked    BOOLEAN := FALSE;
  v_tickets_issued   INTEGER := 0;
  v_existing_tickets INTEGER := 0;
  v_payment_status   payment_status;
  v_email_result     JSONB;
BEGIN
  -- 1. Payment status enum cast (met fallback)
  BEGIN
    v_payment_status := _status::payment_status;
  EXCEPTION WHEN OTHERS THEN
    v_payment_status := 'open'::payment_status;
  END;

  -- 2. Payments tabel bijwerken
  UPDATE public.payments
  SET status = v_payment_status, updated_at = NOW()
  WHERE provider = 'mollie' AND provider_payment_id = _payment_id;

  -- 3. Order ophalen (FOR UPDATE lock)
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

    -- Idempotent: al betaald
    IF v_order.status = 'paid' THEN
      RETURN jsonb_build_object('paid', false, 'message', 'Order already paid');
    END IF;

    -- Order → paid
    UPDATE public.orders SET status = 'paid', updated_at = NOW() WHERE id = _order_id;

    -- Legacy tickets bijwerken
    UPDATE public.tickets SET status = 'valid'::ticket_status, updated_at = NOW()
    WHERE order_id = _order_id AND status = 'pending';

    -- Registraties bevestigen
    UPDATE public.registrations SET status = 'confirmed', updated_at = NOW()
    WHERE id IN (SELECT registration_id FROM public.tickets WHERE order_id = _order_id)
      AND status = 'pending';

    -- 5. Ticket instances uitgeven
    FOR v_order_item IN
      SELECT oi.id, oi.ticket_type_id, oi.quantity
      FROM public.order_items oi
      WHERE oi.order_id = _order_id AND oi.ticket_type_id IS NOT NULL
    LOOP
      -- Idempotency check
      SELECT COUNT(*) INTO v_existing_tickets
      FROM public.ticket_instances ti WHERE ti.order_item_id = v_order_item.id;

      IF v_existing_tickets > 0 THEN
        v_tickets_issued := v_tickets_issued + v_existing_tickets;
        CONTINUE;
      END IF;

      -- Capaciteitscheck
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
          UPDATE public.orders SET status = 'cancelled', updated_at = NOW() WHERE id = _order_id;
          RETURN jsonb_build_object(
            'paid', false, 'overbooked', true,
            'message', 'Capacity exceeded. Order cancelled.',
            'ticket_type', v_ticket_type.name,
            'available', v_available, 'requested', v_order_item.quantity
          );
        END IF;

        -- Tickets uitgieven
        WITH ticket_numbers AS (
          SELECT generate_series(1, v_order_item.quantity) AS seq
        )
        INSERT INTO public.ticket_instances (
          event_id, ticket_type_id, order_id, order_item_id, sequence_no,
          owner_user_id, token_hash, qr_code, status
        )
        SELECT
          v_order.event_id, v_order_item.ticket_type_id, _order_id, v_order_item.id,
          ticket_numbers.seq, v_order.user_id,
          encode(digest(gen_random_uuid()::text::bytea, 'sha256'), 'hex'),
          gen_random_uuid()::text, 'issued'::ticket_instance_status
        FROM ticket_numbers;

        GET DIAGNOSTICS v_tickets_issued = ROW_COUNT;
      END IF;
    END LOOP;

    -- 6. Ticket delivery email queuen (NIET fataal)
    BEGIN
      v_email_result := queue_ticket_delivery_email(_order_id);
    EXCEPTION WHEN OTHERS THEN
      v_email_result := jsonb_build_object('status', 'error', 'error', SQLERRM);
    END;

    -- 7. Resultaat
    RETURN jsonb_build_object(
      'paid', true,
      'order_id', _order_id,
      'tickets_issued', v_tickets_issued,
      'email_queued', COALESCE((v_email_result->>'status') = 'queued', false),
      'email_result', v_email_result
    );

  ELSIF _status IN ('failed', 'expired', 'canceled') THEN
    IF v_order.status = 'pending' THEN
      UPDATE public.orders SET status = 'cancelled', updated_at = NOW() WHERE id = _order_id;
      UPDATE public.tickets SET status = 'cancelled'::ticket_status, updated_at = NOW() WHERE order_id = _order_id;
    END IF;
    RETURN jsonb_build_object('paid', false, 'cancelled', true, 'reason', _status);

  ELSE
    RETURN jsonb_build_object('paid', false, 'status', _status, 'message', 'No action for this status');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.handle_payment_webhook(UUID, TEXT, TEXT, NUMERIC, TEXT) TO service_role;

-- ===========================================================================
-- STAP 3: Verificatie
-- ===========================================================================

DO $$
DECLARE
    v_fn_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'queue_ticket_delivery_email'
    ) INTO v_fn_exists;
    IF NOT v_fn_exists THEN RAISE EXCEPTION 'queue_ticket_delivery_email() NOT FOUND'; END IF;
    RAISE NOTICE 'OK: queue_ticket_delivery_email() created';

    SELECT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'handle_payment_webhook'
    ) INTO v_fn_exists;
    IF NOT v_fn_exists THEN RAISE EXCEPTION 'handle_payment_webhook() NOT FOUND'; END IF;
    RAISE NOTICE 'OK: handle_payment_webhook() updated with email support';

    RAISE NOTICE '=== F007 S3: Ticket Delivery Email - Migration Complete ===';
END$$;
