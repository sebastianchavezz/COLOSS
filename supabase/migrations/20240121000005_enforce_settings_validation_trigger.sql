-- Migration: 20240121000005_enforce_settings_validation_trigger.sql
-- Description: Defense-in-depth - enforce validation at DB level via trigger
-- Fixes: Direct INSERT/UPDATE to event_settings/org_settings bypassing RPC validation

-- ========================================================
-- 1. Trigger Function (shared by both tables)
-- ========================================================

CREATE OR REPLACE FUNCTION public.trigger_validate_setting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- Call existing validation function
    -- It will RAISE EXCEPTION if invalid, aborting the INSERT/UPDATE
    PERFORM public.validate_setting_domain(NEW.domain, NEW.setting_value);
    
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trigger_validate_setting IS 'Trigger function to enforce setting validation on INSERT/UPDATE';

-- ========================================================
-- 2. Trigger on event_settings
-- ========================================================

DROP TRIGGER IF EXISTS enforce_event_settings_validation ON public.event_settings;

CREATE TRIGGER enforce_event_settings_validation
    BEFORE INSERT OR UPDATE ON public.event_settings
    FOR EACH ROW
    EXECUTE FUNCTION public.trigger_validate_setting();

COMMENT ON TRIGGER enforce_event_settings_validation ON public.event_settings IS 
    'Enforces domain-specific validation on all event settings writes';

-- ========================================================
-- 3. Trigger on org_settings
-- ========================================================

DROP TRIGGER IF EXISTS enforce_org_settings_validation ON public.org_settings;

CREATE TRIGGER enforce_org_settings_validation
    BEFORE INSERT OR UPDATE ON public.org_settings
    FOR EACH ROW
    EXECUTE FUNCTION public.trigger_validate_setting();

COMMENT ON TRIGGER enforce_org_settings_validation ON public.org_settings IS 
    'Enforces domain-specific validation on all org settings writes';

-- ========================================================
-- 4. Clean up any existing invalid data (optional)
-- ========================================================

-- First, let's see if there's any invalid data
DO $$
DECLARE
    _invalid_count integer;
BEGIN
    -- Count invalid legal modes in event_settings
    SELECT COUNT(*) INTO _invalid_count
    FROM public.event_settings
    WHERE domain = 'legal'
      AND setting_value->>'mode' IS NOT NULL
      AND setting_value->>'mode' NOT IN ('none', 'pdf', 'url', 'inline_text');
    
    IF _invalid_count > 0 THEN
        -- Reset invalid rows to default mode
        UPDATE public.event_settings
        SET setting_value = jsonb_set(setting_value, '{mode}', '"none"'::jsonb)
        WHERE domain = 'legal'
          AND setting_value->>'mode' IS NOT NULL
          AND setting_value->>'mode' NOT IN ('none', 'pdf', 'url', 'inline_text');
        
        RAISE NOTICE 'Fixed % invalid legal settings rows', _invalid_count;
    END IF;
    
    -- Same for org_settings
    SELECT COUNT(*) INTO _invalid_count
    FROM public.org_settings
    WHERE domain = 'legal'
      AND setting_value->>'mode' IS NOT NULL
      AND setting_value->>'mode' NOT IN ('none', 'pdf', 'url', 'inline_text');
    
    IF _invalid_count > 0 THEN
        UPDATE public.org_settings
        SET setting_value = jsonb_set(setting_value, '{mode}', '"none"'::jsonb)
        WHERE domain = 'legal'
          AND setting_value->>'mode' IS NOT NULL
          AND setting_value->>'mode' NOT IN ('none', 'pdf', 'url', 'inline_text');
        
        RAISE NOTICE 'Fixed % invalid org legal settings rows', _invalid_count;
    END IF;
END $$;
