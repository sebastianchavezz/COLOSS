# F007 S3 - Code Review Report

## Status: APPROVED (after fixes)

## Reviewer Findings & Fixes Applied

### CRITICAL - Fixed
1. **HTML Injection in email template** - Added `html_escape()` SQL function. All user-supplied values (`purchaser_name`, `event.name`, `location_name`, `ticket_type.name`) now escaped.
2. **Auth bypass in auth.ts** - Pre-existing issue in shared infrastructure (JWT fallback decode without signature verification). NOT fixed in this sprint to avoid breaking other functions. Tracked as separate security debt.

### HIGH - Fixed
3. **Blob URL same-origin XSS** - Added `noopener,noreferrer` to `window.open()` + `URL.revokeObjectURL` cleanup.
4. **Download for void tickets** - Added `ticket.status === 'issued'` guard on Download button + `status !== 'issued'` check in ticket-pdf Edge Function.
5. **Null orders guard** - Added explicit null check for `t.orders` before authorization logic.

### MEDIUM - Noted
6. QR tokens via external service - Accepted risk for MVP. Server-side QR generation planned for future.
7. Debug logging in auth.ts - Pre-existing, tracked separately.
8. Email subject injection - Fixed: `regexp_replace` strips `\r\n` from event name.
9. Idempotency blocks re-delivery - Acceptable for initial implementation.
10. GET DIAGNOSTICS accumulation - Pre-existing bug in F006 handle_payment_webhook.

### LOW - Fixed
11. UTC rendering in PDF - Changed to `Intl.DateTimeFormat` with `Europe/Amsterdam` timezone.
