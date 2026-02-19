# F007 S3 Architecture - Ticket Delivery

## Overview

Three components:
1. **DB Migration** - RPC `queue_ticket_delivery_email()` + fix payment webhook email integration
2. **Edge Function** - `ticket-pdf` for PDF generation
3. **Frontend** - MijnTickets upgrade with PDF download

## 1. Database Migration

### RPC: queue_ticket_delivery_email(_order_id UUID)

```sql
-- Fetches order → event → tickets → generates HTML → calls queue_email()
-- Idempotency key: 'ticket-delivery:{order_id}'
-- Called from mollie-webhook Edge Function after payment success
```

**Logic:**
1. Fetch order with event info (name, date, location)
2. Fetch all ticket_instances for this order (qr_code, ticket_type name)
3. Generate HTML email body with:
   - Event name, date, location
   - Purchaser name
   - Per-ticket: type name + QR code (via external QR API)
   - Link to "Mijn Tickets" page
4. Call `queue_email()` with idempotency key `ticket-delivery:{order_id}`

### Update handle_payment_webhook

Add call to `queue_ticket_delivery_email()` after successful ticket issuance.
Change `'email_queued', false` to `'email_queued', true`.

## 2. Edge Function: ticket-pdf

**Endpoint:** `GET /functions/v1/ticket-pdf?ticket_id={id}`

**Auth:** Bearer token required. Must be ticket owner OR org member.

**Response:** `application/pdf` binary stream.

**PDF Content:**
- Event name, date, location
- Ticket type name, price
- Participant name
- QR code (generated server-side)
- Ticket ID (partial) for reference

**Implementation:** Use `jsPDF`-style approach via Deno-compatible PDF library.
Given Deno Edge Function constraints, generate a minimal HTML-to-PDF or use raw PDF construction.

## 3. Frontend Changes

### MijnTickets.tsx
- Add "Download PDF" button per ticket
- Button calls `ticket-pdf` Edge Function with auth header
- Download as `ticket-{event}-{id}.pdf`

## Security

| Check | Where | How |
|-------|-------|-----|
| Email idempotency | queue_ticket_delivery_email | idempotency_key unique constraint |
| PDF auth | ticket-pdf Edge Function | user_id = owner_user_id OR is_org_member |
| RLS | email_outbox | Only org members can view |
| No PII leak | PDF | Only accessible by authenticated owner |
