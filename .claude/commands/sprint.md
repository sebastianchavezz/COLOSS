---
name: sprint
description: Start een volledige sprint met automatische agent orchestration
---

# Sprint Command

Je bent nu de **Sprint Orchestrator**. Je gaat een volledige sprint uitvoeren met VOLLEDIG AUTOMATISCHE execution.

## Input
De gebruiker heeft gevraagd: $ARGUMENTS

## KRITIEKE REGEL: VOLLEDIG AUTOMATISCH

**GEEN user input vragen tussen stappen. Ga ALTIJD automatisch door naar de volgende fase.**

Als iets faalt:
1. Log de error
2. Ga door met wat wel kan
3. Rapporteer aan het eind

## Automatische Pipeline

### FASE 1: Planning (@pm rol)
```
1. Lees .claude-flow/memory/shared.md
2. Lees .claude-flow/flows/registry.md
3. Identificeer/creëer flow directory in .claude-flow/flows/f0XX-name/
4. Maak sprint plan in sprints/s{n}-plan.md
5. OUTPUT: Sprint plan met scope en acceptance criteria
```

### FASE 2: Design (@architect rol)
```
1. Lees het sprint plan
2. Design de technische implementatie
3. Maak architecture doc in sprints/s{n}-architecture.md
4. OUTPUT: Design doc met SQL, interfaces, file structure
```

### FASE 3: Implementation (@backend + @web rol)
```
1. Implementeer database migrations in supabase/migrations/
2. Implementeer Edge Functions in supabase/functions/ (indien nodig)
3. Implementeer Frontend in web/src/ (indien nodig)
4. OUTPUT: Implementation complete
```

### FASE 4: Review (@reviewer rol)
```
1. Review alle nieuwe/gewijzigde code
2. Check RLS policies
3. Check security issues
4. Maak review doc in sprints/s{n}-review.md
5. OUTPUT: Review report (APPROVED/CHANGES_REQUESTED)
```

### FASE 5: Write Tests (@tester rol)
```
1. Schrijf SQL tests in tests/supabase/
2. Schrijf verification script in tests/verification/
3. Maak test report in sprints/s{n}-test-report.md
4. OUTPUT: Test files created
```

### FASE 6: Deploy to Supabase (AUTOMATISCH)
**Voer deze Bash commands direct uit:**

```bash
# 1. Push database migrations
supabase db push --linked

# 2. Deploy nieuwe Edge Functions (indien aanwezig)
for func in $(ls supabase/functions/ 2>/dev/null | grep -v _shared | grep -v .ts); do
  supabase functions deploy "$func" --project-ref $(cat supabase/.temp/project-ref) --use-api 2>/dev/null || true
done
```

### FASE 7: Run Tests (AUTOMATISCH)
**Voer deze Bash commands direct uit:**

```bash
# Get database URL
DB_URL=$(supabase status --linked 2>/dev/null | grep "DB URL" | awk '{print $3}')

# Run verification tests
if [ -n "$DB_URL" ]; then
  psql "$DB_URL" -f tests/verification/verify_*.sql 2>&1 | tail -50
fi

# Run RLS tests (optioneel, kan falen)
psql "$DB_URL" -f tests/supabase/*.sql 2>&1 | tail -100 || echo "Some tests may have failed"
```

### FASE 8: Git Commit & Push (AUTOMATISCH)
**Voer deze Bash commands direct uit:**

```bash
# Stage alle nieuwe files
git add -A

# Commit met descriptieve message
git commit -m "$(cat <<'EOF'
feat(F0XX): [Sprint naam]

- [Lijst van changes]
- [Migrations toegevoegd]
- [Tests toegevoegd]

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"

# Push naar origin
git push origin main
```

### FASE 9: Completion (@pm rol)
```
1. Update .claude-flow/flows/registry.md met nieuwe status
2. Update flow.md in de flow directory
3. OUTPUT: Sprint completion summary
```

## Execution Rules

1. **GEEN user input** tussen fases - ga ALTIJD automatisch door
2. **Bij Bash errors**: log de output en ga door
3. **Altijd commit**: ook als tests falen, commit de code
4. **Push altijd**: push naar GitHub zodat werk niet verloren gaat
5. **Update files direct** - niet alleen beschrijven

## Error Handling

Als een Bash command faalt:
```
1. Print de error output
2. Noteer in sprint summary
3. Ga door naar volgende fase
```

## Output Format

Na elke fase, print kort:
```
✅ FASE X: [naam] - DONE
   [1-2 zinnen over wat gedaan is]
```

Bij error:
```
⚠️ FASE X: [naam] - PARTIAL
   [Wat wel werkte]
   [Wat faalde]
```

## Start Nu

Begin met FASE 1. Voer ALLE fases uit zonder te stoppen.
