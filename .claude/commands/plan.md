---
name: plan
description: Plan een nieuwe feature met flow-based approach
---

# Plan Command

Plan de implementatie voor: **$ARGUMENTS**

## Automatische Workflow

### STAP 1: Context Laden
```bash
cat .claude-flow/memory/shared.md
cat .claude-flow/flows/registry.md
```

### STAP 2: Flow Matching
- Welke flows (F001-F010) zijn relevant?
- Lees de relevante flow docs
- Check dependencies

### STAP 3: Analyse
- Welke Supabase tables zijn nodig?
- Welke RLS policies?
- Welke Edge Functions?
- Wat bestaat al vs wat moet nieuw?

### STAP 4: Plan Output

Schrijf plan naar `.claude-flow/sprints/sprint-{n}/plan.md`:

```markdown
# Sprint Plan: {feature}

## Flows
- F00X: {naam} - Relevant sections: {welke stappen}

## Scope

### Database
| Table | Action | RLS Policies |
|-------|--------|--------------|
| {table} | Create/Modify | {policies} |

### Edge Functions
| Function | Purpose | Auth |
|----------|---------|------|
| {name} | {doel} | Yes/No |

### Tests
- [ ] RLS tests voor {table}
- [ ] Function tests voor {function}

## Implementation Order
1. {eerste}
2. {tweede}
3. {derde}

## Out of Scope
- {wat niet in deze sprint}

## Estimated Effort
- Database: S/M/L
- Functions: S/M/L
- Tests: S/M/L
```

### STAP 5: Vraag Bevestiging
Toon het plan en vraag:
> Plan klaar. Typ `/implement` om te starten of geef feedback.

## NIET DOEN
- Geen code schrijven
- Geen migrations maken
- Alleen plannen en documenteren

Begin nu met STAP 1.
