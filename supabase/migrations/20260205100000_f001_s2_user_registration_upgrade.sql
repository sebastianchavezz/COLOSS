-- ============================================================================
-- Migration: F001 S2 - User Registration Upgrade
-- ============================================================================
-- Purpose: Enhance participant profile management
--
-- Changes:
-- 1. Upgrade get_my_participant_profile() to include all profile fields
--    (phone, birth_date, gender, address, city, country)
-- 2. Add update_my_participant_profile() RPC for profile updates
--    - Partial update pattern (only updates non-NULL parameters)
--    - Input validation (first_name, gender)
--    - Audit logging
--    - Returns updated profile
--
-- Security:
-- - SECURITY DEFINER with explicit search_path
-- - Only authenticated users can access
-- - Users can only update their own profile
-- - All changes are audit logged
--
-- Notes:
-- - gender_type enum values: 'M', 'F', 'X', 'O'
-- - Partial updates allow frontend to send only changed fields
-- ============================================================================

-- ============================================================================
-- UPGRADE: get_my_participant_profile
-- ============================================================================
-- Extends existing function to return all participant profile fields.

CREATE OR REPLACE FUNCTION public.get_my_participant_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_participant record;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT
    p.id,
    p.email,
    p.first_name,
    p.last_name,
    p.phone,
    p.birth_date,
    p.gender::text,
    p.address,
    p.city,
    p.country,
    p.created_at,
    p.updated_at
  INTO v_participant
  FROM public.participants p
  WHERE p.user_id = v_user_id
    AND p.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'NO_PARTICIPANT',
      'message', 'No participant profile linked to this user'
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'OK',
    'participant', jsonb_build_object(
      'id', v_participant.id,
      'email', v_participant.email,
      'first_name', v_participant.first_name,
      'last_name', v_participant.last_name,
      'phone', v_participant.phone,
      'birth_date', v_participant.birth_date,
      'gender', v_participant.gender,
      'address', v_participant.address,
      'city', v_participant.city,
      'country', v_participant.country,
      'created_at', v_participant.created_at,
      'updated_at', v_participant.updated_at
    )
  );
END;
$$;

COMMENT ON FUNCTION public.get_my_participant_profile() IS
  'Returns the current users complete participant profile, if linked. Includes all fields: contact info, demographics, and address.';

-- ============================================================================
-- NEW: update_my_participant_profile
-- ============================================================================
-- Allows authenticated users to update their own participant profile.
--
-- Parameters (all optional - partial update pattern):
--   p_first_name: First name (validated: must not be empty if provided)
--   p_last_name: Last name
--   p_phone: Phone number
--   p_birth_date: Date of birth
--   p_gender: Gender code ('M', 'F', 'X', 'O', or NULL)
--   p_address: Street address
--   p_city: City name
--   p_country: Country code (ISO 3166-1 alpha-2)
--
-- Returns: Updated profile via get_my_participant_profile()
--
-- Validation:
-- - first_name must not be empty string if provided
-- - gender must be valid gender_type enum value if provided
--
-- Audit:
-- - Logs PARTICIPANT_PROFILE_UPDATED action with old and new values

CREATE OR REPLACE FUNCTION public.update_my_participant_profile(
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_birth_date date DEFAULT NULL,
  p_gender text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_country text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_participant_id uuid;
  v_old_data jsonb;
BEGIN
  -- Authenticate user
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHENTICATED');
  END IF;

  -- Get current participant
  SELECT id INTO v_participant_id
  FROM public.participants
  WHERE user_id = v_user_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_participant_id IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'NO_PARTICIPANT',
      'message', 'Create a profile first via create_or_link_participant()'
    );
  END IF;

  -- Validate first_name if provided
  IF p_first_name IS NOT NULL AND TRIM(p_first_name) = '' THEN
    RETURN jsonb_build_object(
      'error', 'VALIDATION_ERROR',
      'field', 'first_name',
      'message', 'Voornaam mag niet leeg zijn'
    );
  END IF;

  -- Validate gender if provided
  -- gender_type enum values: 'M', 'F', 'X', 'O'
  IF p_gender IS NOT NULL AND p_gender NOT IN ('M', 'F', 'X', 'O') THEN
    RETURN jsonb_build_object(
      'error', 'VALIDATION_ERROR',
      'field', 'gender',
      'message', 'Ongeldig geslacht. Gebruik: M, F, X, of O'
    );
  END IF;

  -- Store old data for audit log
  SELECT jsonb_build_object(
    'first_name', p2.first_name,
    'last_name', p2.last_name,
    'phone', p2.phone,
    'birth_date', p2.birth_date,
    'gender', p2.gender::text,
    'address', p2.address,
    'city', p2.city,
    'country', p2.country
  ) INTO v_old_data
  FROM public.participants p2
  WHERE p2.id = v_participant_id;

  -- Update only non-NULL fields (partial update pattern)
  UPDATE public.participants
  SET
    first_name = COALESCE(p_first_name, first_name),
    last_name = COALESCE(p_last_name, last_name),
    phone = COALESCE(p_phone, phone),
    birth_date = COALESCE(p_birth_date, birth_date),
    gender = CASE
      WHEN p_gender IS NOT NULL THEN p_gender::gender_type
      ELSE gender
    END,
    address = COALESCE(p_address, address),
    city = COALESCE(p_city, city),
    country = COALESCE(p_country, country),
    updated_at = now()
  WHERE id = v_participant_id;

  -- Audit log
  INSERT INTO public.audit_log (
    actor_user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    v_user_id,
    'PARTICIPANT_PROFILE_UPDATED',
    'participant',
    v_participant_id,
    jsonb_build_object(
      'old_data', v_old_data,
      'updated_fields', jsonb_strip_nulls(jsonb_build_object(
        'first_name', p_first_name,
        'last_name', p_last_name,
        'phone', p_phone,
        'birth_date', p_birth_date,
        'gender', p_gender,
        'address', p_address,
        'city', p_city,
        'country', p_country
      ))
    )
  );

  -- Return updated profile
  RETURN public.get_my_participant_profile();
END;
$$;

COMMENT ON FUNCTION public.update_my_participant_profile(text, text, text, date, text, text, text, text) IS
  'Updates the current users participant profile. Supports partial updates (only non-NULL parameters are updated). Validates input and logs changes.';

-- ============================================================================
-- GRANTS
-- ============================================================================

-- Both functions are available to authenticated users
GRANT EXECUTE ON FUNCTION public.get_my_participant_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_participant_profile(text, text, text, date, text, text, text, text) TO authenticated;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Run these to verify the migration:
--
-- 1. Check function exists and has correct parameters:
--    \df public.update_my_participant_profile
--
-- 2. Test as authenticated user:
--    SELECT public.update_my_participant_profile(
--      p_first_name := 'John',
--      p_last_name := 'Doe',
--      p_phone := '+31612345678',
--      p_gender := 'M'
--    );
--
-- 3. Verify audit log:
--    SELECT * FROM public.audit_log
--    WHERE action = 'PARTICIPANT_PROFILE_UPDATED'
--    ORDER BY created_at DESC
--    LIMIT 5;
-- ============================================================================
