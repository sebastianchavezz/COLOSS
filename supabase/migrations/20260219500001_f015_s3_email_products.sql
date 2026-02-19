-- ===========================================================================
-- F015 S3: Ticket Delivery Email uitbreiden met Product Info
-- Migration: 20260219500001_f015_s3_email_products.sql
--
-- Purpose:
-- - Voegt een "JE EXTRA'S" sectie toe aan de ticket delivery email
-- - Toont per product: naam, variant, quantity, en instructies
-- - Alleen als de order producten bevat
-- - HTML-escaped alle user content via html_escape()
-- - Styling consistent met bestaande dark theme email
--
-- Bron: 20260219100000_f007_s3_ticket_delivery_email.sql
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
    v_product       RECORD;
    v_email_id      UUID;
    v_html_body     TEXT;
    v_tickets_html  TEXT := '';
    v_products_html TEXT := '';
    v_ticket_count  INTEGER := 0;
    v_product_count INTEGER := 0;
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

    -- 6. HTML bouwen per product in de order
    FOR v_product IN
        SELECT
            pr.name AS product_name,
            pv.name AS variant_name,
            oi.quantity,
            pr.instructions
        FROM public.order_items oi
        JOIN public.products pr ON pr.id = oi.product_id
        LEFT JOIN public.product_variants pv ON pv.id = oi.product_variant_id
        WHERE oi.order_id = _order_id
          AND oi.product_id IS NOT NULL
        ORDER BY oi.id ASC
    LOOP
        v_product_count := v_product_count + 1;

        v_products_html := v_products_html || '
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:12px;">
                <tr>
                    <td style="background-color:#0a0a0a;border:1px solid #222;border-radius:2px;padding:20px;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                            <tr>
                                <td style="vertical-align:top;">
                                    <p style="margin:0 0 4px;color:#fff;font-size:16px;font-weight:500;">' || html_escape(v_product.product_name) || '</p>'
                                    || CASE WHEN v_product.variant_name IS NOT NULL THEN
                                        '<p style="margin:0 0 4px;color:#888;font-size:13px;">Variant: ' || html_escape(v_product.variant_name) || '</p>'
                                    ELSE '' END
                                    || '<p style="margin:0;color:#666;font-size:12px;">Aantal: ' || v_product.quantity || '</p>'
                                    || CASE WHEN v_product.instructions IS NOT NULL AND v_product.instructions != '' THEN
                                        '<div style="margin-top:12px;padding-top:12px;border-top:1px solid #222;">
                                            <p style="margin:0 0 4px;color:#666;font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;">INSTRUCTIES</p>
                                            <p style="margin:0;color:#ccc;font-size:13px;">' || html_escape(v_product.instructions) || '</p>
                                        </div>'
                                    ELSE '' END || '
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>';
    END LOOP;

    -- 7. Volledige HTML email body
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

' || CASE WHEN v_product_count > 0 THEN '
<!-- Divider before products -->
<div style="height:1px;background:linear-gradient(90deg,transparent,#333,transparent);margin:24px 0;"></div>

<!-- Products header -->
<p style="margin:0 0 16px;color:#666;font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;">JE EXTRA''S (' || v_product_count || ')</p>

' || v_products_html
ELSE '' END || '

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

    -- 8. Email queuen via queue_email() (idempotent via idempotency_key)
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

    -- 9. Resultaat
    RETURN jsonb_build_object(
        'status', 'queued',
        'email_id', v_email_id,
        'ticket_count', v_ticket_count,
        'product_count', v_product_count,
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
-- Verificatie
-- ===========================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'queue_ticket_delivery_email'
    ) THEN
        RAISE EXCEPTION 'queue_ticket_delivery_email() NOT FOUND after migration';
    END IF;
    RAISE NOTICE 'OK: queue_ticket_delivery_email() updated with product support';
    RAISE NOTICE '=== F015 S3: Email Products - Migration Complete ===';
END$$;
