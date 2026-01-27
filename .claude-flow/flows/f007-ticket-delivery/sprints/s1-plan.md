# F007 Sprint S1: Professional Ticket Scanning

**Type**: Upgrade (eerste echte sprint voor F007)
**Datum**: 2025-01-27
**Status**: Planning

---

## Context

F007 Ticket Delivery heeft al basis structuur:
- `ticket_instances` tabel met `status` enum (`issued`, `void`, `checked_in`)
- `token_hash` kolom voor secure check-in
- Basis RLS policies voor org members

**Huidige situatie**:
- Tickets worden uitgegeven na betaling
- Heeft QR/token support, maar geen scanning endpoint
- Geen audit trail voor scan attempts
- Geen rate limiting of anti-fraude measures
- Geen settings domain voor scanning configuratie

---

## Doel van Upgrade

Implementeer een **professionele, waterdichte ticket scanning flow** voor organiser staff, volgens Atleta/Eventbrite best practices.

### Functionele Requirements

1. **Manual scan endpoint** (camera QR komt later)
   - Edge Function/RPC: `scan_ticket(event_id, token, scanner_user_id, device_id?)`
   - Returns: `VALID | INVALID | ALREADY_USED | CANCELLED | REFUNDED | TRANSFER_PENDING | NOT_IN_EVENT`

2. **Check-in state machine**
   - `issued` → `checked_in` (idempotent)
   - Support voor "undo check-in" (role-gated, audit-first)

3. **Audit & Anti-fraude**
   - `ticket_scans` log table: elke poging (success/fail) met timestamp, scanner, device_id, IP/user-agent, reason_code
   - Rate limiting per device/user (server-side)
   - Token high-entropy enforcement (nooit raw IDs)
   - Event-bound tokens (validatie)

4. **Security & RBAC**
   - Alleen org members met scanner permissions kunnen scannen
   - End-users KUNNEN NIET scannen
   - Append-only logs (no tampering)

5. **Concurrency safety**
   - Atomic update met row locking
   - Deterministic `ALREADY_USED` na eerste success

6. **Best practices**
   - Idempotent: dubbele scan = zelfde outcome
   - Exactly-once check-in transition
   - Minimal PII in response (masked email, initials only)
   - Fast path: indexed token lookup, minimal joins

---

## Wat wordt toegevoegd

### Database (Migrations)

1. **ticket_scans table** (audit log)
   ```sql
   - id, ticket_id, event_id
   - scanner_user_id, device_id, ip_address, user_agent
   - scanned_at, scan_result (VALID/INVALID/etc.)
   - reason_code
   - metadata (JSONB)
   ```

2. **Settings domain: `scanning`**
   ```sql
   - scanning.enabled
   - scanning.rate_limit.per_minute
   - scanning.require_device_id
   - scanning.allow_undo_checkin
   - scanning.response.pii_level (none|masked|full-for-admin)
   ```

3. **RPC Functions**
   - `scan_ticket(event_id, token, device_id?)` - main scan endpoint
   - `undo_check_in(ticket_id)` - admin-only undo (optional)
   - `get_scan_stats(event_id)` - real-time scan statistics

### Edge Functions

Mogelijk future: Edge Function wrapper voor rate limiting / IP blocking.
Voorlopig: alles in RPC (Postgres functions).

### Frontend (Web)

1. **ScanPage enhancements**
   - Manual token input (existing)
   - Real-time scan result display
   - Masked PII volgens settings
   - Scan history log (recent scans)

2. **Scan Stats Dashboard** (optional, fase 2)
   - Live check-in counter
   - Scans per minute
   - Failed scans overview

---

## Non-Functional Requirements

- **Performance**: <200ms p95 for indexed token lookup
- **Idempotency**: 100% deterministic voor duplicate scans
- **Concurrency**: No double entries, atomic transitions
- **Security**: Token must be unguessable (>128 bit entropy)
- **Auditability**: Complete scan trail in `ticket_scans`

---

## Out of Scope (Future)

- Camera QR scanning UI
- Offline-first local sync
- Timing chip integrations
- Bulk scan import

---

## Implementation Plan

### Stap 1: Database Layer
1. Maak `ticket_scans` tabel met RLS + triggers
2. Add `scanning` settings domain
3. Maak `scan_ticket` RPC met:
   - Token validation (event-bound, hash lookup)
   - Rate limiting check (per device/user)
   - Atomic status update (`FOR UPDATE SKIP LOCKED`)
   - Audit log insert (append-only)
   - Return minimal PII response

### Stap 2: Security & Validation
1. Enforce scanner role check
2. Validate token format (prevent injection)
3. Event-bound token enforcement
4. Rate limit via `ticket_scans` count

### Stap 3: Frontend Integration
1. Update ScanPage met scan result states
2. Masked PII display
3. Recent scans log

### Stap 4: Testing
1. Idempotency test: scan same token 10x
2. Concurrency test: 100 parallel scans on same ticket
3. Rate limit test: exceed per-minute limit
4. Security test: cross-event token use
5. Undo test: admin can revert check-in

---

## Acceptance Criteria

- [ ] `scan_ticket` RPC werkt met token input
- [ ] Idempotent: dubbele scan = `ALREADY_USED`
- [ ] Concurrency: 100% atomic, geen duplicates
- [ ] Rate limiting actief (configurable)
- [ ] Audit log compleet (all attempts)
- [ ] Security: only org members kunnen scannen
- [ ] PII masked volgens settings
- [ ] Fast path: <200ms p95
- [ ] Tests passing (5+ scenarios)

---

## Dependencies

- **Vereist**: `ticket_instances` tabel (existing)
- **Vereist**: `token_hash` kolom (existing)
- **Vereist**: `event_settings` met domain support (existing)

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Race condition double scans | High | Use `FOR UPDATE SKIP LOCKED` + unique constraint |
| Token guessing | Critical | Enforce high-entropy tokens, hash storage |
| Rate limit bypass | Medium | Server-side check, device_id required |
| Audit log tampering | High | Append-only, no DELETE policy |

---

*Klaar voor architectuur fase*
