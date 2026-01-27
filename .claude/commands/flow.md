---
name: flow
description: Implementeer een specifieke flow (F001, F002, etc.) volledig
---

# Flow Implementation Command

Je gaat flow **$ARGUMENTS** volledig implementeren met automatische agent orchestration.

## Pre-check
```bash
# Lees flow document
cat .claude-flow/flows/$(echo "$ARGUMENTS" | tr '[:upper:]' '[:lower:]')*.md
```

## Automatische Pipeline voor Flow $ARGUMENTS

### STAP 1: Flow Analyse
- Lees de flow documentatie volledig
- Check dependencies (zijn die 🟢?)
- Identificeer alle Supabase tables, RLS policies, Edge Functions
- Lijst alle test scenarios

### STAP 2: Database Layer
Maak/update migrations voor:
- Tables die in de flow staan
- RLS policies voor elke operatie
- Triggers indien nodig
- Indexes voor performance

### STAP 3: Edge Functions
Implementeer alle Edge Functions uit de flow:
- Auth checks
- Business logic
- Error handling
- Response formatting

### STAP 4: Types
Genereer/update TypeScript types:
- Database types
- API request/response types
- Shared interfaces

### STAP 5: Tests

**KRITIEK: Schrijf tests naar `.claude-flow/flows/{flow-id}/tests/` directory!**

```bash
# Ensure test directory exists
FLOW_ID=$(echo "$ARGUMENTS" | tr '[:upper:]' '[:lower:]' | grep -oE 'f[0-9]{3}')
mkdir -p .claude-flow/flows/$FLOW_ID/tests
```

Schrijf tests naar `.claude-flow/flows/{flow-id}/tests/`:
- `integration-tests.mjs` - Automated tests voor alle scenarios
- `manual-test.sql` - Manual SQL tests voor RLS + edge cases
- `README.md` - Test documentatie en run instructies

Test coverage:
- Elke test scenario uit de flow doc
- RLS policy tests (per tabel, per role)
- Edge Function tests (happy + error cases)
- Regression tests (bestaande functionaliteit blijft werken)

### STAP 6: Deploy
```bash
# Get project ref
PROJECT_REF=$(cat supabase/.temp/project-ref)

# Push migrations
supabase db push --linked

# Deploy nieuwe Edge Functions
for func in $(ls supabase/functions/ | grep -v _shared | grep -v .ts); do
  supabase functions deploy $func --project-ref $PROJECT_REF --use-api
done

# Verify
supabase functions list --project-ref $PROJECT_REF
```

### STAP 7: Update Flow Status
```
1. Update registry: flow status naar 🟢 Completed
2. Update shared.md met nieuwe status
3. Check welke flows nu unblocked zijn
```

## Output Format

Na elke stap, geef korte status:
```
✅ STAP 1: Flow F00X geanalyseerd - 5 tables, 3 Edge Functions, 8 test scenarios
✅ STAP 2: Migration 20240128_f00x.sql aangemaakt
✅ STAP 3: Edge Function validate-ticket aangemaakt
...
```

## START NU

Begin met STAP 1 voor flow $ARGUMENTS.
