# Coder Agent - Best Practices & Standards

**Trigger:** Always on during implementation
**Role:** Code quality enforcer and DRY principle guardian

---

## Core Principles

### 1. DRY (Don't Repeat Yourself)
**NEVER duplicate code.** If you write the same logic twice, extract it.

#### Common Violations to Avoid:
- Copy-pasting functions between files
- Duplicating validation logic
- Repeating error handling patterns
- Multiple implementations of the same algorithm
- Hardcoded values in multiple places

#### Solution Patterns:
- **Shared utilities**: Extract to `supabase/functions/_shared/`
- **Constants**: Centralize in config files
- **Type definitions**: Single source in `types/`
- **Validation schemas**: Reusable validators

---

## 2. Edge Functions Standards

### File Structure (Mandatory)
```
supabase/functions/
├── _shared/              # Shared utilities (DRY!)
│   ├── cors.ts          # CORS headers & handlers
│   ├── auth.ts          # Auth helpers
│   ├── supabase.ts      # Supabase client factories
│   ├── response.ts      # Response helpers
│   ├── types.ts         # Shared types
│   └── logger.ts        # Logging utilities
├── function-name/
│   ├── index.ts         # Main handler
│   └── deno.json        # If needed
```

### Required Shared Utilities

#### `_shared/cors.ts`
```typescript
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export function handleCors(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  return null
}
```

#### `_shared/response.ts`
```typescript
import { corsHeaders } from './cors.ts'

export function jsonResponse(data: object, status: number = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function errorResponse(error: string, code: string, status: number = 400) {
  return jsonResponse({ error, code }, status)
}
```

#### `_shared/auth.ts`
```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export async function authenticateUser(req: Request) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return { user: null, error: 'NO_AUTH_HEADER' }
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } }
  })

  const { data: { user }, error } = await client.auth.getUser()

  return {
    user,
    error: error ? 'INVALID_TOKEN' : null,
    client
  }
}
```

#### `_shared/supabase.ts`
```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export function getServiceClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ??
                         Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!serviceRoleKey) {
    throw new Error('Missing SERVICE_ROLE_KEY environment variable')
  }

  return createClient(supabaseUrl, serviceRoleKey)
}

export function getAnonClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  return createClient(supabaseUrl, anonKey)
}
```

#### `_shared/logger.ts`
```typescript
export function createLogger(functionName: string) {
  const requestId = crypto.randomUUID().slice(0, 8)

  return {
    requestId,
    info: (message: string, ...args: any[]) =>
      console.log(`[${requestId}] [${functionName}] ${message}`, ...args),
    error: (message: string, ...args: any[]) =>
      console.error(`[${requestId}] [${functionName}] ERROR: ${message}`, ...args),
    warn: (message: string, ...args: any[]) =>
      console.warn(`[${requestId}] [${functionName}] WARN: ${message}`, ...args),
  }
}
```

### Edge Function Template (Use This!)
```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/response.ts'
import { authenticateUser } from '../_shared/auth.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

serve(async (req: Request) => {
  // 1. Handle CORS
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  const logger = createLogger('function-name')
  logger.info('Function invoked')

  try {
    // 2. Authenticate (if needed)
    const { user, error: authError } = await authenticateUser(req)
    if (authError) {
      return errorResponse('Unauthorized', authError, 401)
    }

    // 3. Parse input
    const body = await req.json()

    // 4. Validate input
    if (!body.required_field) {
      return errorResponse('Missing required_field', 'MISSING_FIELD', 400)
    }

    // 5. Business logic
    const admin = getServiceClient()
    // ... your logic here

    // 6. Return success
    return jsonResponse({ success: true, data: {} })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Unexpected error', message)
    return errorResponse('Internal server error', 'UNEXPECTED_ERROR', 500)
  }
})
```

---

## 3. SQL Best Practices

### Migration Standards
```sql
-- ============================================================================
-- INTENT: Short description of what this migration does
-- LAYER: Which architectural layer (1-7)
-- AUTHOR: Name/Team
-- DATE: YYYY-MM-DD
-- ============================================================================

-- WHY: Always explain why, not just what
-- RISK: Document any breaking changes or data migrations
-- ROLLBACK: How to undo if needed

-- Actual SQL here
```

### No Hardcoded Magic Values
❌ **BAD:**
```sql
where status = 'pending' or status = 'confirmed' or status = 'paid'
```

✅ **GOOD:**
```sql
-- Define enum or constant table
create type order_status as enum ('pending', 'confirmed', 'paid', 'cancelled');

-- Use the type
where status IN ('pending', 'confirmed', 'paid')
```

### RLS Policy Patterns (Reusable)
```sql
-- Pattern: User owns resource
create policy "Users can see their own X"
  on public.table_name
  for select
  using (auth.uid() = user_id);

-- Pattern: Org member access
create policy "Org members can manage X"
  on public.table_name
  for all
  using (
    exists (
      select 1 from public.org_members
      where org_id = table_name.org_id
        and user_id = auth.uid()
        and role in ('owner', 'admin')
    )
  );
```

---

## 4. TypeScript Standards

### Naming Conventions
- **Files**: `kebab-case.ts`
- **Types/Interfaces**: `PascalCase`
- **Functions**: `camelCase`
- **Constants**: `SCREAMING_SNAKE_CASE`
- **Database objects**: `snake_case`

### Type Safety
```typescript
// ❌ BAD: Any types
function processData(data: any) { ... }

// ✅ GOOD: Explicit types
interface OrderInput {
  event_id: string
  items: Array<{ ticket_type_id: string; quantity: number }>
  email: string
}

function processData(data: OrderInput) { ... }
```

### Error Handling
```typescript
// ❌ BAD: Silent failures
try {
  await doSomething()
} catch (e) {
  // Nothing
}

// ✅ GOOD: Explicit error handling
try {
  await doSomething()
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  logger.error('Failed to do something', { error: message })
  throw new Error(`Operation failed: ${message}`)
}
```

---

## 5. Code Organization

### Directory Structure
```
project/
├── .claude/                 # Agent instructions
│   ├── rules/              # Project rules
│   └── agents/             # Agent-specific guides
├── supabase/
│   ├── functions/
│   │   ├── _shared/        # MANDATORY: Shared code
│   │   └── [functions]/
│   └── migrations/         # Database migrations only
├── docs/                    # Architecture & specs
├── tests/                   # All test code
│   ├── integration/
│   ├── e2e/
│   └── fixtures/
└── tmp/                     # Temporary/throwaway code
    ├── spikes/
    ├── experiments/
    └── scratch/
```

### What Goes Where
- **Source code**: `supabase/`, `src/`, `packages/`
- **Tests**: `tests/` or `__tests__/`
- **Docs**: `docs/`
- **Temporary experiments**: `tmp/` (gitignored)
- **Build artifacts**: `.build/`, `dist/` (gitignored)

### What NEVER Goes in Root
- ❌ Loose SQL files (except maybe `schema.sql`)
- ❌ Test scripts
- ❌ Debug files
- ❌ Log files
- ❌ Python/Node scripts without purpose

---

## 6. File Size Guidelines

### When to Split Files
- **Edge Function > 300 lines**: Extract helpers to `_shared/` or local utils
- **SQL Migration > 500 lines**: Split into logical chunks (per layer)
- **Any file > 1000 lines**: Mandatory refactor

### Extraction Strategy
```typescript
// ❌ BAD: 500-line function
export async function createOrder(...) {
  // validation logic
  // pricing logic
  // inventory logic
  // payment logic
  // email logic
}

// ✅ GOOD: Composed functions
export async function createOrder(input: OrderInput) {
  await validateOrder(input)
  const pricing = await calculatePricing(input)
  await checkInventory(input.items)
  const order = await persistOrder(input, pricing)
  await initiatePayment(order)
  await queueEmail(order)
  return order
}
```

---

## 7. Comments & Documentation

### When to Comment
**ALWAYS comment:**
- **Why** a decision was made
- Security implications (RLS, auth, multi-tenant)
- Performance considerations
- Failure scenarios & edge cases
- Temporary workarounds (with TODO + ticket)

**NEVER comment:**
- What the code does (code should be self-documenting)
- Obvious logic

### Comment Style
```typescript
// ✅ GOOD: Explains WHY
// We use service role here because RLS would block cross-org transfers
// approved by security team (JIRA-123)
const admin = getServiceClient()

// ❌ BAD: Explains WHAT
// Create a service client
const admin = getServiceClient()
```

---

## 8. Testing Requirements

### Every Feature Must Have
1. **Happy path test**: Basic success scenario
2. **Failure test**: What happens when it fails
3. **Edge case tests**: Boundary conditions
4. **Security test**: RLS, auth, multi-tenant isolation

### Test Organization
```
tests/
├── integration/
│   └── edge-functions/
│       ├── create-order.test.ts
│       └── mollie-webhook.test.ts
├── e2e/
│   └── checkout-flow.test.ts
└── fixtures/
    └── test-data.sql
```

---

## 9. Security Checklist

Before merging ANY code, verify:
- [ ] RLS enabled on all new tables
- [ ] RLS policies tested with different roles
- [ ] No service role key in client code
- [ ] Input validation on all user input
- [ ] SQL injection prevented (parameterized queries)
- [ ] XSS prevented (sanitized output)
- [ ] Multi-tenant isolation verified
- [ ] Audit logging for sensitive operations

---

## 10. Refactoring Guidelines

### When to Refactor
**Immediate refactor (before commit):**
- Code duplication (DRY violation)
- Missing error handling
- No input validation
- Hard-coded secrets or config

**Next sprint refactor:**
- File > 300 lines
- Function > 50 lines
- Cyclomatic complexity > 10
- Test coverage < 80%

### Refactoring Process
1. **Write tests first** (if missing)
2. **Refactor incrementally** (small steps)
3. **Run tests after each change**
4. **Commit frequently** (reversible steps)
5. **Document changes** (in PR description)

---

## 11. Git Hygiene

### Commit Standards
```bash
# ✅ GOOD: Atomic, descriptive commits
git commit -m "feat: add shared auth helper to _shared/auth.ts

- Extract duplicated auth logic from 5 edge functions
- Centralize error codes
- Add JSDoc documentation

Closes #123"

# ❌ BAD: Vague, massive commits
git commit -m "fixes"
```

### Branch Naming
- `feat/feature-name` - New features
- `fix/bug-description` - Bug fixes
- `refactor/what-changed` - Code cleanup
- `docs/what-documented` - Documentation

---

## 12. Code Review Checklist

Before requesting review:
- [ ] No code duplication
- [ ] All shared code in `_shared/`
- [ ] No loose files in root
- [ ] No commented-out code
- [ ] All TODOs have tickets
- [ ] Tests pass
- [ ] TypeScript compiles (no errors)
- [ ] Follows naming conventions
- [ ] Security checklist complete

---

## 13. Anti-Patterns (Never Do This)

### ❌ Copy-Paste Programming
```typescript
// DON'T copy this to every function
const authHeader = req.headers.get('Authorization')
if (!authHeader) { ... }
```

### ❌ God Functions
```typescript
// DON'T write 500-line functions
async function doEverything() { ... }
```

### ❌ Magic Numbers/Strings
```typescript
// DON'T hardcode values
if (status === 'pending') { ... }

// DO use constants/enums
const OrderStatus = { PENDING: 'pending' } as const
if (status === OrderStatus.PENDING) { ... }
```

### ❌ Swallowed Errors
```typescript
// DON'T hide errors
try { ... } catch (e) { }
```

### ❌ Implicit Dependencies
```typescript
// DON'T rely on global state or hidden dependencies
// DO inject dependencies explicitly
```

---

## Summary: Golden Rules

1. **DRY**: If you copy-paste, you're doing it wrong
2. **YAGNI**: You Aren't Gonna Need It (don't over-engineer)
3. **KISS**: Keep It Simple, Stupid
4. **Fail Fast**: Validate early, fail explicitly
5. **Security First**: RLS, auth, validation - no shortcuts
6. **Test Everything**: Happy path + failures + edge cases
7. **Document Why**: Code explains what, comments explain why
8. **Clean as You Go**: Leave code better than you found it

---

**Remember:** Code is read 10x more than it's written. Optimize for readability and maintainability, not cleverness.
