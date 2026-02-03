# B001: "Stuur bericht" redirect werkt niet

**Status**: ✅ Fixed
**Flow**: F016 Participant Profile
**Date**: 03-02-2026
**Attempts**: 2

## Bug
Klikken op "Stuur bericht" button in ParticipantProfile sidebar doet niets - geen navigatie naar messaging pagina.

## Root Cause
Console output toonde URL zonder leading slash: `org/demo/events/...` ipv `/org/demo/events/...`
Dit kwam doordat de template literal `/org/${orgSlug}/...` niet correct werkte - vermoedelijk door hoe de props werden doorgegeven of een timing issue.

## Fix
Vervangen URL constructie met path-based approach:
- Pak huidige URL path (`/org/{org}/events/{event}/participants`)
- Vervang `/participants` met `/messaging`
- Dit is robuuster dan props-gebaseerde URL constructie

## Files
- `web/src/components/participants/ParticipantProfile.tsx`
  - `handleOpenChat` - URL nu gebaseerd op huidige path
  - Event handling verbeterd (preventDefault, stopPropagation)
  - Beide buttons hebben `type="button"`

## Test
- [ ] Klik op "Stuur bericht" -> navigeert naar messaging
- [ ] Klik op "Bekijken" (chat section) -> navigeert naar messaging met thread

## Notes
- Attempt 1: Event handling fixes - navigatie nog steeds niet werkend
- Attempt 2: Path-based URL constructie - zou moeten werken
