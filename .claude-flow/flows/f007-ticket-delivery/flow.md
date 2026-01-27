# Flow: Ticket Delivery

**ID**: F007
**Status**: 🔴 Planned
**Total Sprints**: 2
**Current Sprint**: -

## Sprints
| Sprint | Focus | Status |
|--------|-------|--------|
| S1 | Ticket generation + QR | 🔴 |
| S2 | Email delivery + PDF | 🔴 |

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
| `tickets` | Ticket records with QR |
| `email_outbox` | Email queue (F008) |

### RLS Policies
| Policy | Table | Rule |
|--------|-------|------|
| `read_own` | `tickets` | `participant_id = auth.uid()` |
| `read_as_organizer` | `tickets` | Org member can scan |

### Edge Functions
| Function | Purpose |
|----------|---------|
| `generate-tickets` | Create ticket records + QR |
| `send-tickets` | Queue ticket emails |

## API Endpoints

| Method | Endpoint | Auth |
|--------|----------|------|
| GET | `/rest/v1/tickets?order_id=eq.{id}` | Yes |
| GET | `/functions/v1/ticket-pdf/{id}` | Yes |

## Test Scenarios

| ID | Scenario | Expected |
|----|----------|----------|
| T1 | Tickets generated | Unique codes created |
| T2 | QR code works | Scannable, unique |
| T3 | Email delivered | Tickets in inbox |
| T4 | PDF download | Valid PDF with QR |
| T5 | View in app | Tickets shown |

## Acceptance Criteria

- [ ] Tickets auto-generated on payment
- [ ] Unique QR code per ticket
- [ ] Email with tickets sent
- [ ] PDF downloadable
- [ ] Tickets viewable in app

---

*Last updated: 2025-01-27*
