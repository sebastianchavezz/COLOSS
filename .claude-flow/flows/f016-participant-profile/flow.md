# Flow: Participant Profile

**ID**: F016
**Status**: 🟢 Done
**Total Sprints**: 1
**Current Sprint**: Done

## Sprints
| Sprint | Focus | Status |
|--------|-------|--------|
| S1 | Profile View + Edit + Actions | 🟢 |

## Dependencies
- **Requires**: F001, F003, F006, F011, F012
- **Blocks**: None

## Overview

Gedetailleerde profielpagina voor organizers om alle informatie over een deelnemer te bekijken en beheren.

```
Als organisator
Wil ik een volledig profiel van een deelnemer kunnen zien
Zodat ik alle relevante informatie in één overzicht heb

Als organisator
Wil ik deelnemer gegevens kunnen aanpassen
Zodat ik fouten kan corrigeren of updates kan doorvoeren

Als organisator
Wil ik direct een bericht kunnen sturen naar de deelnemer
Zodat ik snel kan communiceren zonder de chat te zoeken
```

## User Stories

### S1: Profile View
1. Klikbaar profiel vanuit participant lijst
2. Sidebar/modal met alle deelnemer info
3. Basis gegevens: naam, email, telefoon
4. Registratie info: ticket type, status, betaaldatum
5. Order geschiedenis
6. Chat thread link/preview
7. Audit log (laatste acties)

### S2: Profile Edit
1. Inline editing van naam, email, telefoon
2. Status wijzigen (bevestigd, geannuleerd, etc.)
3. Notities toevoegen
4. Audit log van wijzigingen

### S3: Quick Actions
1. "Stuur bericht" → opent chat
2. "Resend ticket" → stuurt ticket email opnieuw
3. "Refund" → start refund flow
4. "Check-in" → handmatig inchecken

## Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│              PARTICIPANTS LIST (F011)                    │
│  ┌─────────┬─────────┬─────────┬─────────┬─────────┐   │
│  │ Naam    │ Email   │ Ticket  │ Status  │ Actions │   │
│  ├─────────┼─────────┼─────────┼─────────┼─────────┤   │
│  │ Jan     │ jan@... │ VIP     │ ✓ Paid  │ [👁️]    │◄──┤ Click
│  └─────────┴─────────┴─────────┴─────────┴─────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              PARTICIPANT PROFILE (F016)                  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  👤 Jan de Vries                            [✏️]  │  │
│  │  📧 jan@example.com                               │  │
│  │  📱 +31 6 1234 5678                               │  │
│  ├───────────────────────────────────────────────────┤  │
│  │  REGISTRATIE                                      │  │
│  │  ┌─────────────────────────────────────────────┐  │  │
│  │  │ Event:     Marathon 26                      │  │  │
│  │  │ Ticket:    VIP Package (€149,00)           │  │  │
│  │  │ Status:    ✅ Betaald                       │  │  │
│  │  │ Betaald:   3 feb 2026, 14:32               │  │  │
│  │  │ Order:     #ORD-2026-001234                │  │  │
│  │  └─────────────────────────────────────────────┘  │  │
│  ├───────────────────────────────────────────────────┤  │
│  │  PRODUCTEN                                        │  │
│  │  • Finisher Medal (+€15)                          │  │
│  │  • Extra T-Shirt M (+€25)                         │  │
│  ├───────────────────────────────────────────────────┤  │
│  │  ACTIES                                           │  │
│  │  [💬 Stuur bericht] [📧 Resend ticket]           │  │
│  │  [💰 Refund]        [✅ Check-in]                │  │
│  ├───────────────────────────────────────────────────┤  │
│  │  GESCHIEDENIS                                     │  │
│  │  • 3 feb 14:32 - Betaling ontvangen              │  │
│  │  • 3 feb 14:30 - Order aangemaakt                │  │
│  │  • 2 feb 10:15 - Chat gestart                    │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Supabase

### RPC Functions
| Function | Purpose | Security |
|----------|---------|----------|
| `get_participant_profile` | Volledige profiel data | SECURITY DEFINER |
| `update_participant_profile` | Update profiel velden | SECURITY DEFINER |
| `get_participant_history` | Audit log entries | SECURITY DEFINER |

### Views
| View | Purpose |
|------|---------|
| `participant_profile_v` | Pre-joined profile data |

## Frontend

### Components
| Component | Purpose |
|-----------|---------|
| `ParticipantProfile.tsx` | Profiel sidebar/modal |
| `ParticipantProfileHeader.tsx` | Naam + contact info |
| `ParticipantRegistration.tsx` | Registratie details |
| `ParticipantProducts.tsx` | Gekochte producten |
| `ParticipantActions.tsx` | Quick action buttons |
| `ParticipantHistory.tsx` | Audit timeline |

### Routes
- Sidebar: `/org/:slug/events/:eventSlug/participants?profile=:participantId`
- Modal: Click on row → opens profile overlay

## Test Scenarios

| ID | Scenario | Expected | Status |
|----|----------|----------|--------|
| T1 | Org member can view profile | Data returned | 🔴 |
| T2 | Non-member blocked | 403 error | 🔴 |
| T3 | Edit participant name | Updated in DB | 🔴 |
| T4 | Send message action | Opens chat | 🔴 |
| T5 | History shows audit entries | Timeline displayed | 🔴 |

## Acceptance Criteria

- [ ] Klikbaar profiel vanuit participant lijst
- [ ] Alle basis gegevens zichtbaar
- [ ] Registratie + order details
- [ ] Gekochte producten lijst
- [ ] Quick actions werkend
- [ ] Audit history timeline
- [ ] RLS prevents cross-org access
- [ ] Mobile responsive

## Files

### Migrations
- `supabase/migrations/YYYYMMDD_f016_participant_profile.sql`

### Frontend
- `web/src/components/participants/ParticipantProfile.tsx`

---

*Created: 2026-02-03*
