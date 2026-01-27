# Flow Registry

> Master overzicht van alle flows in het COLOSS platform.
> Beheerd door @flow-keeper.

## Overview

| ID | Flow | Status | Sprints | Current | Tests |
|----|------|--------|---------|---------|-------|
| F001 | User Registration | 🔴 | 0/2 | - | ⬜ |
| F002 | User Login/Auth | 🔴 | 0/2 | - | ⬜ |
| F003 | Event Creation | 🔴 | 0/3 | - | ⬜ |
| F004 | Event Discovery | 🔴 | 0/2 | - | ⬜ |
| F005 | Ticket Selection | 🟡 | 1/2 | S1 Complete | ✅ |
| F006 | Checkout/Payment | 🔴 | 0/3 | - | ⬜ |
| F007 | Ticket Delivery | 🔴 | 0/2 | - | ⬜ |
| F008 | Communication | 🟢 | 1/1 | Done | ✅ |
| F009 | Refund Flow | 🔴 | 0/2 | - | ⬜ |
| F010 | Organizer Dashboard | 🔴 | 0/3 | - | ⬜ |
| F011 | Participants/Registrations | 🟢 | 1/1 | Done | ✅ |

## Status Legend

| Symbol | Status |
|--------|--------|
| 🔴 | Planned - Not started |
| 🟡 | Active - In development |
| 🟢 | Done - Fully implemented |
| ⚫ | Blocked - Waiting on dependency |

## Statistics

| Metric | Value |
|--------|-------|
| Total Flows | 11 |
| 🔴 Planned | 8 |
| 🟡 Active | 1 |
| 🟢 Done | 2 |
| ⚫ Blocked | 0 |

## Dependency Graph

```
F001 (User Registration)
  │
  ├──► F002 (User Login)
  │      │
  │      ├──► F003 (Event Creation)
  │      │      │
  │      │      ├──► F004 (Event Discovery)
  │      │      │      │
  │      │      │      └──► F005 (Ticket Selection)
  │      │      │             │
  │      │      │             └──► F006 (Checkout/Payment)
  │      │      │                    │
  │      │      │                    ├──► F007 (Ticket Delivery)
  │      │      │                    │
  │      │      │                    ├──► F009 (Refund)
  │      │      │                    │
  │      │      │                    └──► F011 (Participants/Registrations) ✅
  │      │      │
  │      │      └──► F010 (Organizer Dashboard)
  │      │
  │      └──► F008 (Communication) ✅
  │
  └──► F008 (Communication) ✅
```

## Sprint Planning

| Sprint | Focus | Flows | Status |
|--------|-------|-------|--------|
| 1 | Authentication | F001, F002 | 🔴 Planned |
| 2 | Events | F003, F010 | 🔴 Planned |
| 3 | Discovery | F004, F005 | 🟡 Partial (F005 S1 done) |
| 4 | Checkout | F006, F007 | 🔴 Planned |
| 5 | Support | F008, F009 | 🟡 Partial (F008 done) |

## Directory Structure

```
.claude-flow/flows/
├── registry.md                    # This file
├── f001-user-registration/
│   ├── flow.md
│   ├── sprints/
│   └── tests/
├── f002-user-login/
│   └── ...
├── f008-communication/
│   ├── flow.md                    # 🟢 Done
│   ├── sprints/
│   │   ├── plan.md
│   │   ├── architecture.md
│   │   └── review.md
│   └── tests/
├── f011-participants-registrations/
│   ├── flow.md                    # 🟢 Done
│   ├── sprints/
│   │   ├── s1-plan.md
│   │   ├── s1-architecture.md
│   │   ├── s1-review.md
│   │   └── s1-test-report.md
│   └── tests/
└── ...
```

---

*Last updated: 2025-01-27*
