# F013: Invitation System

## Overview
Systeem voor het uitnodigen van nieuwe leden/deelnemers via activatielinks, QR codes, of manuele codes.

## User Stories

### US-1: Organizer genereert uitnodiging
Als organizer wil ik een uitnodiging kunnen genereren zodat ik nieuwe deelnemers kan uitnodigen.

### US-2: Deelnemer accepteert uitnodiging
Als deelnemer wil ik via een link/code kunnen registreren zodat ik toegang krijg tot het event.

### US-3: Organizer bekijkt statistieken
Als organizer wil ik zien hoeveel nieuwe leden er via uitnodigingen zijn bijgekomen.

## Features

| Feature | Priority | Status |
|---------|----------|--------|
| Activation Code Generation | P0 | 🔴 |
| QR Code Display | P0 | 🔴 |
| Activation Link | P0 | 🔴 |
| Code Validation & Redemption | P0 | 🔴 |
| Usage Statistics | P1 | 🔴 |
| Bulk CSV Import | P2 | 🔴 |

## Dependencies

- F001: User Registration (voor nieuwe users)
- F002: User Login/Auth (voor authenticatie)
- F003: Event Creation (voor event context)

## Technical Scope

### Database
- `invitation_codes` - Uitnodigingscodes per event/org
- RLS policies voor org-based access

### Edge Functions
- `generate-invitation-code` - Maak nieuwe code
- `validate-invitation-code` - Valideer en redeem code
- `get-invitation-stats` - Statistieken ophalen

### Frontend
- Invitation management UI in event sidebar
- Public invitation accept page

## Status
- 🟡 Active - Sprint 1 in progress
