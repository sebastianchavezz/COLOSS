# F017: Embeddable Widget

## Status: 🟡 Active

## Description
Iframe-based embeddable ticket sales widget that organizers can place on their own websites.
Like Atleta's `<iframe>` embed, allows ticket purchasing directly from the organizer's site
while COLOSS manages the backend.

## User Journey
1. Organizer generates embed code from dashboard
2. Organizer pastes `<iframe>` + `<script>` on their website
3. Visitor sees ticket selection widget on organizer's site
4. Visitor selects tickets, fills in email
5. For paid orders: Mollie opens in popup window (not iframe redirect)
6. On payment complete: widget shows confirmation
7. Widget auto-resizes to fit content

## Dependencies
- F005 (Ticket Selection) - ticket availability RPC
- F006 (Checkout/Payment) - create-order-public Edge Function

## Security Requirements
- CSP `frame-ancestors` to control embedding
- Domain whitelist per event (optional)
- No auth required (guest checkout only)
- XSS protection (sanitize sourceUrl params)
- Mollie payment in popup (banks block iframe payment pages)

## Sprints
| Sprint | Name | Status |
|--------|------|--------|
| S1 | Embed Widget + Snippet Generator | 🟡 Active |
