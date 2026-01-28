# F004 Sprint S1: Code Review

## Metadata

| Field | Value |
|-------|-------|
| **Flow** | F004 - Event Discovery |
| **Sprint** | S1 |
| **Author** | @reviewer |
| **Date** | 2026-01-28 |
| **Status** | APPROVED |

---

## Review Summary

| Category | Status | Notes |
|----------|--------|-------|
| SQL View | PASS | Correct join logic, aggregates work |
| RPC Security | PASS | SECURITY DEFINER, no user data leaks |
| Frontend Pages | PASS | Clean, responsive, proper loading states |
| RLS Compliance | PASS | Only published events exposed |
| Error Handling | PASS | Graceful failures, user-friendly messages |

---

## Detailed Findings

### 1. Database Migration

**View: public_events_v**
- Correctly joins events, orgs, event_settings, ticket_types
- Aggregates ticket stats using LATERAL join
- Only shows published, non-deleted events
- COALESCE prevents NULL issues

**RPC: get_public_events**
- Pagination validated (_limit 1-100, _offset >= 0)
- Search is case-insensitive (ILIKE)
- Date filters correctly applied
- Returns proper JSON structure with total count

**RPC: get_public_event_detail**
- Returns EVENT_NOT_FOUND for missing events
- Includes all ticket types with availability
- `on_sale` computed correctly (date range + capacity)
- Uses SECURITY DEFINER with search_path

### 2. Frontend: PublicEvents.tsx

**Strengths:**
- Search form with URL params
- Pagination with page state
- Loading/error/empty states handled
- Card layout responsive (1/2/3 columns)
- Price formatting with currency

### 3. Frontend: PublicEventDetail.tsx

**Strengths:**
- Back navigation
- Event info well organized
- Ticket types shown with availability
- CTA changes based on ticket state (on sale/sold out/not available)
- Low stock warning ("Only X tickets left")

### 4. Routing

- `/events` - Public event listing
- `/events/:slug` - Public event detail
- Link to checkout at `/e/:slug`

---

## Security Checklist

- [x] RPC uses SECURITY DEFINER
- [x] Only published events visible
- [x] No auth.users data exposed
- [x] Grants for anon + authenticated
- [x] Input validated (limit, offset)
- [x] Description truncated in list (LEFT 200)

---

## Minor Suggestions (Non-blocking)

1. **Consider caching**: public_events_v could be materialized for high traffic
2. **pg_trgm extension**: The GIN index may fail if extension not enabled
3. **Image support**: Events could have cover images (future enhancement)

---

## Verdict

**APPROVED** - Ready for deployment.

All acceptance criteria covered:
- [x] Public event listing works
- [x] Draft events hidden
- [x] Event detail page works
- [x] Ticket types visible with prices
- [x] Search by name/location works
- [x] Pagination works

---

*Code Review - F004 Event Discovery - 2026-01-28*
