# Coding Standards & Style

## Algemeen
- **Taal**: TypeScript voor Edge Functions, SQL voor Database.
- **Naming**: Snake_case voor database (tabellen, kolommen), CamelCase voor TypeScript.
- **Comments**: Liever te veel dan te weinig. Leg uit **waarom**, niet wat.

## Database (SQL)
- **Constraints**: Gebruik constraints waar mogelijk (NOT NULL, UNIQUE, CHECK).
- **RLS**: Elke tabel MOET RLS enabled hebben.
- **Migrations**: Elke migratie moet idempotent zijn of veilig te herhalen.
- **Comments**:
  - Intent comment bovenaan elke file.
  - Inline comments bij complexe policies.

## Edge Functions (TypeScript)
- **Service Role**: Alleen gebruiken binnen Edge Functions, NOOIT in client code.
- **Error Handling**: Graceful failure, geen silent errors.
- **Types**: Gebruik gegenereerde Supabase types.

## Temp Code
- Alle test/spike code moet in een aparte directory (bijv. `.tmp/` of `tmp/`).
- Nooit in `src/` of `supabase/migrations/`.
- Header comment verplicht: Doel, Datum, Verwachte output.

## Documentation
- Documenteer aannames expliciet.
- Documenteer security implicaties (RLS, Auth).
- Documenteer failure scenarios.
