# F007 S3 - Ticket Delivery: Email + PDF + In-App View

## Sprint Goal
Na succesvolle betaling ontvangt de deelnemer een email met ticket(s) inclusief QR code,
kan tickets downloaden als PDF, en kan ze in-app bekijken via "Mijn Tickets".

## Current State Analysis

### Wat al werkt:
- `ticket_instances` worden aangemaakt door `handle_payment_webhook` na payment success
- `email_outbox` + `process-outbox` pattern voor email delivery via Resend
- `queue_email()` RPC voor idempotent email queueing
- MijnTickets pagina toont tickets met QR code modal

### Wat ontbreekt:
1. **Geen ticket delivery email** - `handle_payment_webhook` queued een confirmation email met verkeerde kolommen (broken INSERT)
2. **Geen PDF generatie** - Geen Edge Function voor PDF tickets
3. **Geen download knop** - MijnTickets heeft geen PDF download

### Key Gap:
De `handle_payment_webhook` RPC probeert een email te queuen maar gebruikt verkeerde kolommen:
- `recipient_email` → moet `to_email` zijn
- `template_key` / `template_data` → bestaan niet in `email_outbox`
Dit werd later omzeild door `f006_skip_email_outbox.sql` maar nooit gefixt.

## Scope

### Feature 1: Ticket Email Delivery
- **Wat**: Na payment success, stuur ticket email met QR code(s) per ticket
- **Hoe**: Nieuwe RPC `queue_ticket_delivery_email()` die `queue_email()` gebruikt
- **Trigger**: Aangeroepen vanuit `mollie-webhook` Edge Function na payment success
- **Template**: HTML email met event info, deelnemer naam, QR code(s) als inline images
- **Idempotency**: Key = `ticket-delivery:{order_id}` (1 email per order)

### Feature 2: PDF Ticket Generation
- **Wat**: Edge Function `ticket-pdf` die een PDF ticket genereert
- **Hoe**: Server-side PDF generatie met QR code, event info, ticket details
- **Auth**: Owner check (user_id must match) of org member
- **Output**: application/pdf stream

### Feature 3: In-App Ticket View Upgrade
- **Wat**: Verbeterde Mijn Tickets pagina met PDF download
- **Hoe**: Download knop per ticket die `ticket-pdf` Edge Function aanroept
- **Extra**: Ticket detail view met grotere QR code

## Architecture

### Database Migration
```sql
-- 1. RPC: queue_ticket_delivery_email
--    Generates HTML email with QR codes for all tickets in an order
--    Uses queue_email() for idempotent delivery
--    Called from mollie-webhook after payment success

-- 2. Fix handle_payment_webhook email section
--    Replace broken INSERT with call to queue_ticket_delivery_email()
```

### Edge Functions
```
supabase/functions/
├── ticket-pdf/index.ts      # NEW: PDF generation for single ticket
└── mollie-webhook/index.ts   # MODIFY: Call send-tickets after payment
```

### Frontend
```
web/src/pages/sporter/
└── MijnTickets.tsx            # MODIFY: Add PDF download button
```

## Acceptance Criteria

- [ ] Ticket email sent after payment success via email_outbox
- [ ] Email contains: event name, date, location, QR code(s), purchaser name
- [ ] Email uses idempotency key (no duplicate sends)
- [ ] PDF downloadable per ticket with QR code + event details
- [ ] PDF auth: only ticket owner or org member can download
- [ ] MijnTickets page has PDF download button
- [ ] All new code has RLS/auth checks
- [ ] Integration tests passing

## Dependencies
- F006 (Checkout/Payment) - Done
- F008 (Communication/Outbox) - Done
- F007 S1+S2 (Scanning) - Done
