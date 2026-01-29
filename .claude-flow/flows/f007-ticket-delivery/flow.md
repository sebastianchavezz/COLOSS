# Flow: Ticket Delivery

**ID**: F007
**Status**: 🟡 In Progress
**Total Sprints**: 3
**Current Sprint**: S2 (Complete)

## Sprints
| Sprint | Focus | Status |
|--------|-------|--------|
| S1 | Professional ticket scanning | ✅ Complete |
| S2 | Mobile Ticket Scanner (BYOD) | ✅ Complete |
| S3 | Email delivery + PDF | 🔴 Planned |

## Dependencies
- **Requires**: F006
- **Blocks**: None

## Overview

Na succesvolle betaling ontvangt de deelnemer zijn tickets.

```
Als deelnemer
Wil ik mijn tickets ontvangen
Zodat ik toegang heb tot het evenement
```

## Flow Diagram

```
[Payment Success] → [Generate Tickets]
                          │
                          ▼
                   [Create QR Codes]
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
       [Email Tickets]         [In-App Tickets]
              │                       │
              ▼                       ▼
       [PDF Attachment]        [Wallet/QR View]
```

## Supabase

### Tables
| Table | Purpose |
|-------|---------|
| `ticket_instances` | Ticket records with QR/token |
| `ticket_scans` | Append-only audit log (all scan attempts) |
| `email_outbox` | Email queue (F008) |

### RLS Policies
| Policy | Table | Rule |
|--------|-------|------|
| `read_own` | `tickets` | `participant_id = auth.uid()` |
| `read_as_organizer` | `tickets` | Org member can scan |

### RPC Functions (S1)
| Function | Purpose |
|----------|---------|
| `scan_ticket` | Main scanning endpoint (idempotent, atomic) |
| `undo_check_in` | Admin-only revert check-in |
| `get_scan_stats` | Real-time scanning statistics |
| `get_recent_scans` | Scan history log |
| `mask_participant_name` | PII masking helper |
| `mask_email` | Email masking helper |

### Edge Functions
| Function | Purpose |
|----------|---------|
| `generate-tickets` | Create ticket records + QR (planned S2) |
| `send-tickets` | Queue ticket emails (planned S3) |

## API Endpoints

| Method | Endpoint | Auth |
|--------|----------|------|
| GET | `/rest/v1/tickets?order_id=eq.{id}` | Yes |
| GET | `/functions/v1/ticket-pdf/{id}` | Yes |

## Test Scenarios

| ID | Scenario | Expected | Status |
|----|----------|----------|--------|
| T1 | Scan valid ticket | VALID result, status = checked_in | ✅ |
| T2 | Scan invalid token | INVALID result | ✅ |
| T3 | Scan duplicate | ALREADY_USED (idempotent) | ✅ |
| T4 | Rate limit exceeded | RATE_LIMIT_EXCEEDED | ✅ |
| T5 | Cross-event scan | NOT_IN_EVENT | ✅ |
| T6 | Undo check-in | Admin only, audit logged | ✅ |
| T7 | Scan stats | Real-time statistics | ✅ |
| T8 | PII masking | Masked response | ✅ |
| T9 | Tickets generated | Unique codes created | 🔴 S2 |
| T10 | Email delivered | Tickets in inbox | 🔴 S3 |

## Acceptance Criteria

**Sprint S1 (Scanning)**:
- [x] scan_ticket RPC implemented
- [x] Idempotent scanning (duplicate = ALREADY_USED)
- [x] Atomic check-in (concurrency safe)
- [x] Rate limiting (per user + device)
- [x] Audit log (all attempts)
- [x] PII masking (configurable)
- [x] Undo check-in (admin only)
- [x] Scan statistics
- [x] Tests passing (11 passed)

**Sprint S2 (Mobile Scanner BYOD)**:
- [x] Scanner setup page in event sidebar
- [x] QR code generation for mobile access
- [x] Mobile camera scanner (html5-qrcode)
- [x] Haptic feedback on scan
- [x] Manual token input fallback
- [x] Real-time stats display

**Sprint S3 (Delivery)**:
- [ ] Email with tickets sent
- [ ] PDF downloadable
- [ ] Tickets viewable in app

---

## Sprint S1 Summary (Completed 2025-01-27)

Implemented professional ticket scanning system met:
- **Idempotent scanning**: Duplicate scans return deterministic ALREADY_USED
- **Concurrency safety**: Atomic updates via FOR UPDATE SKIP LOCKED
- **Rate limiting**: Server-side (60/min user, 30/min device default)
- **Audit trail**: Complete log in ticket_scans table
- **PII protection**: Masked participant info (configurable)
- **Security**: RLS policies, role checks, token hashing
- **Performance**: <200ms p95 target via indexed lookups

See migrations:
- `20250127210001_f007_ticket_scanning_table.sql`
- `20250127210002_f007_scanning_settings_domain.sql`
- `20250127210003_f007_scan_ticket_rpc.sql`
- `20250127210004_f007_scan_support_rpcs.sql`

---

*Last updated: 2026-01-29*
*Sprint S1 completed: 2025-01-27*
*Sprint S2 completed: 2026-01-29*
