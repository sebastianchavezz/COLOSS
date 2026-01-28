# Sprint 1: Team Management UI

## Scope
Simpele UI voor het beheren van teamleden met RBAC.

## User Stories

### US-1: List Members
Als owner/admin wil ik alle teamleden zien.

**Acceptance Criteria:**
- [x] Tabel met naam, email, rol, joined date
- [x] Rol badge met kleur per rol
- [x] Alleen zichtbaar voor org members

### US-2: Add Member
Als owner wil ik een nieuw teamlid toevoegen.

**Acceptance Criteria:**
- [x] Form met email input
- [x] Rol selector (admin, support, finance)
- [x] Validatie: email format
- [x] Error handling: user not found

### US-3: Change Role
Als owner wil ik de rol van een teamlid wijzigen.

**Acceptance Criteria:**
- [x] Dropdown met rollen
- [x] Kan eigen rol niet wijzigen
- [x] Owner rol niet toekenbaar (alleen bij org creation)

### US-4: Remove Member
Als owner wil ik een teamlid kunnen verwijderen.

**Acceptance Criteria:**
- [x] Delete button
- [x] Confirmation modal
- [x] Kan zichzelf niet verwijderen

## Technical Tasks

### Database (RPC Functions)
- [x] `list_org_members(org_id)` - List all members
- [x] `invite_org_member(org_id, email, role)` - Add by email
- [x] `update_member_role(member_id, role)` - Change role
- [x] `remove_org_member(member_id)` - Remove member

### Frontend
- [x] TeamPage component
- [x] MemberList component
- [x] AddMemberForm component
- [x] RoleBadge component
- [x] DeleteConfirmation modal

## Definition of Done
- [ ] All RPC functions working
- [ ] Integration tests passing
- [ ] UI functional
