# F014: Team/Member Management

## Overview
Simpele RBAC interface voor het beheren van teamleden binnen een organisatie.

## Existing Infrastructure
De `org_members` tabel en RBAC rollen bestaan al:
- **Tabel**: `org_members` (org_id, user_id, role)
- **Rollen**: `owner`, `admin`, `support`, `finance`
- **RLS**: Owners kunnen members beheren

## User Stories

### US-1: Bekijk teamleden
Als owner/admin wil ik alle teamleden van mijn organisatie zien.

### US-2: Voeg teamlid toe
Als owner wil ik een nieuw teamlid kunnen uitnodigen via email.

### US-3: Wijzig rol
Als owner wil ik de rol van een teamlid kunnen wijzigen.

### US-4: Verwijder teamlid
Als owner wil ik een teamlid kunnen verwijderen.

## Features

| Feature | Priority | Status |
|---------|----------|--------|
| List team members | P0 | 🔴 |
| Add member by email | P0 | 🔴 |
| Change member role | P0 | 🔴 |
| Remove member | P0 | 🔴 |

## Technical Scope

### Database
- Geen nieuwe tabellen nodig (org_members bestaat)
- Nieuwe RPCs voor member management

### Frontend
- Team page op /org/:orgSlug/team
- Member list met rol badges
- Add member form
- Role dropdown
- Delete confirmation

## Status
- 🟡 Active - Sprint 1 in progress
