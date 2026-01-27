# Architecture Decision Records

> Documenteer ELKE significante technische beslissing hier.

---

## 2025-01-27 - RLS-First Security Model

**Context**: We bouwen een multi-tenant platform waar organisaties hun eigen events en data beheren.

**Options Considered**:
1. Application-level security: Check permissions in Edge Functions
   - Pro: Flexibel
   - Con: Single point of failure, kan vergeten worden
2. RLS-first: Database enforces security
   - Pro: Defense in depth, altijd actief
   - Con: Complexere queries soms

**Decision**: RLS-first approach

**Rationale**: Security moet gegarandeerd zijn op database niveau. Application bugs mogen nooit leiden tot data leaks.

**Implications**:
- Elke tabel MOET RLS enabled hebben
- Elke operatie moet een policy hebben
- Testing moet RLS bypass vs normal user vergelijken

---

## 2025-01-27 - Multi-Tenant via org_id

**Context**: Meerdere organisaties gebruiken het platform.

**Options Considered**:
1. Separate databases per org
   - Pro: Complete isolation
   - Con: Operationeel complex, duur
2. Single database with org_id
   - Pro: Eenvoudig, goedkoop
   - Con: Vereist strikte RLS

**Decision**: Single database met org_id kolom en RLS

**Rationale**: Supabase RLS maakt dit veilig en het is veel eenvoudiger te beheren.

**Implications**:
- Elke content-tabel heeft org_id
- RLS policies checken org membership
- org_members tabel bepaalt access

---

## 2025-01-27 - Supabase Auth Integration

**Context**: Users moeten kunnen authenticeren.

**Options Considered**:
1. Custom auth (JWT, sessions)
   - Pro: Full control
   - Con: Security risk, veel werk
2. Supabase Auth
   - Pro: Native RLS integratie, bewezen security
   - Con: Vendor lock-in

**Decision**: Supabase Auth

**Rationale**: auth.uid() in RLS policies is elegant. Social logins out of the box.

**Implications**:
- Auth users linken aan participants
- JWT tokens voor API calls
- auth.uid() in alle user-scoped RLS

---

*Voeg nieuwe beslissingen BOVENAAN toe met datum*
