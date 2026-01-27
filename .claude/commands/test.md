---
name: test
description: Run tests met focus op RLS en Supabase
---

# Test Command

Test: **$ARGUMENTS**

## Test Scope Bepalen

- Leeg = test alles
- F00X = test specifieke flow
- filename = test specifieke file

## Automatische Test Workflow

### 1. Unit Tests
```bash
npm test 2>/dev/null || echo "Geen npm tests geconfigureerd"
```

### 2. RLS Policy Tests

Voor elke tabel met RLS, test:

```typescript
describe('RLS: {table}', () => {
  it('owner can SELECT own records', async () => {
    // Test met authenticated user
  });

  it('other user CANNOT SELECT records', async () => {
    // Test met andere user - should return empty
  });

  it('anon CANNOT access', async () => {
    // Test zonder auth
  });
});
```

### 3. Edge Function Tests

```typescript
describe('Function: {name}', () => {
  it('works with valid auth', async () => {
    // POST met valid token
  });

  it('rejects without auth', async () => {
    // POST zonder token -> 401
  });

  it('handles invalid input', async () => {
    // POST met bad data -> 400
  });
});
```

### 4. Integration Tests

Test complete flows end-to-end.

## Output Format

```markdown
## Test Report

### Summary
| Category | Pass | Fail | Skip |
|----------|------|------|------|
| Unit     | X    | X    | X    |
| RLS      | X    | X    | X    |
| Functions| X    | X    | X    |
| E2E      | X    | X    | X    |

### Failed Tests
1. `{test}`: {reason}

### Coverage
- Lines: X%
- Branches: X%

### Gaps
- {wat nog niet getest is}

### Verdict
✅ Ready for merge / ⚠️ Needs fixes
```

Begin nu met testen.
