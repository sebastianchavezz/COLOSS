-- ============================================================================
-- F016: Fix ALL column references
-- ============================================================================
-- ticket_instances: qr_code (not token), owner_user_id (not participant_id)
-- ============================================================================

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
    _user_id uuid;
    _email text;
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

    -- Get participant's user_id and email for lookups
    SELECT user_id, email INTO _user_id, _email
    FROM participants
    WHERE id = _participant_id;

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
                'ticket_type', CASE WHEN tt.id IS NOT NULL THEN json_build_object(
                    'id', tt.id,
                    'name', tt.name,
                    'price', tt.price
                ) ELSE NULL END
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
                'status', o.status,
                'total_amount', o.total_amount,
                'created_at', o.created_at
            )
            FROM orders o
            WHERE o.event_id = _event_id
            AND ((_user_id IS NOT NULL AND o.user_id = _user_id) OR o.email = _email)
            AND o.status = 'paid'
            ORDER BY o.created_at DESC
            LIMIT 1
        ),
        'tickets', (
            SELECT json_agg(json_build_object(
                'id', ti.id,
                'qr_code', ti.qr_code,
                'status', ti.status,
                'checked_in_at', ti.checked_in_at,
                'ticket_type_name', tt3.name
            ))
            FROM ticket_instances ti
            JOIN ticket_types tt3 ON tt3.id = ti.ticket_type_id
            WHERE ti.event_id = _event_id
            AND ((_user_id IS NOT NULL AND ti.owner_user_id = _user_id) OR ti.id IN (
                SELECT oi.id FROM order_items oi
                JOIN orders o2 ON o2.id = oi.order_id
                WHERE o2.email = _email AND o2.event_id = _event_id
            ))
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

-- Verification
DO $$
BEGIN
    RAISE NOTICE 'F016 fix applied: using correct column names (qr_code, owner_user_id)';
END $$;
