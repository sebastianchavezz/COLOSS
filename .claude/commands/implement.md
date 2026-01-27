---
name: implement
description: Implementeer volgens plan met automatische agent flow
---

# Implement Command

Implementeer: **$ARGUMENTS**

## Automatische Pipeline

### FASE 1: Plan Ophalen
```bash
# Check voor bestaand plan
cat .claude-flow/sprints/*/plan.md 2>/dev/null | tail -100
```

Als geen plan: maak quick inline plan eerst.

### FASE 2: Database Layer (@backend rol)
Voor elke table in het plan:

1. **Migration maken**
   ```sql
   -- supabase/migrations/{timestamp}_{feature}.sql
   -- Tabellen
   -- Constraints
   -- Indexes
   ```

2. **RLS Policies**
   ```sql
   ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "..." ON {table} FOR {action} USING (...);
   ```

3. **Triggers indien nodig**

### FASE 3: Edge Functions (@backend rol)
Voor elke function in het plan:

1. **Maak function directory**
   ```
   supabase/functions/{name}/index.ts
   ```

2. **Implementeer met template**
   ```typescript
   import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
   import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

   serve(async (req) => {
     // Auth check
     // Business logic
     // Response
   })
   ```

### FASE 4: Types (@backend rol)
Update `src/types/` met nieuwe interfaces.

### FASE 5: Basic Tests (@tester rol)
Voor elke nieuwe component:
- Happy path test
- Error case test
- RLS test

### FASE 6: Self-Review (@reviewer rol)
Quick check:
- [ ] RLS enabled?
- [ ] Auth checks?
- [ ] No hardcoded secrets?
- [ ] Error handling?

### FASE 7: Deploy
```bash
# Get project ref
PROJECT_REF=$(cat supabase/.temp/project-ref)

# Push migrations
supabase db push --linked

# Deploy Edge Functions
for func in $(ls supabase/functions/ | grep -v _shared | grep -v .ts); do
  supabase functions deploy $func --project-ref $PROJECT_REF --use-api
done

# Verify deployment
supabase functions list --project-ref $PROJECT_REF
```

## Output Format

Na elke fase, output:
```
✅ Database: migration 20240128_xxx.sql created
✅ RLS: 3 policies added
✅ Function: validate-ticket created
✅ Types: updated
✅ Tests: 5 tests added
✅ Review: PASSED
```

## Bij Errors
- Stop niet
- Documenteer de error
- Ga door met wat wel kan
- Rapporteer aan het eind

Begin nu met FASE 1.
