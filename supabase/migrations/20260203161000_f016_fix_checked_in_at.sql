-- ============================================================================
-- F016: Fix checked_in_at column reference
-- ============================================================================
-- The checked_in_at column is on ticket_instances, not registrations
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
                        'ticket_type_name', tt2.name,
                        'product_name', pr.name,
                        'quantity', oi.quantity,
                        'unit_price', oi.unit_price,
                        'total_price', oi.total_price
                    ))
                    FROM order_items oi
                    LEFT JOIN ticket_types tt2 ON tt2.id = oi.ticket_type_id
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
                'ticket_type_name', tt3.name
            ))
            FROM ticket_instances ti
            JOIN ticket_types tt3 ON tt3.id = ti.ticket_type_id
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
                SELECT r2.id::text FROM registrations r2 WHERE r2.participant_id = p.id AND r2.event_id = _event_id
            ) OR al.resource_id IN (
                SELECT o2.id::text FROM orders o2 WHERE o2.participant_id = p.id AND o2.event_id = _event_id
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

-- Verification
DO $$
BEGIN
    RAISE NOTICE 'F016 fix applied: removed checked_in_at from registrations query';
END $$;
