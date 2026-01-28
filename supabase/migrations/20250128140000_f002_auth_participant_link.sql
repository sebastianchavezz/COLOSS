-- F002: Auto-link participants to auth users on signup
--
-- When a new user signs up, automatically link their auth account
-- to any existing participant record with the same email.
-- This enables seamless access to past purchases/registrations.

-- ============================================================================
-- FUNCTION: link_participant_on_signup
-- ============================================================================
-- Links participant.user_id to auth.users.id when emails match.
-- Only updates participants where user_id IS NULL (not already linked).

CREATE OR REPLACE FUNCTION public.link_participant_on_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Update participant(s) where email matches and not yet linked
  UPDATE public.participants
  SET
    user_id = NEW.id,
    updated_at = now()
  WHERE LOWER(email) = LOWER(NEW.email)
    AND user_id IS NULL;

  -- Log the linking action if any rows were updated
  IF FOUND THEN
    INSERT INTO public.audit_log (
      actor_user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      NEW.id,
      'PARTICIPANT_LINKED_TO_USER',
      'participant',
      (SELECT id FROM public.participants WHERE user_id = NEW.id LIMIT 1),
      jsonb_build_object(
        'email', NEW.email,
        'linked_at', now()
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.link_participant_on_signup() IS
  'Auto-links participant records to new auth users by matching email address.';

-- ============================================================================
-- TRIGGER: on_auth_user_created
-- ============================================================================
-- Note: Triggers on auth.users require the trigger to be in the auth schema
-- or use Supabase's built-in auth hooks. We'll use an RPC approach instead.

-- Since we can't directly trigger on auth.users from public schema,
-- we create an RPC that can be called from auth hooks or the callback.

-- ============================================================================
-- RPC: link_current_user_to_participant
-- ============================================================================
-- Called after successful signup/login to link the current user to their participant.
-- Safe to call multiple times (idempotent).

CREATE OR REPLACE FUNCTION public.link_current_user_to_participant()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_user_email text;
  v_linked_count int := 0;
BEGIN
  -- Get current user
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHENTICATED');
  END IF;

  -- Get user email from JWT claims
  v_user_email := auth.jwt() ->> 'email';

  IF v_user_email IS NULL THEN
    RETURN jsonb_build_object('error', 'NO_EMAIL_IN_TOKEN');
  END IF;

  -- Link unlinked participants with matching email
  UPDATE public.participants
  SET
    user_id = v_user_id,
    updated_at = now()
  WHERE LOWER(email) = LOWER(v_user_email)
    AND user_id IS NULL;

  GET DIAGNOSTICS v_linked_count = ROW_COUNT;

  -- Log if any were linked
  IF v_linked_count > 0 THEN
    INSERT INTO public.audit_log (
      actor_user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      v_user_id,
      'PARTICIPANT_LINKED_TO_USER',
      'user',
      v_user_id,
      jsonb_build_object(
        'email', v_user_email,
        'participants_linked', v_linked_count,
        'linked_at', now()
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'OK',
    'linked_count', v_linked_count
  );
END;
$$;

COMMENT ON FUNCTION public.link_current_user_to_participant() IS
  'Links the current authenticated user to their participant records by email match. Call after signup/login.';

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.link_current_user_to_participant() TO authenticated;

-- ============================================================================
-- RPC: get_my_participant_profile
-- ============================================================================
-- Returns the participant profile for the current user, if any.

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
    p.created_at,
    p.updated_at
  INTO v_participant
  FROM public.participants p
  WHERE p.user_id = v_user_id
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
      'created_at', v_participant.created_at,
      'updated_at', v_participant.updated_at
    )
  );
END;
$$;

COMMENT ON FUNCTION public.get_my_participant_profile() IS
  'Returns the current users participant profile, if linked.';

GRANT EXECUTE ON FUNCTION public.get_my_participant_profile() TO authenticated;

-- ============================================================================
-- RPC: create_or_link_participant
-- ============================================================================
-- Creates a participant for the current user if none exists,
-- or links to existing one by email.

CREATE OR REPLACE FUNCTION public.create_or_link_participant(
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_user_email text;
  v_participant_id uuid;
  v_is_new boolean := false;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHENTICATED');
  END IF;

  v_user_email := auth.jwt() ->> 'email';

  IF v_user_email IS NULL THEN
    RETURN jsonb_build_object('error', 'NO_EMAIL_IN_TOKEN');
  END IF;

  -- Check if user already has a linked participant
  SELECT id INTO v_participant_id
  FROM public.participants
  WHERE user_id = v_user_id
  LIMIT 1;

  IF v_participant_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'ALREADY_LINKED',
      'participant_id', v_participant_id
    );
  END IF;

  -- Try to link existing participant by email
  UPDATE public.participants
  SET
    user_id = v_user_id,
    first_name = COALESCE(p_first_name, first_name),
    last_name = COALESCE(p_last_name, last_name),
    updated_at = now()
  WHERE LOWER(email) = LOWER(v_user_email)
    AND user_id IS NULL
  RETURNING id INTO v_participant_id;

  IF v_participant_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'LINKED_EXISTING',
      'participant_id', v_participant_id
    );
  END IF;

  -- Create new participant
  INSERT INTO public.participants (
    email,
    first_name,
    last_name,
    user_id
  ) VALUES (
    v_user_email,
    COALESCE(p_first_name, ''),
    COALESCE(p_last_name, ''),
    v_user_id
  )
  RETURNING id INTO v_participant_id;

  v_is_new := true;

  -- Log creation
  INSERT INTO public.audit_log (
    actor_user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    v_user_id,
    'PARTICIPANT_CREATED',
    'participant',
    v_participant_id,
    jsonb_build_object(
      'email', v_user_email,
      'created_at', now()
    )
  );

  RETURN jsonb_build_object(
    'status', 'CREATED_NEW',
    'participant_id', v_participant_id
  );
END;
$$;

COMMENT ON FUNCTION public.create_or_link_participant(text, text) IS
  'Creates a participant profile for the current user or links to existing one by email.';

GRANT EXECUTE ON FUNCTION public.create_or_link_participant(text, text) TO authenticated;
