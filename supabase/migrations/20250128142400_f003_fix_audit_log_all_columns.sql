-- Fix audit_log: fill ALL required columns
-- The table has both resource_type/resource_id AND entity_type as NOT NULL
-- We must provide values for ALL of them

-- ============================================================================
-- RPC: set_event_route_status
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_event_route_status(
    _event_id uuid,
    _status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_route record;
    v_old_status text;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('error', 'UNAUTHORIZED');
    END IF;

    IF _status NOT IN ('draft', 'published') THEN
        RETURN jsonb_build_object('error', 'INVALID_STATUS');
    END IF;

    SELECT er.*, e.org_id INTO v_route
    FROM event_routes er
    JOIN events e ON er.event_id = e.id
    JOIN org_members om ON e.org_id = om.org_id
    WHERE er.event_id = _event_id
    AND er.deleted_at IS NULL
    AND om.user_id = v_user_id
    AND om.role IN ('owner', 'admin');

    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'ROUTE_NOT_FOUND_OR_UNAUTHORIZED');
    END IF;

    v_old_status := v_route.status;

    UPDATE event_routes
    SET status = _status::route_status, updated_at = now(), updated_by = v_user_id
    WHERE id = v_route.id;

    -- Audit log with ALL required columns
    INSERT INTO audit_log (
        org_id, user_id, action,
        resource_type, resource_id,
        entity_type, entity_id,
        details, metadata
    ) VALUES (
        v_route.org_id,
        v_user_id,
        CASE WHEN _status = 'published' THEN 'route_published' ELSE 'route_unpublished' END,
        'event_route', v_route.id,
        'event_route', v_route.id,
        jsonb_build_object('event_id', _event_id, 'old_status', v_old_status, 'new_status', _status),
        jsonb_build_object('event_id', _event_id, 'old_status', v_old_status, 'new_status', _status)
    );

    RETURN jsonb_build_object('status', 'OK', 'route_status', _status);
END;
$$;

-- ============================================================================
-- RPC: delete_event_route
-- ============================================================================
CREATE OR REPLACE FUNCTION public.delete_event_route(_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_route record;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('error', 'UNAUTHORIZED');
    END IF;

    SELECT er.*, e.org_id INTO v_route
    FROM event_routes er
    JOIN events e ON er.event_id = e.id
    JOIN org_members om ON e.org_id = om.org_id
    WHERE er.event_id = _event_id
    AND er.deleted_at IS NULL
    AND om.user_id = v_user_id
    AND om.role IN ('owner', 'admin');

    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'ROUTE_NOT_FOUND_OR_UNAUTHORIZED');
    END IF;

    UPDATE event_routes
    SET deleted_at = now(), updated_at = now(), updated_by = v_user_id
    WHERE id = v_route.id;

    INSERT INTO audit_log (
        org_id, user_id, action,
        resource_type, resource_id,
        entity_type, entity_id,
        details, metadata
    ) VALUES (
        v_route.org_id, v_user_id, 'route_deleted',
        'event_route', v_route.id,
        'event_route', v_route.id,
        jsonb_build_object('event_id', _event_id),
        jsonb_build_object('event_id', _event_id)
    );

    RETURN jsonb_build_object('status', 'OK');
END;
$$;

-- ============================================================================
-- RPC: save_event_route
-- ============================================================================
CREATE OR REPLACE FUNCTION public.save_event_route(
    _event_id uuid,
    _name text,
    _route_geometry jsonb,
    _bounds jsonb,
    _distance_m integer,
    _point_count integer,
    _gpx_file_path text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_event record;
    v_route_id uuid;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('error', 'UNAUTHORIZED');
    END IF;

    SELECT e.*, om.role INTO v_event
    FROM events e
    JOIN org_members om ON e.org_id = om.org_id
    WHERE e.id = _event_id
    AND om.user_id = v_user_id
    AND om.role IN ('owner', 'admin')
    AND e.deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'EVENT_NOT_FOUND_OR_UNAUTHORIZED');
    END IF;

    UPDATE event_routes SET deleted_at = now()
    WHERE event_id = _event_id AND deleted_at IS NULL;

    INSERT INTO event_routes (
        org_id, event_id, name, gpx_file_path,
        route_geometry, bounds, distance_m, point_count, status, updated_by
    ) VALUES (
        v_event.org_id, _event_id, COALESCE(_name, 'Route'), _gpx_file_path,
        _route_geometry, _bounds, _distance_m, _point_count, 'draft', v_user_id
    ) RETURNING id INTO v_route_id;

    INSERT INTO audit_log (
        org_id, user_id, action,
        resource_type, resource_id,
        entity_type, entity_id,
        details, metadata
    ) VALUES (
        v_event.org_id, v_user_id, 'route_created',
        'event_route', v_route_id,
        'event_route', v_route_id,
        jsonb_build_object('event_id', _event_id, 'distance_m', _distance_m, 'point_count', _point_count),
        jsonb_build_object('event_id', _event_id, 'distance_m', _distance_m, 'point_count', _point_count)
    );

    RETURN jsonb_build_object('status', 'OK', 'route_id', v_route_id);
END;
$$;
