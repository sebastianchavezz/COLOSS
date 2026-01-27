---
name: review
description: Security-first code review
---

# Review Command

Review: **$ARGUMENTS**

## Review Scope
- Leeg = review recent gewijzigde files
- Specifiek = review alleen die files

## Automatische Review Checklist

### 🔴 CRITICAL: Security

#### RLS Check
```bash
# Alle tabellen moeten RLS hebben
grep -r "ENABLE ROW LEVEL SECURITY" supabase/migrations/
```

- [ ] ELKE tabel heeft RLS enabled
- [ ] Policies voor SELECT, INSERT, UPDATE, DELETE
- [ ] Geen `USING (true)` zonder goede reden
- [ ] `auth.uid()` correct gebruikt

#### Secrets Check
```bash
# Geen hardcoded secrets
grep -rE "(sk_|pk_|password|secret|key)\s*=" src/ supabase/
```

- [ ] Geen API keys in code
- [ ] Geen passwords in code
- [ ] Environment variables gebruikt

#### Auth Check
- [ ] Edge Functions checken auth
- [ ] Geen service_role key in client
- [ ] JWT correct gevalideerd

### 🟠 WARNING: Code Quality

- [ ] Geen `any` types
- [ ] Functies < 50 lines
- [ ] Geen magic numbers
- [ ] Error handling aanwezig
- [ ] Consistent naming

### 🟢 SUGGESTION: Best Practices

- [ ] Comments waar nodig
- [ ] Types geëxporteerd
- [ ] Consistent met rest codebase

## Output Format

```markdown
## Code Review: {scope}

### Verdict: ✅ APPROVED / ⚠️ CHANGES REQUESTED / ❌ REJECTED

### 🔴 Critical (MUST FIX)
| Issue | File | Line | Fix |
|-------|------|------|-----|
| {issue} | {file} | {line} | {fix} |

### 🟠 Warnings
- {warning}

### 🟢 Suggestions
- {suggestion}

### ✅ Good
- {positive feedback}
```

Begin nu met review.
