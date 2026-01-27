---
name: debug
description: Systematisch debuggen van problemen
---

# Debug Command

Debug: **$ARGUMENTS**

## Debug Workflow

### 1. Probleem Begrijpen
- Wat is het exacte symptoom?
- Wanneer gebeurt het?
- Reproduceerbaar?

### 2. Context Verzamelen
```bash
# Recent errors
grep -i error .claude-flow/logs/*.log 2>/dev/null | tail -20

# Supabase logs (indien beschikbaar)
supabase functions logs 2>/dev/null | tail -20

# Recent changes
git log --oneline -5 2>/dev/null
```

### 3. Hypotheses

Maak lijst van mogelijke oorzaken:
1. {hypothese}
2. {hypothese}
3. {hypothese}

### 4. Test Hypotheses

Voor elke hypothese:
- Hoe testen?
- Resultaat?

### 5. Root Cause

Na analyse:
- Wat is de echte oorzaak?
- Waarom werd dit niet eerder gevonden?

### 6. Fix

Implementeer minimale fix:
- Alleen wat nodig is
- Met test

### 7. Prevent

Hoe voorkomen we dit in de toekomst?
- Extra test?
- Betere error handling?

## Output Format

```markdown
## Debug Report: {probleem}

### Symptoom
{beschrijving}

### Root Cause
{oorzaak}

### Fix
{wat is gewijzigd}

### Test
{hoe getest dat het werkt}

### Prevention
{hoe voorkomen}

### Files Changed
- {file}: {change}
```

Begin nu met debuggen.
