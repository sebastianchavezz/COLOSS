-- ===========================================================================
-- F007 UPGRADE: Scanning Settings Domain
-- Migration: 20250127210002_f007_scanning_settings_domain.sql
--
-- Purpose:
-- - Add 'scanning' domain to event_settings
-- - Default settings for ticket scanning configuration
-- ===========================================================================

-- ===========================================================================
-- 1. UPDATE DOMAIN CONSTRAINT
-- ===========================================================================

-- Drop existing constraint
DO $$
BEGIN
  ALTER TABLE event_settings DROP CONSTRAINT IF EXISTS event_settings_domain_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Add updated constraint with 'scanning'
ALTER TABLE event_settings ADD CONSTRAINT event_settings_domain_check
  CHECK (domain IN (
    -- F001-F004 domains
    'payments',
    'transfers',
    'communication',
    'governance',
    'legal',
    'basic_info',
    'content_communication',
    'branding',
    'waitlist',
    'interest_list',
    'ticket_pdf',
    'ticket_privacy',
    -- F005+ domains
    'general',
    'registration',
    'checkout',
    'privacy',
    'observability',
    'participants',
    'tickets',
    -- NEW: F007 Scanning domain
    'scanning'
  ));

-- ===========================================================================
-- 2. UPDATE get_default_settings FUNCTION
-- ===========================================================================

CREATE OR REPLACE FUNCTION get_default_settings()
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN jsonb_build_object(
    'general', jsonb_build_object(
      'currency', 'EUR',
      'timezone', 'Europe/Amsterdam',
      'locale', 'nl'
    ),
    'registration', jsonb_build_object(
      'requires_login', false,
      'allow_waitlist', true,
      'confirmation_email', true
    ),
    'communication', jsonb_build_object(
      'reply_to_email', null,
      'default_locale', 'nl',
      'sender', jsonb_build_object(
        'default_from_name', null,
        'default_from_email', null,
        'default_reply_to', null
      ),
      'bulk', jsonb_build_object(
        'batch_size', 100,
        'delay_between_batches_ms', 1000,
        'max_recipients_per_campaign', 10000
      ),
      'compliance', jsonb_build_object(
        'unsubscribe_enabled', true,
        'bounce_threshold', 3,
        'complaint_threshold', 1
      ),
      'rate_limits', jsonb_build_object(
        'emails_per_minute', 100,
        'emails_per_hour', 5000
      ),
      'retry', jsonb_build_object(
        'max_attempts', 3,
        'initial_delay_ms', 60000,
        'backoff_multiplier', 2
      )
    ),
    'branding', jsonb_build_object(
      'primary_color', '#4F46E5',
      'logo_url', null
    ),
    'checkout', jsonb_build_object(
      'terms_url', null,
      'privacy_url', null
    ),
    'privacy', jsonb_build_object(
      'data_retention_days', 365
    ),
    'observability', jsonb_build_object(
      'enable_analytics', true
    ),
    'participants', jsonb_build_object(
      'list', jsonb_build_object(
        'default_sort', 'created_at_desc',
        'page_size_default', 50
      ),
      'export', jsonb_build_object(
        'max_rows', 10000
      ),
      'privacy', jsonb_build_object(
        'mask_email_for_support', true
      ),
      'filters', jsonb_build_object(
        'enable_age_gender', false,
        'enable_invitation_code', false,
        'enable_team', false
      )
    ),
    'tickets', jsonb_build_object(
      'defaults', jsonb_build_object(
        'currency', 'EUR',
        'vat_percentage', 21.00,
        'visibility', 'visible'
      ),
      'checkout', jsonb_build_object(
        'show_remaining_capacity', true,
        'low_stock_threshold', 10,
        'max_per_order', 10
      ),
      'time_slots', jsonb_build_object(
        'enabled', false,
        'required', false,
        'show_capacity', false
      ),
      'teams', jsonb_build_object(
        'enabled', false
      ),
      'i18n', jsonb_build_object(
        'enabled', false,
        'default_locale', 'nl',
        'available_locales', '["nl", "en"]'::jsonb
      )
    ),
    -- NEW: Scanning domain (F007)
    'scanning', jsonb_build_object(
      'enabled', true,
      'rate_limit', jsonb_build_object(
        'per_minute', 60,
        'per_device_per_minute', 30
      ),
      'require_device_id', false,
      'allow_undo_checkin', false,
      'response', jsonb_build_object(
        'pii_level', 'masked'  -- none | masked | full-for-admin
      )
    )
  );
END;
$$;

COMMENT ON FUNCTION get_default_settings() IS
  'Returns default settings for all domains including scanning.';

-- ===========================================================================
-- 3. VALIDATION FUNCTION FOR SCANNING SETTINGS
-- ===========================================================================

CREATE OR REPLACE FUNCTION validate_scanning_settings(_settings JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_per_minute INTEGER;
  v_per_device INTEGER;
  v_pii_level TEXT;
BEGIN
  -- Validate rate_limit
  IF _settings ? 'rate_limit' THEN
    v_per_minute := (_settings->'rate_limit'->>'per_minute')::integer;
    v_per_device := (_settings->'rate_limit'->>'per_device_per_minute')::integer;

    IF v_per_minute IS NOT NULL AND (v_per_minute < 1 OR v_per_minute > 1000) THEN
      RAISE EXCEPTION 'scanning.rate_limit.per_minute must be between 1 and 1000';
    END IF;

    IF v_per_device IS NOT NULL AND (v_per_device < 1 OR v_per_device > 1000) THEN
      RAISE EXCEPTION 'scanning.rate_limit.per_device_per_minute must be between 1 and 1000';
    END IF;
  END IF;

  -- Validate pii_level
  IF _settings ? 'response' THEN
    v_pii_level := _settings->'response'->>'pii_level';

    IF v_pii_level IS NOT NULL AND v_pii_level NOT IN ('none', 'masked', 'full-for-admin') THEN
      RAISE EXCEPTION 'scanning.response.pii_level must be one of: none, masked, full-for-admin';
    END IF;
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION validate_scanning_settings IS
  'Validates scanning domain settings structure and values.';

-- ===========================================================================
-- 4. UPDATE MAIN VALIDATION TRIGGER
-- ===========================================================================

CREATE OR REPLACE FUNCTION validate_event_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Domain-specific validation
  CASE NEW.domain
    WHEN 'participants' THEN
      PERFORM validate_participants_settings(NEW.settings);
    WHEN 'tickets' THEN
      PERFORM validate_tickets_settings(NEW.settings);
    WHEN 'scanning' THEN
      PERFORM validate_scanning_settings(NEW.settings);
    WHEN 'communication' THEN
      -- Communication validation (existing)
      NULL;
    ELSE
      -- No specific validation for other domains
      NULL;
  END CASE;

  RETURN NEW;
END;
$$;

-- Recreate trigger
DROP TRIGGER IF EXISTS validate_event_settings_trigger ON event_settings;
CREATE TRIGGER validate_event_settings_trigger
  BEFORE INSERT OR UPDATE ON event_settings
  FOR EACH ROW
  EXECUTE FUNCTION validate_event_settings();

-- ===========================================================================
-- END MIGRATION
-- ===========================================================================
