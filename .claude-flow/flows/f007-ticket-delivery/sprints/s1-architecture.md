# F007 S1: Architecture Document - Professional Ticket Scanning

**Upgrade Type**: Additive (geen breaking changes)
**Impact**: Medium (nieuwe tabel, RPC functies, settings domain)

---

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    SCANNING FLOW                              │
└─────────────────────────────────────────────────────────────┘

Staff scans ticket
       │
       ▼
[Manual Token Input] ──► scan_ticket(event_id, token, device_id)
       │                         │
       │                         ▼
       │                  Rate Limit Check ──► RATE_LIMIT_EXCEEDED
       │                         │
       │                         ▼
       │                  Token Lookup (indexed) ──► INVALID / NOT_IN_EVENT
       │                         │
       │                         ▼
       │                  Status Check ──► ALREADY_USED / CANCELLED / REFUNDED
       │                         │
       │                         ▼
       │                  Atomic Update (FOR UPDATE SKIP LOCKED)
       │                         │
       │                         ▼
       │                  Audit Log Insert
       │                         │
       │                         ▼
       └──────────────────► Return: VALID + masked PII
```

---

## Database Architecture

### 1. New Table: `ticket_scans`

**Purpose**: Append-only audit log voor alle scan attempts.

```sql
CREATE TABLE ticket_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Context
  ticket_id UUID NOT NULL,  -- NULL if token invalid
  event_id UUID NOT NULL,

  -- Scanner info
  scanner_user_id UUID NOT NULL,
  device_id TEXT,
  ip_address INET,
  user_agent TEXT,

  -- Scan result
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scan_result TEXT NOT NULL,  -- VALID, INVALID, ALREADY_USED, etc.
  reason_code TEXT,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Constraints
  CONSTRAINT ticket_scans_ticket_id_fkey FOREIGN KEY (ticket_id)
    REFERENCES ticket_instances(id) ON DELETE CASCADE,
  CONSTRAINT ticket_scans_event_id_fkey FOREIGN KEY (event_id)
    REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT ticket_scans_scanner_user_id_fkey FOREIGN KEY (scanner_user_id)
    REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Indexes for fast queries
CREATE INDEX idx_ticket_scans_ticket_id ON ticket_scans(ticket_id);
CREATE INDEX idx_ticket_scans_event_id ON ticket_scans(event_id);
CREATE INDEX idx_ticket_scans_scanner_user_id ON ticket_scans(scanner_user_id);
CREATE INDEX idx_ticket_scans_scanned_at ON ticket_scans(scanned_at);

-- Composite for rate limiting queries
CREATE INDEX idx_ticket_scans_device_time ON ticket_scans(device_id, scanned_at)
  WHERE device_id IS NOT NULL;
CREATE INDEX idx_ticket_scans_user_time ON ticket_scans(scanner_user_id, scanned_at);
```

**RLS**: Append-only, org members can SELECT for their events.

---

### 2. Settings Domain: `scanning`

Add to `event_settings.domain` constraint:

```sql
ALTER TABLE event_settings DROP CONSTRAINT event_settings_domain_check;
ALTER TABLE event_settings ADD CONSTRAINT event_settings_domain_check
  CHECK (domain IN (
    -- ... existing domains ...
    'scanning'
  ));
```

Update `get_default_settings()`:

```sql
'scanning', jsonb_build_object(
  'enabled', true,
  'rate_limit', jsonb_build_object(
    'per_minute', 60,
    'per_device_per_minute', 30
  ),
  'require_device_id', false,
  'allow_undo_checkin', false,
  'response', jsonb_build_object(
    'pii_level', 'masked'  -- none | masked | full-for-admin
  )
)
```

---

### 3. RPC Functions

#### `scan_ticket`

**Signature**:
```sql
CREATE OR REPLACE FUNCTION scan_ticket(
  _event_id UUID,
  _token TEXT,
  _device_id TEXT DEFAULT NULL,
  _ip_address INET DEFAULT NULL,
  _user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
```

**Logic Flow**:

```sql
1. Security check: is_org_member(event.org_id)
2. Get settings: scanning.enabled, rate_limit
3. Rate limit check:
   - Count scans in last minute for device/user
   - Return RATE_LIMIT_EXCEEDED if exceeded
4. Token lookup:
   - SELECT ... FROM ticket_instances WHERE token_hash = hash(_token) FOR UPDATE SKIP LOCKED
   - If not found: INVALID
   - If event_id mismatch: NOT_IN_EVENT
5. Status check:
   - If status = 'void': CANCELLED
   - If status = 'checked_in': ALREADY_USED
   - If order status = 'refunded': REFUNDED
   - If transfer pending: TRANSFER_PENDING (future)
6. Atomic update:
   - UPDATE ticket_instances SET status = 'checked_in', checked_in_at = NOW(), checked_in_by = auth.uid()
7. Audit log:
   - INSERT INTO ticket_scans (...)
8. Return:
   - VALID + masked PII (ticket name, participant initials, ticket_type name)
```

**Return Format**:
```json
{
  "result": "VALID",
  "ticket": {
    "id": "uuid",
    "type_name": "Early Bird Marathon",
    "participant_name": "J. D***",  // masked
    "checked_in_at": "2025-01-27T21:45:00Z"
  }
}
```

#### `undo_check_in` (Optional)

```sql
CREATE OR REPLACE FUNCTION undo_check_in(
  _ticket_id UUID,
  _reason TEXT DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
```

Logic:
1. Check: admin/owner role only
2. Check: settings.allow_undo_checkin = true
3. Update: SET status = 'issued', checked_in_at = NULL, checked_in_by = NULL
4. Audit: INSERT INTO ticket_scans with scan_result = 'UNDO'
5. Return: success

#### `get_scan_stats`

```sql
CREATE OR REPLACE FUNCTION get_scan_stats(
  _event_id UUID,
  _time_window_minutes INTEGER DEFAULT 60
)
RETURNS JSONB
```

Returns:
```json
{
  "total_scans": 1234,
  "valid_scans": 1200,
  "invalid_scans": 34,
  "scans_last_hour": 450,
  "scans_per_minute_avg": 7.5,
  "unique_scanners": 12
}
```

---

## Security Architecture

### 1. Token Security

**Current state**: `token_hash` kolom (existing)

**Enforcement**:
- Token MUST be high-entropy (UUID v4 minimum)
- Stored as hash (bcrypt/sha256)
- Never expose raw token in logs
- Event-bound validation

### 2. RBAC

**Scanner Permission**: Implicit via `is_org_member(event.org_id)`

Future enhancement: Add explicit `scanner` role in `org_members`.

### 3. RLS Policies

**ticket_scans**:
- SELECT: org members for their events only
- INSERT: via SECURITY DEFINER functions only
- UPDATE/DELETE: DENIED (append-only)

### 4. Rate Limiting

**Server-side implementation**:
```sql
-- Count scans in last minute
SELECT COUNT(*) FROM ticket_scans
WHERE scanner_user_id = auth.uid()
  AND scanned_at > NOW() - INTERVAL '1 minute';
```

**Settings-driven**:
- `scanning.rate_limit.per_minute` (per user)
- `scanning.rate_limit.per_device_per_minute` (per device_id)

---

## Concurrency Safety

### Atomic Check-in

```sql
-- Row-level locking prevents race conditions
SELECT * FROM ticket_instances
WHERE token_hash = $1
FOR UPDATE SKIP LOCKED;  -- Skip if already locked

-- Update in same transaction
UPDATE ticket_instances SET ...
WHERE id = ...;
```

**Guarantees**:
- Only ONE scan succeeds
- Subsequent scans get `ALREADY_USED`
- No duplicate check-ins

---

## Performance Considerations

### Fast Path

1. **Indexed token lookup**: `idx_ticket_instances_token_hash` (existing)
2. **Minimal joins**: Only join for PII masking
3. **Rate limit check**: Indexed on `(device_id, scanned_at)`

**Target**: <200ms p95 for scan

### Scan Log Growth

`ticket_scans` grows indefinitely (append-only).

**Mitigation**:
- Partition by month (future)
- Archive old scans (>1 year)
- Indexes on scanned_at for efficient queries

---

## PII Masking

**Settings-driven**: `scanning.response.pii_level`

- **`none`**: No participant info (only ticket type name)
- **`masked`**: Initials + masked email (`J. D*** - j***@example.com`)
- **`full-for-admin`**: Full name/email (admin only)

**Implementation**:
```sql
CASE
  WHEN pii_level = 'none' THEN NULL
  WHEN pii_level = 'masked' THEN mask_participant_name(p.name)
  WHEN pii_level = 'full' AND has_role(org_id, 'admin') THEN p.name
  ELSE mask_participant_name(p.name)
END
```

---

## Migration Strategy

### Backwards Compatibility

- ✅ No changes to existing columns
- ✅ New table (no impact on existing queries)
- ✅ New RPC functions (existing code unaffected)
- ✅ Settings domain additive only

### Deployment Steps

1. Run migration (add table, settings, RPCs)
2. Deploy Edge Functions (if any)
3. Frontend update (ScanPage)
4. Enable `scanning.enabled` per event

---

## Testing Strategy

### Unit Tests (SQL)

1. Idempotency: scan same token 10x → ALREADY_USED after first
2. Concurrency: 100 parallel scans → exactly 1 success
3. Rate limit: exceed limit → RATE_LIMIT_EXCEEDED
4. Cross-event: scan token for wrong event → NOT_IN_EVENT
5. Undo: admin reverts check-in → status = issued

### Integration Tests (Node.js)

```javascript
await test("scan_ticket RPC exists", async () => { ... });
await test("Valid scan returns VALID", async () => { ... });
await test("Duplicate scan returns ALREADY_USED", async () => { ... });
await test("Rate limit works", async () => { ... });
await test("Undo check-in works", async () => { ... });
```

---

## Rollback Plan

If issues arise:

1. Disable scanning: `UPDATE event_settings SET settings = settings || '{"scanning": {"enabled": false}}'`
2. Drop RPC functions (safe, no data loss)
3. Drop `ticket_scans` table (if no critical audit data yet)

---

## Future Enhancements (Out of Scope)

- Camera QR scanning (frontend)
- Offline sync for scanners
- Real-time WebSocket updates (live dashboard)
- Bulk scan import
- Timing chip integration
- Multi-gate scanning (parallel gates)

---

*Ready for implementation*
