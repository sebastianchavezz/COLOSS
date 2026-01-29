# Sprint S2: Mobile Ticket Scanner (BYOD)

**Flow**: F007 Ticket Delivery
**Sprint**: S2
**Status**: 🟡 In Progress
**Date**: 2026-01-29

## Overview

Bring Your Own Device (BYOD) scanner waarbij event medewerkers hun eigen telefoon kunnen gebruiken als ticket scanner.

## User Flow

1. Organisator klikt op "Scanner" in event sidebar
2. Pagina toont QR code met link naar mobile scanner URL
3. Medewerker scant QR code met telefoon
4. Opent mobile pagina → login indien nodig
5. Camera activeert → scan tickets direct

## Scope

### In Scope
- Scanner setup pagina in event sidebar (QR code generatie)
- Mobile camera scanner pagina
- html5-qrcode library integratie
- Real-time scan feedback (groen/rood/geel overlays)
- Statistieken weergave
- Device ID voor rate limiting
- Auth redirect flow

### Out of Scope
- Offline mode
- PWA installatie
- Batch scanning
- Speciale sessie koppeling

## Critical Files

### Te Creëren
| File | Doel |
|------|------|
| `web/src/pages/events/Scanner.tsx` | Scanner setup pagina voor sidebar |
| `web/src/pages/MobileScanner.tsx` | Mobile camera scanner interface |
| `web/src/hooks/useQrScanner.ts` | Custom hook voor html5-qrcode |
| `web/src/lib/device-id.ts` | Device ID generatie |

### Te Wijzigen
| File | Wijziging |
|------|-----------|
| `web/src/pages/EventDetail.tsx` | Add Scanner to sidebar navItems |
| `web/src/App.tsx` | Add routes for scanner pages |

## Technical Requirements

### Dependencies
- `html5-qrcode` - Camera QR scanning library

### Existing Infrastructure (No Changes)
- `scan_ticket` RPC - Already implemented in S1
- `get_scan_stats` RPC - Already implemented in S1
- `qrcode.react` - Already installed for QR generation

## Acceptance Criteria

- [ ] Scanner menu item visible in event sidebar
- [ ] QR code displays correct mobile scanner URL
- [ ] Mobile scanner requires authentication
- [ ] Camera permission request works
- [ ] Valid ticket scan shows green feedback
- [ ] Invalid ticket shows red feedback
- [ ] Already-used ticket shows yellow feedback
- [ ] Stats update after scan
- [ ] Haptic feedback on scan (navigator.vibrate)
- [ ] Manual token input fallback when camera denied

## Test Plan

| ID | Test | Expected |
|----|------|----------|
| T1 | Click Scanner in sidebar | Scanner page loads with QR code |
| T2 | Scan QR code with phone | Opens mobile scanner URL |
| T3 | Not logged in | Redirects to login, returns after |
| T4 | Accept camera permission | Camera view activates |
| T5 | Scan valid ticket QR | Green overlay, ticket checked in |
| T6 | Scan invalid QR | Red overlay with error message |
| T7 | Scan already-used ticket | Yellow overlay with check-in time |
| T8 | Manual token input | Works when camera denied |

---

*Created: 2026-01-29*
