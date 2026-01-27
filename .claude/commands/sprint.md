---
name: sprint
description: Start een volledige sprint met automatische agent orchestration
---

# Sprint Command

Je bent nu de **Sprint Orchestrator**. Je gaat een volledige sprint uitvoeren met automatische agent handoffs.

## Input
De gebruiker heeft gevraagd: $ARGUMENTS

## Automatische Pipeline

Voer de volgende stappen UIT in volgorde. Wacht NIET op bevestiging tussen stappen.

### FASE 1: Planning (@pm rol)
```
1. Lees .claude-flow/memory/shared.md
2. Lees .claude-flow/flows/registry.md
3. Identificeer welke flows bij de request passen
4. Lees de relevante flow docs in .claude-flow/flows/
5. Maak sprint plan in .claude-flow/sprints/sprint-{n}/plan.md
6. OUTPUT: Sprint plan met flows, taken, en acceptance criteria
```

### FASE 2: Design (@architect rol)
```
1. Lees het sprint plan
2. Lees de flow documentatie
3. Design de technische implementatie
4. Documenteer in .claude-flow/memory/decisions.md
5. Maak handoff in .claude-flow/handoffs/
6. OUTPUT: Design doc met interfaces, file structure, implementation order
```

### FASE 3: Implementation (@backend rol)
```
1. Lees design doc en handoff
2. Implementeer volgens spec:
   - Database: SQL migrations in supabase/migrations/
   - Edge Functions: in supabase/functions/
   - Types: in src/types/
3. Schrijf basic tests
4. OUTPUT: Implementation report met files created/modified
```

### FASE 4: Review (@reviewer rol)
```
1. Review alle nieuwe/gewijzigde code
2. Check RLS policies
3. Check security issues
4. OUTPUT: Review report met verdict (APPROVED/CHANGES_REQUESTED)
```

### FASE 5: Testing (@tester + @supabase-tester rol)
```
1. Run bestaande tests
2. Schrijf nieuwe tests voor de features
3. Test RLS policies met verschillende users
4. Test Edge Functions
5. OUTPUT: Test report met coverage en bugs
```

### FASE 6: Deployment (@backend rol)
```
1. Get project ref:
   PROJECT_REF=$(cat supabase/.temp/project-ref)

2. Push database migrations:
   supabase db push --linked

3. Deploy alle nieuwe Edge Functions:
   for func in $(ls supabase/functions/ | grep -v _shared | grep -v .ts); do
     supabase functions deploy $func --project-ref $PROJECT_REF --use-api
   done

4. Verify deployment:
   supabase functions list --project-ref $PROJECT_REF

5. OUTPUT: Deployment report met status
```

### FASE 7: Run Tests (@tester rol)
```
1. Get database URL:
   DATABASE_URL=$(supabase status --linked 2>/dev/null | grep "DB URL" | awk '{print $3}')

2. Run SQL tests:
   psql "$DATABASE_URL" -f tests/supabase/*.sql 2>&1 || echo "SQL tests skipped"

3. Run TypeScript integration tests:
   deno test --allow-env --allow-net tests/supabase/*.test.ts 2>&1 || echo "TS tests skipped"

4. OUTPUT: Test results
```

### FASE 8: Completion (@pm rol)
```
1. Update .claude-flow/flows/registry.md met nieuwe statussen
2. Update .claude-flow/memory/shared.md
3. Maak sprint summary in .claude-flow/sprints/sprint-{n}/summary.md
4. OUTPUT: Sprint completion report
```

## Execution Rules

1. **Geen user input nodig** tussen fases - ga automatisch door
2. **Bij blocker**: documenteer en ga door met wat wel kan
3. **Altijd output** per fase - geen stille failures
4. **Update files** direct - niet alleen beschrijven

## Start Nu

Begin met FASE 1. Analyseer de user request en start de pipeline.
