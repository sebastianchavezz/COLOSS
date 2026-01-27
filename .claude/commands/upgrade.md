---
name: upgrade
description: Upgrade een bestaande flow met nieuwe functionaliteit
---

# Upgrade Command

Je bent nu de **Upgrade Orchestrator**. Je gaat een BESTAANDE flow upgraden met nieuwe functionaliteit.

## Input
De gebruiker heeft gevraagd: $ARGUMENTS

**Formaat**: `/upgrade <flow-id> <beschrijving van upgrade>`

Bijvoorbeeld:
- `/upgrade f005-ticket-selection Add seat selection`
- `/upgrade f008-communication Add SMS support`

## KRITIEKE REGELS

1. **GEEN nieuwe flow maken** - Je werkt met een BESTAANDE flow
2. **Lees eerst de bestaande code** - Begrijp wat er al is
3. **Incrementele changes** - Voeg toe, vervang niet
4. **Behoud backwards compatibility** - Breek geen bestaande functionaliteit
5. **VOLLEDIG AUTOMATISCH** - Geen user input tussen stappen

## Automatische Pipeline

### FASE 1: Context Laden (@pm rol)

```
1. Parse flow ID uit input (bijv. "f005" of "f005-ticket-selection")
2. Lees bestaande flow:
   - .claude-flow/flows/{flow-id}/flow.md
   - .claude-flow/flows/{flow-id}/sprints/*.md
3. Lees registry: .claude-flow/flows/registry.md
4. Identificeer huidige sprint nummer (s1, s2, etc.)
5. Maak upgrade plan in sprints/s{n+1}-plan.md
6. OUTPUT: Upgrade plan met wat er toegevoegd/gewijzigd wordt
```

### FASE 2: Impact Analysis (@architect rol)

```
1. Lees bestaande migrations: supabase/migrations/*{flow-related}*.sql
2. Lees bestaande code:
   - Frontend: web/src/**/*{feature}*
   - Functions: supabase/functions/{feature}/*
3. Bepaal wat gewijzigd moet worden
4. Design de upgrade (additive, not destructive)
5. Maak architecture doc in sprints/s{n+1}-architecture.md
6. OUTPUT: Impact analysis + design doc
```

### FASE 3: Implementation (@backend + @web rol)

```
1. Maak NIEUWE migration files (nooit bestaande wijzigen!)
   - supabase/migrations/{timestamp}_{flow}_upgrade_{feature}.sql
2. Update/extend bestaande code files
3. Voeg nieuwe code toe waar nodig
4. OUTPUT: Implementation complete
```

### FASE 4: Review (@reviewer rol)

```
1. Review alle changes
2. Check backwards compatibility
3. Check RLS policies
4. Maak review doc in sprints/s{n+1}-review.md
5. OUTPUT: Review report
```

### FASE 5: Write & Run Tests (@tester rol)

**Schrijf tests voor de UPGRADE, niet de hele flow:**

```javascript
#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://yihypotpywllwoymjduz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpaHlwb3RweXdsbHdveW1qZHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NTM4NzUsImV4cCI6MjA4NDQyOTg3NX0.VGvocHahZb6kgUzZs5S1RZ8jgq9KWPb42qKVQ8Fqqs4";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let passed = 0, failed = 0;

async function test(name, fn) {
  try { await fn(); console.log(`✅ ${name}`); passed++; }
  catch (e) { console.log(`❌ ${name}: ${e.message}`); failed++; }
}

console.log("🧪 Upgrade Tests: {flow-id} - {upgrade-name}\n");

// Test new functionality
await test("New RPC exists", async () => { /* ... */ });

// Test existing functionality still works
await test("Existing RPC still works", async () => { /* ... */ });

console.log(`\n✅ Passed: ${passed} | ❌ Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
```

**Voer tests uit:**
```bash
node tests/integration/{flow-id}_upgrade_{feature}.test.mjs 2>&1
```

### FASE 6: Deploy (AUTOMATISCH)

```bash
# Push new migrations
supabase db push --linked 2>&1

# Deploy updated Edge Functions
for func in $(ls supabase/functions/ 2>/dev/null | grep -v _shared | grep -v .ts | head -5); do
  supabase functions deploy "$func" --project-ref $(cat supabase/.temp/project-ref) --use-api 2>/dev/null || true
done
```

### FASE 7: Post-Deploy Tests (AUTOMATISCH)

```bash
# Run upgrade tests
node tests/integration/{flow-id}_upgrade_{feature}.test.mjs 2>&1

# Run existing flow tests to verify no regression
node tests/integration/{flow-id}_*.test.mjs 2>&1 || true
```

### FASE 8: Git Commit & Push (AUTOMATISCH)

```bash
git add -A

git commit -m "$(cat <<'EOF'
feat({flow-id}): Upgrade - {feature name}

- {what was added/changed}
- Backwards compatible
- Tests passing

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"

git push origin main
```

### FASE 9: Update Docs (@pm rol)

```
1. Update flow.md met nieuwe sprint entry
2. Update registry.md (sprint count)
3. OUTPUT: Upgrade complete summary
```

## Verschil met /sprint

| Aspect | /sprint | /upgrade |
|--------|---------|----------|
| Flow | Maakt NIEUWE flow | Werkt met BESTAANDE flow |
| Docs | Nieuwe directory | Voegt toe aan bestaande |
| Code | Nieuwe files | Wijzigt/extend bestaande |
| Tests | Test hele feature | Test alleen upgrade |
| Migrations | Nieuwe tabellen | ALTER/ADD to existing |

## Migration Best Practices voor Upgrades

```sql
-- GOED: Additive changes
ALTER TABLE existing_table ADD COLUMN IF NOT EXISTS new_column TEXT;
CREATE INDEX IF NOT EXISTS idx_new ON existing_table(new_column);

-- GOED: Nieuwe functies
CREATE OR REPLACE FUNCTION new_rpc_function(...) ...

-- SLECHT: Destructive changes (VERMIJD!)
-- DROP TABLE existing_table;
-- ALTER TABLE existing_table DROP COLUMN old_column;
```

## Flow ID Parsing

Extract flow ID from input:
- `f005` → `f005-ticket-selection` (lookup in registry)
- `f005-ticket-selection` → direct match
- `ticket-selection` → fuzzy match in registry

## Example Usage

```
/upgrade f011 Add bulk status update

/upgrade f008-communication Add webhook retry with exponential backoff

/upgrade f005 Add seat map selection for venue events
```

## Start Nu

1. Parse de flow ID en upgrade beschrijving
2. Laad bestaande flow context
3. Voer ALLE fases uit zonder te stoppen
