# F001: User Registration

## Status: 🟢 Done

## Summary

Complete end-user registration flow covering:

**S1: Post-Purchase Registration**
1. Upsert participant (auth user or guest) when order is paid
2. Create/confirm registration for the event
3. Link tickets to participant
4. Queue confirmation email via outbox

**S2: In-App Registration & Profile Management**
1. Auto-create participant profile on signup (via `create_or_link_participant`)
2. Full profile editing (name, phone, birth_date, gender, address, city, country)
3. Profile retrieval with all fields
4. Audit logging on all profile changes

## Dependencies

- Requires: F006 (Checkout/Payment) - Done
- Requires: F008 (Communication/Outbox) - Done
- Enables: F002 (User Login), F007 (Ticket Delivery)

## Sprints

| Sprint | Focus | Status | Tests |
|--------|-------|--------|-------|
| S1 | Post-Purchase Sync | Done | 12/12 |
| S2 | In-App Registration & Profile | Done | 13/13 |

## Deliverables

### Sprint S1
| Artifact | Status | Location |
|----------|--------|----------|
| Sprint Plan | Done | `sprints/s1-plan.md` |
| Architecture | Done | `sprints/s1-architecture.md` |
| SQL Migration | Done | `supabase/migrations/20250128130000_f001_registration_enhancements.sql` |
| Integration Tests | Done (12/12) | `tests/integration-tests.mjs` |
| Review | Approved | `sprints/s1-review.md` |

### Sprint S2 (Upgrade)
| Artifact | Status | Location |
|----------|--------|----------|
| Sprint Plan | Done | `sprints/s2-plan.md` |
| Architecture | Done | `sprints/s2-architecture.md` |
| SQL Migration | Done | `supabase/migrations/20260205100000_f001_s2_user_registration_upgrade.sql` |
| Integration Tests | Done (13/13) | `tests/s2-integration-tests.mjs` |
| Review | Approved | `sprints/s2-review.md` |
| Test Report | Done | `sprints/s2-test-report.md` |

## Database Changes

### S1: Post-Purchase
- `registrations.order_id` - Link registration to order
- `ticket_instances.participant_id` - Link ticket to participant
- `sync_registration_on_payment(order_id)` RPC
- `organiser_registrations_view` view

### S2: Profile Management
- `get_my_participant_profile()` - Upgraded to return all fields
- `update_my_participant_profile(...)` - New RPC for profile editing
- Audit logging for PARTICIPANT_PROFILE_UPDATED

## Frontend Changes (S2)

- `AuthCallback.tsx` - Calls `create_or_link_participant` (was `link_current_user_to_participant`)
- `Profiel.tsx` - Full profile editing form with loading/saving states

## Acceptance Criteria

### S1
1. When order.status -> 'paid', participant is upserted
2. Registration is created/confirmed with status 'confirmed'
3. All ticket_instances get linked to the participant
4. Outbox event created for confirmation email
5. Organizer can view registrations per event
6. Idempotent: duplicate calls don't create duplicates

### S2
1. Fresh signup auto-creates participant profile (email + name from metadata)
2. User can edit profile: first_name, last_name, phone, birth_date, gender, address, city, country
3. Profile loads and displays all fields
4. "Maak je profiel compleet" banner when name is missing
5. Backwards compatible: existing RPCs still work

---

*Created: 2026-01-28 | Updated: 2026-02-05*
