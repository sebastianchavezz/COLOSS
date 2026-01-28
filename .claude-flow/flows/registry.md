# Flow Registry

> Master overzicht van alle flows in het COLOSS platform.
> Beheerd door @flow-keeper.

## Overview

| ID | Flow | Status | Sprints | Current | Tests |
|----|------|--------|---------|---------|-------|
| F001 | User Registration | 🟢 | 1/1 | Done | ✅ |
| F002 | User Login/Auth | 🟢 | 1/1 | Done | ✅ |
| F003 | Event Creation | 🟢 | 3/3 | Done | ✅ |
| F004 | Event Discovery | 🟢 | 1/1 | Done | ✅ |
| F005 | Ticket Selection | 🟢 | 2/2 | Done | ✅ |
| F006 | Checkout/Payment | 🟢 | 1/1 | S1 Complete | ✅ |
| F007 | Ticket Delivery | 🟡 | 1/3 | S1 Complete | ✅ |
| F008 | Communication | 🟢 | 1/1 | Done | ✅ |
| F009 | Refund Flow | 🔴 | 0/2 | - | ⬜ |
| F010 | Organizer Dashboard | 🔴 | 0/3 | - | ⬜ |
| F011 | Participants/Registrations | 🟢 | 1/1 | Done | ✅ |
| F012 | Event Communication (Messaging + FAQ) | 🟢 | 1/1 | Done | ✅ |

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
| Total Flows | 12 |
| 🔴 Planned | 2 |
| 🟡 Active | 1 |
| 🟢 Done | 9 |
| ⚫ Blocked | 0 |

## Dependency Graph

```
F001 (User Registration)
  │
  ├──► F002 (User Login)
  │      │
  │      ├──► F003 (Event Creation) ✅
  │      │      │
  │      │      ├──► F004 (Event Discovery) ✅
  │      │      │      │
  │      │      │      └──► F005 (Ticket Selection) ✅
  │      │      │             │
  │      │      │             └──► F006 (Checkout/Payment) ✅
  │      │      │                    │
  │      │      │                    ├──► F007 (Ticket Delivery) 🟡
  │      │      │                    │
  │      │      │                    ├──► F009 (Refund)
  │      │      │                    │
  │      │      │                    └──► F011 (Participants/Registrations) ✅
  │      │      │
  │      │      └──► F010 (Organizer Dashboard)
  │      │
  │      └──► F008 (Communication) ✅
  │              │
  │              └──► F012 (Event Communication: Messaging + FAQ) ✅
  │
  └──► F008 (Communication) ✅
         │
         └──► F012 (Event Communication: Messaging + FAQ) ✅
```

## Sprint Planning

| Sprint | Focus | Flows | Status |
|--------|-------|-------|--------|
| 1 | Authentication | F001, F002 | 🟢 Complete |
| 2 | Events | F003, F010 | 🟡 Partial (F003 done) |
| 3 | Discovery | F004, F005 | 🟢 Complete |
| 4 | Checkout | F006, F007 | 🟡 Partial (F007 S1 done) |
| 5 | Support | F008, F009 | 🟡 Partial (F008 done) |

## Directory Structure

```
.claude-flow/flows/
├── registry.md                    # This file
├── f001-user-registration/
│   ├── flow.md                    # 🟢 Done
│   ├── sprints/
│   │   ├── s1-plan.md
│   │   ├── s1-architecture.md
│   │   └── s1-review.md
│   └── tests/
│       └── integration-tests.mjs  # 12/12 passing
├── f002-user-login/
│   └── ...
├── f003-event-creation/
│   ├── flow.md                    # 🟢 Done
│   ├── sprints/
│   │   ├── s1-plan.md             # GPX Routes
│   │   ├── s1-architecture.md
│   │   ├── s1-review.md
│   │   ├── s1-test-report.md
│   │   ├── s2-plan.md             # Event CRUD
│   │   └── s3-plan.md             # Event Settings
│   ├── tests/
│   │   └── integration-tests.mjs  # 12/12 passing
│   └── bugs/
│       └── index.md               # B001 Leaflet fix
├── f006-checkout-payment/
│   ├── flow.md                    # 🟢 Done
│   ├── sprints/
│   │   ├── s1-plan.md
│   │   ├── s1-architecture.md
│   │   ├── s1-review.md
│   │   └── s1-test-report.md
│   └── tests/
│       └── integration-tests.mjs
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
├── f012-event-communication/
│   ├── flow.md                    # 🟢 Done
│   ├── sprints/
│   │   ├── s1-plan.md             # Backend: DB + RLS + Edge Functions
│   │   ├── s1-database-design.md  # Detailed column specs
│   │   ├── s1-architecture.md     # Architecture + ADRs
│   │   ├── s1-edge-function-interfaces.md  # TypeScript interfaces
│   │   └── s2-plan.md             # UI: Chat + Thread List + FAQ
│   ├── tests/
│   │   ├── test-plan.md           # 70 test scenarios
│   │   ├── test-requirements.md   # Test requirements
│   │   ├── full-test-suite.sql    # Complete 32-test SQL suite
│   │   ├── verification-final.sql # Integration verification
│   │   └── README.md              # Test results summary
│   └── bugs/
│       ├── index.md               # Bug tracker
│       └── b001_b005_f012_fixes.md # Fixes applied
└── ...
```

---

*Last updated: 2026-01-28*
