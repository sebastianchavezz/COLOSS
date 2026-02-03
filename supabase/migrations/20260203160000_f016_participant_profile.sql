-- ============================================================================
-- F016: Participant Profile
-- ============================================================================
-- Provides detailed participant profile data for organizers
-- Includes: contact info, registration, order, products, history
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. GET PARTICIPANT PROFILE RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_participant_profile(
    _participant_id uuid,
    _event_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _result json;
    _org_id uuid;
    _registration_id uuid;
BEGIN
    -- Get event's org_id
    SELECT org_id INTO _org_id
    FROM events
    WHERE id = _event_id;

    IF _org_id IS NULL THEN
        RAISE EXCEPTION 'Event not found';
    END IF;

    -- Verify caller is org member
    IF NOT public.is_org_member(_org_id) THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    -- Build profile JSON
    SELECT json_build_object(
        'participant', json_build_object(
            'id', p.id,
            'first_name', p.first_name,
            'last_name', p.last_name,
            'email', p.email,
            'phone', p.phone,
            'user_id', p.user_id,
            'created_at', p.created_at
        ),
        'registration', (
            SELECT json_build_object(
                'id', r.id,
                'status', r.status,
                'created_at', r.created_at,
                'updated_at', r.updated_at,
                'checked_in_at', r.checked_in_at,
                'ticket_type', json_build_object(
                    'id', tt.id,
                    'name', tt.name,
                    'price', tt.price
                )
            )
            FROM registrations r
            LEFT JOIN ticket_types tt ON tt.id = r.ticket_type_id
            WHERE r.participant_id = p.id
            AND r.event_id = _event_id
            LIMIT 1
        ),
        'order', (
            SELECT json_build_object(
                'id', o.id,
                'reference', o.reference,
                'status', o.status,
                'total_amount', o.total_amount,
                'paid_at', o.paid_at,
                'created_at', o.created_at,
                'items', (
                    SELECT json_agg(json_build_object(
                        'id', oi.id,
                        'ticket_type_name', tt.name,
                        'product_name', pr.name,
                        'quantity', oi.quantity,
                        'unit_price', oi.unit_price,
                        'total_price', oi.total_price
                    ))
                    FROM order_items oi
                    LEFT JOIN ticket_types tt ON tt.id = oi.ticket_type_id
                    LEFT JOIN products pr ON pr.id = oi.product_id
                    WHERE oi.order_id = o.id
                )
            )
            FROM orders o
            WHERE o.participant_id = p.id
            AND o.event_id = _event_id
            AND o.status = 'paid'
            ORDER BY o.created_at DESC
            LIMIT 1
        ),
        'tickets', (
            SELECT json_agg(json_build_object(
                'id', ti.id,
                'token', ti.token,
                'status', ti.status,
                'checked_in_at', ti.checked_in_at,
                'ticket_type_name', tt.name
            ))
            FROM ticket_instances ti
            JOIN ticket_types tt ON tt.id = ti.ticket_type_id
            WHERE ti.participant_id = p.id
            AND ti.event_id = _event_id
        ),
        'chat_thread', (
            SELECT json_build_object(
                'id', ct.id,
                'status', ct.status,
                'last_message_at', ct.last_message_at,
                'message_count', (
                    SELECT COUNT(*) FROM chat_messages cm WHERE cm.thread_id = ct.id
                )
            )
            FROM chat_threads ct
            WHERE ct.participant_id = p.id
            AND ct.event_id = _event_id
            LIMIT 1
        ),
        'history', (
            SELECT json_agg(json_build_object(
                'action', al.action,
                'resource_type', al.resource_type,
                'created_at', al.created_at,
                'details', al.details
            ) ORDER BY al.created_at DESC)
            FROM audit_log al
            WHERE (al.resource_id = p.id::text OR al.resource_id IN (
                SELECT id::text FROM registrations WHERE participant_id = p.id AND event_id = _event_id
            ) OR al.resource_id IN (
                SELECT id::text FROM orders WHERE participant_id = p.id AND event_id = _event_id
            ))
            LIMIT 20
        )
    ) INTO _result
    FROM participants p
    WHERE p.id = _participant_id;

    IF _result IS NULL THEN
        RAISE EXCEPTION 'Participant not found';
    END IF;

    RETURN _result;
END;
$$;

COMMENT ON FUNCTION public.get_participant_profile IS
'F016: Returns complete participant profile for organizer view';

-- ----------------------------------------------------------------------------
-- 2. UPDATE PARTICIPANT PROFILE RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_participant_profile(
    _participant_id uuid,
    _event_id uuid,
    _first_name text DEFAULT NULL,
    _last_name text DEFAULT NULL,
    _email text DEFAULT NULL,
    _phone text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _org_id uuid;
    _result json;
BEGIN
    -- Get event's org_id
    SELECT org_id INTO _org_id
    FROM events
    WHERE id = _event_id;

    IF _org_id IS NULL THEN
        RAISE EXCEPTION 'Event not found';
    END IF;

    -- Verify caller is org member with edit rights
    IF NOT EXISTS (
        SELECT 1 FROM org_members
        WHERE org_id = _org_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'admin', 'support')
    ) THEN
        RAISE EXCEPTION 'Not authorized to edit participants';
    END IF;

    -- Update participant
    UPDATE participants
    SET
        first_name = COALESCE(_first_name, first_name),
        last_name = COALESCE(_last_name, last_name),
        email = COALESCE(_email, email),
        phone = COALESCE(_phone, phone),
        updated_at = now()
    WHERE id = _participant_id;

    -- Log the update
    INSERT INTO audit_log (org_id, actor_user_id, action, resource_type, resource_id, details)
    VALUES (
        _org_id,
        auth.uid(),
        'update',
        'participant',
        _participant_id::text,
        jsonb_build_object(
            'first_name', _first_name,
            'last_name', _last_name,
            'email', _email,
            'phone', _phone
        )
    );

    -- Return updated participant
    SELECT json_build_object(
        'id', p.id,
        'first_name', p.first_name,
        'last_name', p.last_name,
        'email', p.email,
        'phone', p.phone
    ) INTO _result
    FROM participants p
    WHERE p.id = _participant_id;

    RETURN _result;
END;
$$;

COMMENT ON FUNCTION public.update_participant_profile IS
'F016: Updates participant profile fields (org members only)';

-- ----------------------------------------------------------------------------
-- 3. VERIFICATION
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    ASSERT (
        SELECT 1 FROM pg_proc WHERE proname = 'get_participant_profile'
    ), 'get_participant_profile function missing';

    ASSERT (
        SELECT 1 FROM pg_proc WHERE proname = 'update_participant_profile'
    ), 'update_participant_profile function missing';

    RAISE NOTICE 'F016 migration complete';
END $$;
