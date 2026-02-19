# Flow Registry

> Master overzicht van alle flows in het COLOSS platform.
> Beheerd door @flow-keeper.

## Overview

| ID | Flow | Status | Sprints | Current | Tests |
|----|------|--------|---------|---------|-------|
| F001 | User Registration | 🟢 | 2/2 | S2 Profile Management | ✅ |
| F002 | User Login/Auth | 🟢 | 1/1 | Done | ✅ |
| F003 | Event Creation | 🟢 | 4/4 | S4 Modern Map Styles | ✅ |
| F004 | Event Discovery | 🟢 | 1/1 | Done | ✅ |
| F005 | Ticket Selection | 🟢 | 3/3 | S3 Subscription Tickets | ✅ |
| F006 | Checkout/Payment | 🟢 | 6/6 | S6 Subscription Checkout | ✅ |
| F007 | Ticket Delivery | 🟢 | 3/3 | S3 Email+PDF Complete | ✅ |
| F008 | Communication | 🟢 | 2/2 | S2 Transactional Email Integration | ✅ |
| F009 | Refund Flow | 🟢 | 1/1 | Done | ✅ |
| F010 | Organizer Dashboard | 🟡 | 2/3 | S2 Complete | ✅ |
| F011 | Participants/Registrations | 🟢 | 1/1 | Done | ✅ |
| F012 | Event Communication (Messaging + FAQ) | 🟢 | 3/3 | S3 Open Chat | ✅ |
| F013 | Invitation System | 🟢 | 1/1 | Done | ✅ |
| F014 | Team Management (RBAC) | 🟢 | 1/1 | Done | ✅ |
| F015 | Products (Upgrades & Merchandise) | 🟢 | 3/3 | S3 Product Upsell Flow | ✅ |
| F016 | Participant Profile | 🟢 | 1/1 | Done | ✅ |
| F017 | Embeddable Widget | 🟢 | 1/1 | Done | ✅ |

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
| Total Flows | 17 |
| 🔴 Planned | 0 |
| 🟡 Active | 1 |
| 🟢 Done | 16 |
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
  │      │      │                    ├──► F007 (Ticket Delivery) ✅
  │      │      │                    │
  │      │      │                    ├──► F009 (Refund) ✅
  │      │      │                    │
  │      │      │                    ├──► F011 (Participants/Registrations) ✅
  │      │      │                    │
  │      │      │                    └──► F015 (Products) ✅
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
| 4 | Checkout | F006, F007 | 🟡 Partial (F007 S2 done) |
| 5 | Support | F008, F009 | 🟢 Complete |
| 6 | Products | F015 | 🟢 Complete |
| 7 | Subscriptions | F005 S3, F006 S6 | 🟢 Complete |

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
├── f009-refund-flow/
│   ├── flow.md                    # 🟢 Done
│   ├── sprints/
│   │   ├── s1-plan.md
│   │   ├── s1-architecture.md
│   │   └── s1-review.md
│   └── tests/
│       └── integration-tests.mjs  # 10/10 passing
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

*Last updated: 2026-02-19*
