# F00X Test Context - TEMPLATE

> Copy this to: `.claude-flow/flows/f00X-.../tests/test-context.md`
> @supabase-tester MUST read this before testing.
> Also read: `.claude-flow/memory/db-architecture.md` for connection details.

---

## Dependencies

| Flow | Must Work First | Why |
|------|-----------------|-----|
| F001 | User Registration | Need auth users |
| F002 | User Login | Need sessions |
| F00X | ... | ... |

**Note**: List which flows MUST work before this flow can be tested.

---

## Relevant Tables

| Table | Role in Flow | Key Columns |
|-------|--------------|-------------|
| `table1` | Main entity | col1, col2 |
| `table2` | Related data | fk_col |

---

## RLS Policies to Test

### table1

| Policy | Who | Can |
|--------|-----|-----|
| Policy name | auth.uid() = user_id | SELECT/INSERT/UPDATE/DELETE |

### Test Scenarios

```sql
-- 1. User A can see own data
SET LOCAL role TO 'authenticated';
SET LOCAL request.jwt.claims TO '{"sub": "user-a-uuid"}';
SELECT * FROM table1 WHERE user_id = 'user-a-uuid'; -- Should return rows

-- 2. User A CANNOT see User B's data
SELECT * FROM table1 WHERE user_id = 'user-b-uuid'; -- Should return 0 rows
```

---

## Edge Cases

| Case | Expected Behavior | Test |
|------|-------------------|------|
| Empty input | Return error | TEST X |
| Invalid ID | Return 404 | TEST Y |
| Unauthorized | RLS blocks | TEST Z |

---

## Test Users Needed

| User | Purpose | Auth |
|------|---------|------|
| Guest | Anon access | anon |
| Regular User | Standard flow | authenticated |
| Org Admin | Admin actions | authenticated + org_member(admin) |

### Create Test User (if needed)

```sql
-- Create auth user for testing
INSERT INTO auth.users (id, email)
VALUES ('test-uuid', 'testuser@example.com');

-- Make them org member (if needed)
INSERT INTO org_members (org_id, user_id, role)
VALUES ('org-uuid', 'test-uuid', 'admin');
```

---

## Test Fixtures

```sql
-- 1. Create test org (if needed)
INSERT INTO orgs (id, name, slug)
VALUES (gen_random_uuid(), 'Test Org', 'test-org')
RETURNING id INTO v_test_org_id;

-- 2. Create other fixtures
-- ...
```

---

## Cleanup (IMPORTANT)

```sql
-- Delete in correct order (respect FK constraints!)
-- Child tables first, then parents
DELETE FROM child_table WHERE ...;
DELETE FROM parent_table WHERE ...;
DELETE FROM orgs WHERE id = v_test_org_id;
```

---

## RPC Functions to Test

| Function | Purpose | Auth Required |
|----------|---------|---------------|
| `function_name(params)` | What it does | anon/auth/service_role |

### Function Test Cases

| Function | Input | Expected Output |
|----------|-------|-----------------|
| `func1` | valid input | success response |
| `func1` | invalid input | error response |

---

## Run Tests

```bash
# SQL verification tests
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -f .claude-flow/flows/f00X-.../tests/sql-verification.sql
```

---

*Created: YYYY-MM-DD*
*Last updated: YYYY-MM-DD*
