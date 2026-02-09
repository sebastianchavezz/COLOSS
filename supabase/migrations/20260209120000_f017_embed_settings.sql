-- F017: Embeddable Widget - Embed Settings
-- Adds embed configuration domain to event_settings for domain whitelisting

-- Add embed_settings domain entries for existing events (optional feature)
-- Organizers can configure which domains are allowed to embed their event widget.
-- If no domains are configured (empty array), embedding is allowed from any domain.
--
-- Settings:
--   embed.enabled        (boolean) - Whether embed is enabled for this event
--   embed.allowed_domains (text[]) - Whitelisted domains (empty = allow all)

-- No schema changes needed: event_settings already supports arbitrary key-value
-- via the (event_id, domain, key, value) structure.
-- This migration just documents the new domain "embed" and its keys.

-- Verify event_settings table exists and has expected structure
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'event_settings'
    AND table_schema = 'public'
  ) THEN
    RAISE EXCEPTION 'event_settings table not found - F017 depends on F003';
  END IF;
END $$;

COMMENT ON TABLE event_settings IS
'Event configuration. Domains include: general, registration, communication, checkout, embed, etc. F017 adds embed domain with keys: enabled (boolean), allowed_domains (json array of strings).';
