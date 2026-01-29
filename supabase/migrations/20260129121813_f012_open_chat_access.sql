-- =============================================================================
-- F012 S3: Open Chat Access
--
-- Removes ticket/registration requirement for chat. Any logged-in user can chat.
-- Adds participant_has_access column for organizer context (badge display).
-- =============================================================================

-- Add column to track if participant has event access (for organizer UI badge)
ALTER TABLE public.chat_threads
ADD COLUMN IF NOT EXISTS participant_has_access boolean DEFAULT false;

-- Backfill existing threads: set participant_has_access = true if they have access
UPDATE public.chat_threads ct
SET participant_has_access = true
WHERE EXISTS (
    SELECT 1 FROM public.registrations r
    WHERE r.event_id = ct.event_id
    AND r.participant_id = ct.participant_id
    AND r.status IN ('pending', 'confirmed')
)
OR EXISTS (
    SELECT 1 FROM public.ticket_instances ti
    JOIN public.participants p ON p.user_id = ti.owner_user_id
    WHERE ti.event_id = ct.event_id
    AND p.id = ct.participant_id
    AND ti.status IN ('issued', 'checked_in')
);

-- Add comment
COMMENT ON COLUMN public.chat_threads.participant_has_access IS
    'Whether participant has valid registration/ticket. For organizer UI badge.';

-- Create helper function to get or create participant from auth user
CREATE OR REPLACE FUNCTION public.get_or_create_participant_for_user(
    _user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _participant_id uuid;
    _user_email text;
    _user_name text;
BEGIN
    -- Check if participant exists
    SELECT id INTO _participant_id
    FROM public.participants
    WHERE user_id = _user_id;

    IF _participant_id IS NOT NULL THEN
        RETURN _participant_id;
    END IF;

    -- Get user info from auth.users
    SELECT email, raw_user_meta_data->>'full_name'
    INTO _user_email, _user_name
    FROM auth.users
    WHERE id = _user_id;

    IF _user_email IS NULL THEN
        RAISE EXCEPTION 'User not found: %', _user_id;
    END IF;

    -- Create participant
    INSERT INTO public.participants (user_id, email, first_name, last_name)
    VALUES (
        _user_id,
        _user_email,
        COALESCE(split_part(_user_name, ' ', 1), 'User'),
        COALESCE(NULLIF(split_part(_user_name, ' ', 2), ''), '')
    )
    RETURNING id INTO _participant_id;

    RETURN _participant_id;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_or_create_participant_for_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_participant_for_user(uuid) TO service_role;
