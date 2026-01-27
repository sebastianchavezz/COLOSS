-- ===========================================================================
-- SPRINT F011: Participants Settings Domain Extension
-- Migration: 20250127100002_participants_settings_domain.sql
--
-- Purpose:
-- - Add 'participants' to valid settings domains
-- - Add default settings for participants domain
-- - Add validation for participants settings keys
-- ===========================================================================

-- ===========================================================================
-- 1. UPDATE DOMAIN CONSTRAINT
-- ===========================================================================

-- Drop existing domain constraint if it exists
DO $$
BEGIN
  ALTER TABLE event_settings DROP CONSTRAINT IF EXISTS event_settings_domain_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Add updated domain constraint with ALL existing domains + 'participants'
-- (preserving existing domains from earlier migrations)
ALTER TABLE event_settings ADD CONSTRAINT event_settings_domain_check
  CHECK (domain IN (
    -- Original domains
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
    -- Newer domains (may or may not exist)
    'general',
    'registration',
    'ticket',
    'checkout',
    'privacy',
    'observability',
    -- NEW: Participants domain
    'participants'
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
    'ticket', jsonb_build_object(
      'show_qr_code', true,
      'pdf_enabled', true
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
    -- NEW: Participants domain
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
    )
  );
END;
$$;

COMMENT ON FUNCTION get_default_settings() IS
  'Returns default settings for all domains including participants.';

-- ===========================================================================
-- 3. VALIDATION FUNCTION FOR PARTICIPANTS KEYS
-- ===========================================================================

CREATE OR REPLACE FUNCTION validate_participants_settings(_settings JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_list_sort TEXT;
  v_page_size INTEGER;
  v_max_rows INTEGER;
BEGIN
  -- Validate list settings
  IF _settings ? 'list' THEN
    v_list_sort := _settings->'list'->>'default_sort';
    IF v_list_sort IS NOT NULL AND v_list_sort NOT IN (
      'created_at_asc', 'created_at_desc',
      'email_asc', 'email_desc',
      'last_name_asc', 'last_name_desc'
    ) THEN
      RAISE EXCEPTION 'Invalid participants.list.default_sort value: %', v_list_sort;
    END IF;

    v_page_size := (_settings->'list'->>'page_size_default')::integer;
    IF v_page_size IS NOT NULL AND (v_page_size < 10 OR v_page_size > 200) THEN
      RAISE EXCEPTION 'participants.list.page_size_default must be between 10 and 200';
    END IF;
  END IF;

  -- Validate export settings
  IF _settings ? 'export' THEN
    v_max_rows := (_settings->'export'->>'max_rows')::integer;
    IF v_max_rows IS NOT NULL AND (v_max_rows < 100 OR v_max_rows > 100000) THEN
      RAISE EXCEPTION 'participants.export.max_rows must be between 100 and 100000';
    END IF;
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION validate_participants_settings IS
  'Validates participants domain settings structure and values.';

-- ===========================================================================
-- 4. UPDATE MAIN VALIDATION FUNCTION
-- ===========================================================================

-- Update or create the main settings validation trigger function
CREATE OR REPLACE FUNCTION validate_event_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Domain-specific validation
  CASE NEW.domain
    WHEN 'participants' THEN
      PERFORM validate_participants_settings(NEW.settings);
    WHEN 'communication' THEN
      -- Communication validation already exists
      NULL;
    ELSE
      -- No specific validation for other domains
      NULL;
  END CASE;

  RETURN NEW;
END;
$$;

-- Create trigger if not exists
DROP TRIGGER IF EXISTS validate_event_settings_trigger ON event_settings;
CREATE TRIGGER validate_event_settings_trigger
  BEFORE INSERT OR UPDATE ON event_settings
  FOR EACH ROW
  EXECUTE FUNCTION validate_event_settings();

-- ===========================================================================
-- END MIGRATION
-- ===========================================================================
