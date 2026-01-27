# Flow: Refund

**ID**: F009
**Status**: 🔴 Planned
**Total Sprints**: 2
**Current Sprint**: -

## Sprints
| Sprint | Focus | Status |
|--------|-------|--------|
| S1 | Refund request + approval | 🔴 |
| S2 | Payment provider refund | 🔴 |

## Dependencies
- **Requires**: F006
- **Blocks**: None

## Overview

Deelnemers kunnen een terugbetaling aanvragen voor geannuleerde inschrijvingen.

```
Als deelnemer
Wil ik een refund kunnen aanvragen
Zodat ik mijn geld terugkrijg bij annulering

Als organisator
Wil ik refund requests kunnen beheren
Zodat ik controle heb over terugbetalingen
```

## Flow Diagram

```
[My Tickets] → [Request Refund]
                     │
                     ▼
              [Refund Form]
                     │
                     ▼
              [Submit Request]
                     │
              ┌──────┴──────┐
              ▼             ▼
       [Auto-Approve]  [Manual Review]
              │             │
              └──────┬──────┘
                     ▼
              [Process Refund]
                     │
                     ▼
              [Payment Refunded]
                     │
                     ▼
              [Tickets Cancelled]
```

## Supabase

### Tables
| Table | Purpose |
|-------|---------|
| `refund_requests` | Refund request records |
| `orders` | Update order status |
| `tickets` | Cancel tickets |
| `payments` | Refund transaction |

### RLS Policies
| Policy | Table | Rule |
|--------|-------|------|
| `create_own` | `refund_requests` | Own order only |
| `read_as_org` | `refund_requests` | Org can view |
| `approve_as_org` | `refund_requests` | Org admin only |

### Edge Functions
| Function | Purpose |
|----------|---------|
| `request-refund` | Create refund request |
| `approve-refund` | Approve + process refund |
| `process-refund` | Call payment provider |

## API Endpoints

| Method | Endpoint | Auth |
|--------|----------|------|
| POST | `/functions/v1/request-refund` | Yes |
| POST | `/functions/v1/approve-refund` | Yes (org) |
| GET | `/rest/v1/refund_requests` | Yes |

## Test Scenarios

| ID | Scenario | Expected |
|----|----------|----------|
| T1 | Request refund | Request created |
| T2 | Auto-approve (policy) | Immediately processed |
| T3 | Manual approve | Org reviews, approves |
| T4 | Reject refund | Request denied |
| T5 | Partial refund | Partial amount returned |
| T6 | Refund after deadline | Rejected per policy |

## Acceptance Criteria

- [ ] User can request refund
- [ ] Auto-approve based on policy
- [ ] Manual approval flow
- [ ] Payment provider refund works
- [ ] Tickets cancelled after refund
- [ ] Audit trail maintained

---

*Last updated: 2025-01-27*
