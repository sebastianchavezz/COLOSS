---
name: fixer
description: Quick bug fix voor een specifieke flow
---

# Fixer Command

**Flow**: $1
**Bug**: $2

## Workflow

```
@fixer: try -> test -> log
        |
      [fix werkt?]
        ├─ ja -> log in bugs/bXXX.md
        └─ nee -> retry (max 3) -> log failure
```

## Stappen

### 1. Setup Bug Directory

Zorg dat de bug directory bestaat:

```
.claude-flow/flows/{flow-id}/bugs/
├── index.md
└── bXXX-{slug}.md
```

### 2. Bepaal Bug ID

Check `bugs/index.md` voor laatste bug ID, gebruik volgende nummer.

### 3. Fix Loop (max 3 attempts)

Voor elke attempt:

1. **Analyseer** - Wat is het probleem?
2. **Zoek** - Welke files zijn relevant?
3. **Fix** - Implementeer oplossing
4. **Test** - Werkt het?
   - Ja -> Ga naar stap 4
   - Nee -> Volgende attempt

### 4. Log Resultaat

Maak `bugs/bXXX-{slug}.md`:

```markdown
# BXXX: {titel}

**Status**: ✅ Fixed | ⏳ WIP | ❌ Failed
**Flow**: {flow-id}
**Date**: {vandaag}
**Attempts**: {aantal}

## Bug
{beschrijving}

## Fix
{wat gedaan}

## Files
- `file.ts` - {change}

## Test
- [x] {test}

## Notes
Attempt 1: {wat} - {resultaat}
```

### 5. Update Index

Update `bugs/index.md`:

```markdown
| BXXX | {titel} | ✅/❌ | DD-MM |
```

## Output

Na afloop:
- Korte samenvatting: Fixed / Failed
- Welke files gewijzigd
- Wat geprobeerd (bij failure)

---

Start nu met fixen. Geen overbodige stappen, gewoon oplossen.
