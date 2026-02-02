# Shared Memory - COLOSS Project

> Dit bestand wordt gelezen door ALLE agents. Update na elke significante wijziging.

## Project Overview

**Project**: COLOSS - Sport Event Registration & Ticketing Backend
**Description**: Een waterdichte backend voor een modern Nederlands platform vergelijkbaar met atleta.cc
**Tech Stack**: Supabase (Postgres, Auth, Edge Functions), TypeScript, RLS-first

## Current State

- **Sprint**: F015 Products Module - COMPLETED
- **Phase**: S1 + S2 done
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
- `event_settings` - Instellingen per event (12 domains)
- `event_routes` - GPX routes met geometry
- `participants` - Deelnemers (Auth users of guests)
- `registrations` - Inschrijvingen
- `ticket_types` - Ticket soorten
- `tickets` - Individuele tickets met QR
- `orders` - Bestellingen
- `order_items` - Items per bestelling
- `payments` - Betalingen
- `audit_log` - Audit trail

### Communication Tables (Sprint Communication)
- `email_outbox` - Queue voor alle uitgaande emails
- `email_outbox_events` - Event sourcing voor status changes
- `message_batches` - Bulk job tracking
- `message_batch_items` - Recipients per batch
- `email_unsubscribes` - Unsubscribe registry (GDPR)
- `email_bounces` - Bounce history
- `message_templates` - Reusable email templates

### Event Communication Tables (F012 - Messaging + FAQ)
- `chat_threads` - Support threads (1 per participant per event), status: open/pending/closed
- `chat_messages` - Messages within threads (append-only, max 2000 chars)
- `chat_thread_reads` - Read receipts for organizers (UPSERT idempotent)
- `faq_items` - FAQ entries (org-wide or event-specific), status: draft/published

### Products Tables (F015 - Products Module)
- `products` - Extra producten (ticket_upgrade of standalone), met prijzen, capaciteit, sales window
- `product_variants` - Varianten per product (maten, kleuren) met eigen capaciteit
- `product_ticket_restrictions` - Junction table: welke tickets mogen welke products kopen
- `order_items` - Extended met product_id en product_variant_id

## Key Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2025-01-27 | RLS-first approach | Security by default |
| 2025-01-27 | Multi-tenant via org_id | Isolatie per organisatie |
| 2025-01-27 | Supabase Auth | Native integratie |
| 2026-01-28 | F003 All sprints complete | Event CRUD + Settings + GPX Routes |
| 2026-02-02 | F015 S1 Products data layer | Products, variants, ticket restrictions |

## Completed Features

- [x] Database schema (7 layers)
- [x] RLS policies on all tables
- [x] Multi-tenant isolation
- [x] **Event Creation Module** (F003 - Complete)
  - [x] Event CRUD (create, list, detail, update, delete)
  - [x] Event Settings (12 configuration domains)
  - [x] GPX Route Import (upload, preview, publish)
  - [x] Route Map Display (Leaflet)
  - [x] Role-based permissions
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
- [x] **Event Communication Module** (F012 - Messaging + FAQ)
  - [x] Threaded chat between participants and organizers (1 thread per participant per event)
  - [x] Materialized unread counters with trigger-based maintenance
  - [x] FAQ management with org-wide and event-specific scoping
  - [x] Rate limiting via messaging settings domain (configurable per event)
  - [x] Edge Functions: send-message, get-threads, get-thread-messages, update-thread-status, faq-crud, get-faqs
  - [x] Helper RPCs: get_or_create_chat_thread, mark_chat_thread_read, check_participant_event_access, get_messaging_settings, count_recent_participant_messages
  - [x] Full RLS: participant sees own thread, organizer sees org threads, public reads published FAQs
- [x] **Products Module** (F015 - Complete)
  - [x] S1: Products table (ticket_upgrade + standalone categories)
  - [x] S1: Product variants (sizes, colors with capacity)
  - [x] S1: Ticket restrictions (which tickets can buy which products)
  - [x] S1: Sales windows + capacity tracking
  - [x] S1: Extended order_items for products
  - [x] S1: 8 RPCs: create_product, update_product, delete_product, get_public_products, variant CRUD, set_restrictions
  - [x] S1: Views: v_product_stats, v_product_variant_stats
  - [x] S1: Full RLS: public view, org member view, admin manage
  - [x] S1: TypeScript types in web/src/types/products.ts
  - [x] S2: Product management UI in Organizer OS (EventProducts.tsx)
  - [x] S2: Product cards with image, price, status badges
  - [x] S2: Create/Edit modal with tabs (Basisinfo, Prijzen, Varianten, Beperkingen)
  - [x] S2: Variant management (add/delete)
  - [x] S2: Ticket restrictions for upgrades
  - [x] S2: Data layer (web/src/data/products.ts)

## Known Issues

- None currently

## Active Flows

### Flow Progress

| Flow | Status | Progress | Blocker |
|------|--------|----------|---------|
| F001 | 🟢 Completed | 100% | - |
| F002 | 🟢 Completed | 100% | - |
| F003 | 🟢 Completed | 100% | - |
| F004 | 🟢 Completed | 100% | - |
| F005 | 🟢 Completed | 100% | - |
| F006 | 🟢 Completed | 100% | - |
| F007 | 🟡 In Progress | 67% | S3 pending |
| F008 | 🟢 Completed | 100% | - |
| F009 | 🔴 Planned | 0% | F006 (done) |
| F010 | 🟡 In Progress | 67% | S1+S2 done, S3 pending |
| F011 | 🟢 Completed | 100% | - |
| F012 | 🟢 Completed | 100% | - |
| F015 | 🟢 Completed | 100% | - |

### Upcoming Flows
- F007 S3: Ticket Delivery (Email delivery + PDF)
- F010 S3: Organizer Dashboard Reports

---

## Next Actions

1. Continue F007 S3: Email delivery + PDF tickets
2. F010 S3: Reports (pending financing module)
3. Checkout integration for products (extend create-order-public)

---

*Last updated: 2026-02-02*
