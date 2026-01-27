# Project: Sport Event Registration & Ticketing Backend (Supabase)

## Doel
Bouw een **waterdichte backend** voor een modern Nederlands platform vergelijkbaar met *atleta.cc* (sportinschrijvingen & ticketverkoop).
Het systeem moet schaalbaar, veilig (RLS-first) en auditable zijn.

## Tech Stack
- **Database**: Supabase Postgres
- **Auth**: Supabase Auth
- **Logic**: Edge Functions (Deno/TypeScript)
- **Security**: Row Level Security (RLS) op alle tabellen
- **Frontend**: React/Vite (web/), optioneel React Native (mobile/)

---

## Multi-Agent Workflow

Dit project gebruikt een multi-agent development pipeline met gespecialiseerde agents:

### Agent Roles

| Agent | Rol | Model | Doet NIET |
|-------|-----|-------|-----------|
| **@orchestrator** | Coördineert pipeline, tracked state | sonnet | Code schrijven |
| **@pm** | Sprint planning, documentatie | sonnet | Technische beslissingen |
| **@architect** | Design, structuur, interfaces | sonnet | Implementatie |
| **@backend** | Code implementatie | sonnet | Eigen design beslissingen |
| **@reviewer** | Code review, security audit | sonnet | Code fixen |
| **@tester** | Tests schrijven, bugs vinden | sonnet | Code fixen |
| **@supabase-tester** | Supabase DB/RLS tests | sonnet | Frontend code |
| **@web** | Web UI (React/Vite) - **DEFAULT** | haiku | Fancy styling |
| **@phone-ui** | Mobile UI (React Native) - *alleen op request* | sonnet | Web UI |
| **@flow-keeper** | Flow tracking, dependencies | sonnet | Code schrijven |

### UI Agent Rules

- **@web** is de DEFAULT voor alle UI taken
- **@phone-ui** alleen wanneer expliciet "mobile" of "React Native" gevraagd wordt
- Bij twijfel: gebruik @web

### Sprint Workflow

```
@pm ────► @architect ────► @backend ────► @reviewer ────► @tester ────► @pm
                              │                             │
                              ▼                             ▼
                            @web                    @supabase-tester
```

### Commands
- `/sprint [naam] - [beschrijving]` - Start volledige sprint pipeline
- `/flow [F00X]` - Implementeer specifieke flow
- `/plan [feature]` - Plan een nieuwe feature
- `/implement [spec]` - Implementeer volgens spec
- `/test` - Run alle tests
- `/review` - Review recente wijzigingen

---

## Flow-Based Development

Elke user journey is een "flow" met eigen directory en documentatie.

### Directory Structure (NEW)

```
.claude-flow/flows/
├── registry.md                    # Master overzicht
│
├── f001-user-registration/        # Elke flow = eigen directory
│   ├── flow.md                    # Flow definitie
│   ├── sprints/
│   │   ├── s1-setup.md
│   │   └── s2-validation.md
│   └── tests/
│       └── test-plan.md
│
├── f002-user-login/
│   └── ...
│
├── f008-communication/            # 🟢 DONE
│   ├── flow.md
│   ├── sprints/
│   │   ├── plan.md
│   │   ├── architecture.md
│   │   └── review.md
│   └── tests/
│
└── ...
```

### Flow Lifecycle

| Symbol | Status |
|--------|--------|
| 🔴 | Planned - Not started |
| 🟡 | Active - In development |
| 🟢 | Done - Fully implemented |
| ⚫ | Blocked - Waiting on dependency |

### Core Flows

| ID | Flow | Status | Sprints |
|----|------|--------|---------|
| F001 | User Registration | 🔴 | 0/2 |
| F002 | User Login/Auth | 🔴 | 0/2 |
| F003 | Event Creation | 🔴 | 0/3 |
| F004 | Event Discovery | 🔴 | 0/2 |
| F005 | Ticket Selection | 🔴 | 0/2 |
| F006 | Checkout/Payment | 🔴 | 0/3 |
| F007 | Ticket Delivery | 🔴 | 0/2 |
| F008 | Communication | 🟢 | 1/1 |
| F009 | Refund Flow | 🔴 | 0/2 |
| F010 | Organizer Dashboard | 🔴 | 0/3 |

### Flow Rules

1. **Directory per flow** - Elke flow heeft eigen directory
2. **Sprints in files** - Sprint progress in `sprints/` subdirectory
3. **Registry is truth** - `registry.md` is altijd up-to-date
4. **Dependencies matter** - Respecteer dependency graph

---

## Belangrijke Regels

- **Database is source of truth**.
- **RLS-first**: elke tabel heeft RLS aan + policies expliciet.
- **Ontwikkelvolgorde**: Datamodel -> Constraints -> RLS -> Edge Functions -> Tests.
- **Flow-first**: Documenteer de flow voordat je bouwt.
- Zie `.claude/rules/` voor gedetailleerde regels.

---

## Project Structure

```
COLOSS/
├── .claude/
│   ├── agents/           # Agent definitions
│   │   ├── web.md        # DEFAULT UI agent (haiku)
│   │   ├── phone-ui.md   # Mobile agent (sonnet, on request)
│   │   ├── backend.md
│   │   └── ...
│   ├── commands/         # Slash commands
│   └── rules/            # Project rules
│
├── .claude-flow/
│   ├── memory/
│   │   ├── shared.md     # Shared context
│   │   └── decisions.md  # ADRs
│   ├── flows/
│   │   ├── registry.md   # Master flow registry
│   │   ├── f001-.../     # Flow directories
│   │   └── ...
│   └── state.json        # Pipeline state
│
├── supabase/
│   ├── migrations/       # Database migrations
│   ├── functions/        # Edge Functions
│   └── config.toml       # Local dev config
│
└── web/                  # React/Vite frontend
    ├── src/
    └── ...
```

---

## Quick Start

### Start een Sprint
```
/sprint Authentication - User Registration + Login (F001, F002)
```

### Check Flow Status
```
@flow-keeper Status
```

### Implementeer een Flow
```
/flow F001
```

### Start Web Dev Server
```bash
cd web && npm run dev
```
