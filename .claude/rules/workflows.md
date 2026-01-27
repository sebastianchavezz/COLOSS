# Development Workflows

## Feature Development Workflow
Elke feature volgt strikt deze volgorde:

1. **Plan Phase (`/project:plan`)**
   - Analyseer requirements.
   - Bepaal impact op datamodel.
   - Design RLS policies.
   - Output: Implementatie plan.

2. **Implementation Phase (`/project:implement`)**
   - **Stap 1: Database**: Maak tabellen, kolommen, relaties.
   - **Stap 2: Integrity**: Voeg constraints en indexes toe.
   - **Stap 3: Security**: Implementeer RLS policies.
   - **Stap 4: Logic**: Schrijf Edge Functions / Triggers.

3. **Verification Phase (`/project:test`)**
   - Run verificatie scripts.
   - Test failure scenarios.
   - Check audit logs.

4. **Review Phase (`/project:review`)**
   - Code review door `reviewer` agent.
   - Security audit.

## Bug Fix Workflow (`/project:debug`)
1. Reproduceer issue.
2. Schrijf falende test.
3. Fix issue.
4. Verifieer fix.
5. Check regressie.
