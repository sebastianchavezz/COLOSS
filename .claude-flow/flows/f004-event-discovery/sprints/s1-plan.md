# F004 Sprint S1: Event Discovery

## Metadata

| Field | Value |
|-------|-------|
| **Flow** | F004 - Event Discovery |
| **Sprint** | S1 |
| **Author** | @pm |
| **Date** | 2026-01-28 |
| **Status** | In Progress |

---

## Current State Analysis

### Already Implemented
| Component | Location | Status |
|-----------|----------|--------|
| Events Table | Layer 2 migration | slug, name, description, location, times, status |
| Event Settings | Layer 2 migration | currency, vat, is_public_visible |
| Ticket Types | Layer 4 migration | price, capacity, sales windows |
| RLS: Public read | Layer 2 | `status = 'published' AND deleted_at IS NULL` |
| Checkout Page | `web/src/pages/public/PublicEventCheckout.tsx` | Exists (by slug) |

### Missing Components
| Component | Priority | Description |
|-----------|----------|-------------|
| Public Events List Page | HIGH | Browse all published events |
| Public Event Detail Page | HIGH | View single event details |
| Search/Filter RPC | MEDIUM | Search by name, filter by date |
| Events List View | MEDIUM | Materialized view for efficient listing |

---

## Sprint Scope

This sprint will add:
1. **Public Events List Page** - Browse published events with basic info
2. **Public Event Detail Page** - Full event info before checkout
3. **get_public_events RPC** - Efficient query with search/filter
4. **public_events_v View** - Optimized view joining events + ticket info

### Out of Scope (S2)
- Advanced search (full-text)
- Geolocation filtering
- Event categories/tags
- Saved events / favorites

---

## Deliverables

| Artifact | Status |
|----------|--------|
| Sprint Plan | This document |
| Architecture | `s1-architecture.md` |
| SQL Migration | `supabase/migrations/20250128150000_f004_event_discovery.sql` |
| Public Events Page | `web/src/pages/public/PublicEvents.tsx` |
| Public Event Detail | `web/src/pages/public/PublicEventDetail.tsx` |
| Integration Tests | `tests/integration-tests.mjs` |
| Review | `s1-review.md` |

---

## Acceptance Criteria

- [ ] Public can view list of published events
- [ ] Draft events are NOT visible publicly
- [ ] Event detail page shows full event info
- [ ] Ticket types and prices visible on detail
- [ ] Search by event name works
- [ ] Filter by date range works
- [ ] Tests verify RLS and visibility

---

*Sprint Plan - F004 Event Discovery - 2026-01-28*
