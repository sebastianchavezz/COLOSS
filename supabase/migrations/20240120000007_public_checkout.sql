-- PUBLIC CHECKOUT: Add public access token and purchaser name
--
-- Doel: Enable public checkout zonder authentication
-- - public_token_hash: beveiligde token voor order opzoeken zonder auth
-- - purchaser_name: optionele naam van koper (geen auth.users vereist)
--
-- Security:
-- - Token wordt gehashed (SHA-256) zodat DB leaks niet direct toegang geven
-- - Token is uniek per order
-- - Alleen Edge Functions met service role kunnen orders aanmaken
-- - Public kan alleen orders ophalen met correcte token

-- Add columns to orders table
alter table public.orders
  add column if not exists public_token_hash text unique,
  add column if not exists purchaser_name text;

comment on column public.orders.public_token_hash is
  'SHA-256 hash of public access token. Used to lookup order without authentication. Generated server-side.';
  
comment on column public.orders.purchaser_name is
  'Optional name of purchaser (for guest checkout). Not linked to auth.users.';

-- Index for fast token lookup
create index if not exists idx_orders_public_token_hash 
  on public.orders(public_token_hash) 
  where public_token_hash is not null;

-- Index for purchaser name (searching)
create index if not exists idx_orders_purchaser_name 
  on public.orders(purchaser_name) 
  where purchaser_name is not null;

comment on index idx_orders_public_token_hash is
  'Fast lookup for public checkout confirmation page';

-- ============================================================
-- HELPER FUNCTION: Generate random token (to be used in Edge Functions)
-- ============================================================

-- Note: Edge Functions will generate tokens using crypto.randomUUID() 
-- and hash them using Web Crypto API before storing.
-- We don't need a PL/pgSQL function here - it's handled in JavaScript.

-- ============================================================
-- RLS: Public token access
-- ============================================================

-- Allow public to read orders IF they have the correct token
-- This will be checked in Edge Function, not direct table access
-- So we keep RLS strict (no direct public SELECT)

comment on table public.orders is
  'Orders table. Access:
  - Org members: via event ownership
  - Users: via user_id match
  - Public: ONLY via get-order-public Edge Function (not direct SELECT)';

-- No new RLS policy needed - Edge Functions use service role
-- Public never queries orders table directly
