# F001 Sprint S1: User Registration (Post-Purchase Sync)

## Metadata

| Field | Value |
|-------|-------|
| **Flow** | F001 - User Registration |
| **Sprint** | S1 |
| **Author** | @pm |
| **Date** | 2026-01-28 |
| **Status** | 🟡 Active |

---

## Goal

Complete the registration domain by implementing post-purchase sync logic that:
1. Creates/upserts participants from order data
2. Links registrations to orders (for idempotency)
3. Links ticket_instances to participants
4. Queues confirmation email via outbox
5. Provides organizer view for registrations

## Context

### What Already Exists

| Component | Location | Notes |
|-----------|----------|-------|
| `participants` table | Layer 3 migration | Basic structure, needs enhancement |
| `registrations` table | Layer 3 migration | Needs order_id for idempotency |
| `registration_answers` table | Layer 3 migration | Ready to use |
| `orders` table | Layer 5 migration | Has email, user_id, status |
| `ticket_instances` table | ticket_instances migration | Needs participant_id |
| `email_outbox` table | Communication migration | Ready for outbox events |
| Payment webhook flow | mollie-webhook Edge Function | Calls `handle_payment_status` |

### What's Missing

1. **Schema gaps**:
   - `registrations.order_id` column (for idempotent upsert)
   - `ticket_instances.participant_id` column
   - `participants.phone`, `participants.locale` columns (optional profile data)

2. **Business logic**:
   - RPC `sync_registration_on_payment(order_id)` 
   - Trigger to call sync on order.status = 'paid'
   - Outbox event insertion

3. **Organizer view**:
   - `organiser_registrations_view` with ticket counts, payment status, filters

---

## Acceptance Criteria

### AC1: Post-Purchase Participant Upsert
- [ ] When order.status becomes 'paid', participant record is created/found
- [ ] Uses order.email as unique key for upsert
- [ ] Copies first_name, last_name from order_items metadata or defaults
- [ ] Links to auth.users if order.user_id is set

### AC2: Registration Creation
- [ ] Registration created with order_id for idempotency
- [ ] Status set to 'confirmed' (not 'pending')
- [ ] Unique constraint on (event_id, order_id) prevents duplicates
- [ ] participant_id correctly linked

### AC3: Ticket Linking
- [ ] All ticket_instances for the order get participant_id set
- [ ] No duplicates on re-run (idempotent)

### AC4: Confirmation Email
- [ ] Outbox event 'ORDER_CONFIRMATION' created
- [ ] Payload includes: order_id, registration_id, participant_email
- [ ] Outbox correctly linked to org for template resolution

### AC5: Organizer View
- [ ] View shows: registration_id, participant info, ticket count, status, payment_date
- [ ] Filterable by: status, ticket_type, date range
- [ ] RLS respects org membership

### AC6: Idempotency
- [ ] Calling sync twice with same order_id produces same result
- [ ] No duplicate registrations, participants, or outbox events
- [ ] Audit log records each sync attempt

---

## Technical Tasks

### Phase 1: Schema Migration

```
Task 1.1: Add registrations.order_id column
Task 1.2: Add ticket_instances.participant_id column  
Task 1.3: Add participants.phone, locale columns (optional)
Task 1.4: Create indexes and constraints
```

### Phase 2: Sync Logic (RPC)

```
Task 2.1: Create RPC sync_registration_on_payment(order_id)
Task 2.2: Add trigger on orders table for status='paid'
Task 2.3: Insert outbox event in same transaction
```

### Phase 3: Organizer View

```
Task 3.1: Create organiser_registrations_view
Task 3.2: Add RLS policies for view access
```

### Phase 4: Tests & Deploy

```
Task 4.1: Write integration tests
Task 4.2: Deploy migration to Supabase
Task 4.3: Verify in staging
```

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Duplicate participants by email | Medium | ON CONFLICT DO UPDATE on email |
| Webhook retry creates duplicates | High | order_id uniqueness constraint |
| Order without valid event_id | Medium | FK constraint + validation |

---

## Out of Scope

- User login/authentication (F002)
- Ticket delivery/email rendering (F007)
- Registration form UI (future)
- Guest → Authenticated user merge (future)

---

*Sprint S1 Plan - F001 User Registration*
