# Supabase Local Setup

> Run `npx supabase start` to start all services.

## URLs & Keys

| Service | URL |
|---------|-----|
| **Studio** | http://127.0.0.1:54323 |
| **API** | http://127.0.0.1:54321 |
| **REST** | http://127.0.0.1:54321/rest/v1 |
| **GraphQL** | http://127.0.0.1:54321/graphql/v1 |
| **Mailpit** | http://127.0.0.1:54324 |

## Database Connection

```
postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

### Direct psql access:
```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres
```

### Run SQL file:
```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f tests/my-test.sql
```

## Authentication Keys (Local)

| Key | Value |
|-----|-------|
| Publishable | `sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH` |
| Secret | `sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz` |

## Common Commands

```bash
# Start local Supabase
npx supabase start

# Stop all services
npx supabase stop

# Status check
npx supabase status

# Reset database (wipe + rerun migrations)
npx supabase db reset

# Push migrations to local
npx supabase db push

# Generate TypeScript types
npx supabase gen types typescript --local > src/types/supabase.ts

# Run Edge Functions locally
npx supabase functions serve
```

## Test API Connection

```bash
curl http://127.0.0.1:54321/rest/v1/ \
  -H "apikey: sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"
```

---

*Last updated: 2025-01-28*
