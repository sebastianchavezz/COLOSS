-- Add public_token_created_at to orders
-- Part of Public Checkout MVP

alter table public.orders
add column if not exists public_token_created_at timestamptz null;

-- Comment
comment on column public.orders.public_token_created_at is 'Timestamp when the public token was generated. Used for expiration checks.';
