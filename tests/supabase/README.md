# Communication Module Tests

Test suite voor de Communication Module van het COLOSS platform.

## Bestanden

| Bestand | Type | Beschrijving |
|---------|------|--------------|
| `communication_rls.sql` | SQL | RLS policies verificatie - multi-tenant isolatie |
| `communication_functions.sql` | SQL | Database functions tests (queue_email, is_email_deliverable) |
| `communication_integration.test.ts` | TypeScript | Integration tests voor Edge Functions |

## Vereisten

- Supabase CLI geinstalleerd
- Lokale Supabase instance draaiend (`supabase start`)
- Of: toegang tot remote Supabase project

## SQL Tests Runnen

### Via Supabase SQL Editor (lokaal)

```bash
# Start lokale Supabase
supabase start

# Kopieer inhoud van .sql bestand naar SQL editor
# Of gebruik psql:
psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/supabase/communication_rls.sql
psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/supabase/communication_functions.sql
```

### Via psql (remote)

```bash
psql "$DATABASE_URL" -f tests/supabase/communication_rls.sql
```

## TypeScript Tests Runnen

### Vereiste Environment Variables

```bash
export SUPABASE_URL="http://localhost:54321"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
export SUPABASE_ANON_KEY="your-anon-key"
```

### Uitvoeren

```bash
# Vanuit project root
deno test --allow-env --allow-net tests/supabase/communication_integration.test.ts

# Met verbose output
deno test --allow-env --allow-net tests/supabase/communication_integration.test.ts -- --verbose

# Specifieke test
deno test --allow-env --allow-net --filter "should queue email" tests/supabase/communication_integration.test.ts
```

## Test Coverage

### RLS Tests (communication_rls.sql)

| Test | Beschrijving | Verwacht Resultaat |
|------|--------------|-------------------|
| TEST 1 | Owner can view own org email_outbox | PASS: 1+ emails zichtbaar |
| TEST 2 | Cross-org access prevention | PASS: 0 emails zichtbaar |
| TEST 3 | Org member can view message_batches | PASS: 1+ batches zichtbaar |
| TEST 4 | Non-member cannot view batches | PASS: 0 batches zichtbaar |
| TEST 5 | Public access to email_unsubscribes | PASS: Unsubscribes leesbaar |
| TEST 6 | email_bounces org isolation | PASS: Alleen eigen org + NULL org |
| TEST 7 | Org member can view templates | PASS: 1+ templates zichtbaar |
| TEST 8 | Comprehensive isolation check | PASS: Geen cross-org data |
| TEST 9 | email_outbox_events hierarchical RLS | PASS: Events via parent |
| TEST 10 | message_batch_items hierarchical RLS | PASS: Items via parent |

### Function Tests (communication_functions.sql)

| Test | Beschrijving | Verwacht Resultaat |
|------|--------------|-------------------|
| TEST 1 | Valid email gets queued | PASS: UUID returned |
| TEST 2 | Idempotency check | PASS: Same ID returned |
| TEST 3 | Unsubscribed email returns NULL | PASS: NULL voor marketing |
| TEST 4 | Hard bounced email returns NULL | PASS: NULL bij 3+ bounces |
| TEST 5 | Normal email is deliverable | PASS: true |
| TEST 6 | Unsubscribed not deliverable for marketing | PASS: false |
| TEST 7 | Hard bounced not deliverable | PASS: false |
| TEST 8 | Soft bounce under threshold | PASS: true |
| TEST 9 | Global unsubscribe blocks all orgs | PASS: false |
| TEST 10 | Status update creates event | PASS: Event logged |
| TEST 11 | Exponential backoff correct | PASS: 2^n minutes |
| TEST 12 | Bounce creates record | PASS: email_bounces entry |
| TEST 13 | Final status prevents updates | PASS: false returned |
| TEST 14 | Complaint creates correct bounce type | PASS: type=complaint |
| TEST 15 | Invalid email format rejected | PASS: Exception raised |

### Integration Tests (communication_integration.test.ts)

| Test | Beschrijving |
|------|--------------|
| Email Outbox - queue email | Verify queue_email RPC works |
| Email Outbox - idempotency | Same key returns same ID |
| Email Outbox - skip unsubscribed | Marketing blocked for unsubscribed |
| Bulk Email - batch creation | Correct recipient count |
| Bulk Email - filter bounced | is_email_deliverable check |
| Webhook - delivered status | Status update works |
| Webhook - bounce recording | Bounce blocks future sends |
| Webhook - complaint handling | Complaint recorded correctly |
| RLS - anon access | Anon cannot see org emails |
| Edge Cases | Invalid email, empty subject, duplicates |

## Troubleshooting

### "Missing SUPABASE_URL"

Zorg dat de environment variable is gezet:

```bash
export SUPABASE_URL="http://localhost:54321"
```

### "relation does not exist"

Migraties zijn niet toegepast. Run:

```bash
supabase db reset
```

### "permission denied"

RLS blokkeert toegang. Controleer of je met service role key werkt voor setup/teardown.

## Toevoegen van Nieuwe Tests

1. Volg het ARRANGE-ACT-ASSERT patroon
2. Cleanup altijd in finally block
3. Gebruik unieke test data (UUIDs/random slugs)
4. Test zowel happy path als failure scenarios
