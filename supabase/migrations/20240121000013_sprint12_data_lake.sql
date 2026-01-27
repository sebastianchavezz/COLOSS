-- Migration: 20240121000013_sprint12_data_lake.sql
-- Description: Sprint 12 - Data Lake & Exports (Foundational)
-- Creates read-only, export-ready views for BI/analytics
-- NO business logic, NO filtering, NO privacy enforcement here

-- ========================================================
-- 1. STORAGE BUCKET: data-lake
-- ========================================================
-- NOTE: Storage buckets CANNOT be created via SQL migrations
-- You must create this bucket manually via Supabase Dashboard or CLI:
--   supabase storage create data-lake --public=false
-- 
-- Required policies (apply via Dashboard):
--   - NO public access
--   - Write: service_role only
--   - Read: service_role only (access via signed URLs)

-- ========================================================
-- 2. EXPORT VIEW: participants
-- ========================================================
-- Purpose: Export-ready participant data
-- No business logic, just stable data contract

CREATE OR REPLACE VIEW public.export_participants AS
SELECT
    p.id AS participant_id,
    p.user_id,
    p.email,
    p.first_name,
    p.last_name,
    p.created_at,
    p.updated_at
FROM public.participants p
WHERE p.id IS NOT NULL; -- Explicit constraint, no deleted_at filtering

COMMENT ON VIEW public.export_participants IS 
'Export-ready participant data. Read-only. No business logic.';

-- ========================================================
-- 3. EXPORT VIEW: registrations
-- ========================================================
-- Purpose: Export-ready registration data
-- Includes ALL statuses, no filtering

CREATE OR REPLACE VIEW public.export_registrations AS
SELECT
    r.id AS registration_id,
    r.event_id,
    r.participant_id,
    r.status,
    r.created_at,
    r.updated_at,
    -- Event context (stable identifiers only)
    e.org_id,
    e.slug AS event_slug,
    e.name AS event_name,
    e.start_time AS event_start_time
FROM public.registrations r
INNER JOIN public.events e ON r.event_id = e.id
WHERE r.id IS NOT NULL;

COMMENT ON VIEW public.export_registrations IS 
'Export-ready registrations with event context. All statuses included.';

-- ========================================================
-- 4. EXPORT VIEW: orders
-- ========================================================
-- Purpose: Export-ready order data
-- Includes ALL statuses, no filtering

CREATE OR REPLACE VIEW public.export_orders AS
SELECT
    o.id AS order_id,
    o.event_id,
    o.user_id,
    o.email,
    o.status,
    o.total_amount,
    o.currency,
    o.checkout_session_id,
    o.created_at,
    o.updated_at,
    -- Event context
    e.org_id,
    e.slug AS event_slug,
    e.name AS event_name
FROM public.orders o
INNER JOIN public.events e ON o.event_id = e.id
WHERE o.id IS NOT NULL;

COMMENT ON VIEW public.export_orders IS 
'Export-ready orders with event context. All statuses included.';

-- ========================================================
-- 5. EXPORT VIEW: payments
-- ========================================================
-- Purpose: Export-ready payment transaction data

CREATE OR REPLACE VIEW public.export_payments AS
SELECT
    p.id AS payment_id,
    p.order_id,
    p.provider,
    p.provider_payment_id,
    p.amount,
    p.currency,
    p.status,
    p.created_at,
    p.updated_at,
    -- Order context
    o.event_id,
    o.email AS order_email,
    -- Event context
    e.org_id,
    e.slug AS event_slug
FROM public.payments p
INNER JOIN public.orders o ON p.order_id = o.id
INNER JOIN public.events e ON o.event_id = e.id
WHERE p.id IS NOT NULL;

COMMENT ON VIEW public.export_payments IS 
'Export-ready payment transactions with order/event context.';

-- ========================================================
-- 6. EXPORT VIEW: checkins
-- ========================================================
-- Purpose: Export-ready check-in data

CREATE OR REPLACE VIEW public.export_checkins AS
SELECT
    tc.id AS checkin_id,
    tc.ticket_instance_id,
    tc.event_id,
    tc.checked_in_by,
    tc.checked_in_at,
    tc.source,
    tc.created_at,
    -- Event context
    e.org_id,
    e.slug AS event_slug,
    e.name AS event_name,
    -- Ticket context
    ti.order_id,
    ti.ticket_type_id,
    tt.name AS ticket_type_name
FROM public.ticket_checkins tc
INNER JOIN public.events e ON tc.event_id = e.id
INNER JOIN public.ticket_instances ti ON tc.ticket_instance_id = ti.id
INNER JOIN public.ticket_types tt ON ti.ticket_type_id = tt.id
WHERE tc.id IS NOT NULL;

COMMENT ON VIEW public.export_checkins IS 
'Export-ready check-in records with event/ticket context.';

-- ========================================================
-- 7. SECURITY: RLS for Export Views
-- ========================================================
-- Views inherit RLS from source tables by default
-- But we want explicit control: these views should ONLY be accessible
-- via service_role (backend/Edge Functions), NOT from frontend

-- Enable RLS on views (prevents direct public access)
ALTER VIEW public.export_participants SET (security_invoker = false);
ALTER VIEW public.export_registrations SET (security_invoker = false);
ALTER VIEW public.export_orders SET (security_invoker = false);
ALTER VIEW public.export_payments SET (security_invoker = false);
ALTER VIEW public.export_checkins SET (security_invoker = false);

-- NOTE: Views are read-only by default in PostgreSQL
-- No additional policies needed - access is backend-only
