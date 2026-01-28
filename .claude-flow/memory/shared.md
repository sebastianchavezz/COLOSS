# Shared Memory - COLOSS Project

> Dit bestand wordt gelezen door ALLE agents. Update na elke significante wijziging.

## Project Overview

**Project**: COLOSS - Sport Event Registration & Ticketing Backend
**Description**: Een waterdichte backend voor een modern Nederlands platform vergelijkbaar met atleta.cc
**Tech Stack**: Supabase (Postgres, Auth, Edge Functions), TypeScript, RLS-first

## Current State

- **Sprint**: F006 Checkout & Payment
- **Phase**: completed
- **Blockers**: none

## Architecture Layers

| Layer | Name | Status | Description |
|-------|------|--------|-------------|
| 0 | Constitution | Done | Project rules, scope, security principles |
| 1 | Identity & Multi-Tenant | Done | orgs, org_members, roles, RLS |
| 2 | Event Core | Done | events, event_settings, lifecycle |
| 3 | Participants & Registrations | Done | participants, registrations, dynamic questions |
| 4 | Tickets & Capacity | Done | ticket_types, tickets, QR codes |
| 5 | Orders & Payments | Done | orders, order_items, payments, webhooks |
| 6 | Self-Service & Mutations | Done | transfers, refunds, audit log |
| 7 | Integrations | Done | outbox pattern, async processing |

## Database Schema (Current)

### Core Tables
- `orgs` - Organisaties
- `org_members` - Leden per organisatie met rollen
- `events` - Evenementen
- `event_settings` - Instellingen per event
- `participants` - Deelnemers (Auth users of guests)
- `registrations` - Inschrijvingen
- `ticket_types` - Ticket soorten
- `tickets` - Individuele tickets met QR
- `orders` - Bestellingen
- `order_items` - Items per bestelling
- `payments` - Betalingen
- `audit_log` - Audit trail

### Communication Tables (NEW - Sprint Communication)
- `email_outbox` - Queue voor alle uitgaande emails
- `email_outbox_events` - Event sourcing voor status changes
- `message_batches` - Bulk job tracking
- `message_batch_items` - Recipients per batch
- `email_unsubscribes` - Unsubscribe registry (GDPR)
- `email_bounces` - Bounce history
- `message_templates` - Reusable email templates

## Key Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2025-01-27 | RLS-first approach | Security by default |
| 2025-01-27 | Multi-tenant via org_id | Isolatie per organisatie |
| 2025-01-27 | Supabase Auth | Native integratie |

## Completed Features

- [x] Database schema (7 layers)
- [x] RLS policies on all tables
- [x] Multi-tenant isolation
- [x] **Checkout & Payment Module** (Sprint F006)
  - [x] create-order-public: guest + authenticated checkout
  - [x] Atomic capacity validation (FOR UPDATE SKIP LOCKED)
  - [x] Server-side price calculation
  - [x] Mollie payment integration (create + webhook)
  - [x] Webhook idempotency (payment_events deduplication)
  - [x] Ticket issuance on payment success (ticket_instances)
  - [x] Confirmation email via email_outbox
  - [x] Overbooked failsafe + stale order cleanup
  - [x] Public token for order lookup without auth
- [x] **Communication Module** (Sprint Communication)
  - [x] Email Outbox pattern met exactly-once delivery
  - [x] Resend email provider integration
  - [x] Bulk messaging met batching
  - [x] Unsubscribe/bounce compliance (GDPR)
  - [x] Edge Functions: process-outbox, bulk-email, resend-webhook, unsubscribe
  - [x] Extended communication.* settings domain

## Known Issues

- None currently

## Active Sprint

**Sprint Communication - COMPLETED**

| Phase | Status | Notes |
|-------|--------|-------|
| Planning | ✅ | Plan in `.claude-flow/sprints/sprint-communication/plan.md` |
| Design | ✅ | Architecture in `.claude-flow/sprints/sprint-communication/architecture.md` |
| Implementation | ✅ | 2 migrations, 4 Edge Functions |
| Review | ✅ | Approved with minor suggestions |
| Testing | ✅ | RLS + function tests created |

---

## Active Flows

### Current Sprint Focus
*None - awaiting sprint start*

### Flow Progress

| Flow | Status | Progress | Blocker |
|------|--------|----------|---------|
| F001 | 🔴 Planned | 0% | - |
| F002 | 🔴 Planned | 0% | F001 |
| F003 | 🔴 Planned | 0% | F002 |
| F004 | 🔴 Planned | 0% | F003 |
| F005 | 🔴 Planned | 0% | F004 |
| F006 | 🟢 Completed | 100% | - |
| F007 | 🔴 Planned | 0% | F006 |
| F008 | 🟢 Completed | 100% | - |
| F009 | 🔴 Planned | 0% | F006 |
| F010 | 🔴 Planned | 0% | F003 |

### Upcoming Flows (Sprint 1)
- F001: User Registration
- F002: User Login/Auth

---

## Next Actions

1. Start Sprint 1 met @pm
2. Focus op F001 (User Registration) en F002 (User Login)
3. @architect designs authentication flows
4. @backend implementeert Edge Functions

---

*Last updated: 2025-01-27*
