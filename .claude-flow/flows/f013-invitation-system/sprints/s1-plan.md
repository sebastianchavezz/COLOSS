# Sprint 1: Invitation System Core

## Scope
Complete invitation system met code generation, QR display, validation, en statistieken.

## User Stories

### US-1: Code Generation
Als organizer wil ik een uitnodigingscode kunnen genereren voor mijn event.

**Acceptance Criteria:**
- [x] Organizer kan code genereren voor specifiek event
- [x] Code is uniek en 8 karakters (alphanumeriek)
- [x] QR code wordt automatisch gegenereerd
- [x] Activation link wordt gegenereerd
- [x] Code heeft optionele expiry date
- [x] Code heeft optioneel max_uses limiet

### US-2: Code Redemption
Als uitgenodigde wil ik met een code toegang krijgen tot een event.

**Acceptance Criteria:**
- [x] Code kan gevalideerd worden (exists, not expired, has uses left)
- [x] Na redemption wordt user gelinkt aan event
- [x] Gebruik wordt gelogd (audit)
- [x] Code werkt voor zowel guests als authenticated users

### US-3: Statistics
Als organizer wil ik zien hoeveel mensen via uitnodigingen zijn gekomen.

**Acceptance Criteria:**
- [x] Aantal redemptions per code zichtbaar
- [x] Totaal nieuwe members in periode zichtbaar
- [x] Lijst van wie via welke code is gekomen

## Technical Tasks

### Database (Migration)
- [x] Create `invitation_codes` table
- [x] Create `invitation_redemptions` table
- [x] Add RLS policies
- [x] Add indexes for performance

### RPC Functions
- [x] `generate_invitation_code(event_id, options)` - Generate new code
- [x] `validate_invitation_code(code)` - Check if code is valid
- [x] `redeem_invitation_code(code, user_id?)` - Use the code
- [x] `get_invitation_stats(event_id)` - Get statistics

### Frontend
- [x] Invitation tab in event detail sidebar
- [x] Code generation form
- [x] QR code display
- [x] Copy activation link button
- [x] Statistics dashboard
- [x] Public accept page at /invite/:code

## Definition of Done
- [ ] All RLS policies tested
- [ ] Integration tests passing
- [ ] UI functional and responsive
- [ ] Documentation updated
