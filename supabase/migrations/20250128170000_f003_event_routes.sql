-- F003 S1: Event Routes - GPX Import & Map Display
--
-- This migration creates the event_routes table and supporting infrastructure
-- for storing and managing GPX routes for events.

-- ============================================================================
-- ENUM: route_status
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'route_status') THEN
        CREATE TYPE route_status AS ENUM ('draft', 'published');
    END IF;
END$$;

-- ============================================================================
-- TABLE: event_routes
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.event_routes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,

    -- File reference
    gpx_file_path text,

    -- Status
    status route_status NOT NULL DEFAULT 'draft',

    -- Processed geometry (GeoJSON LineString coordinates)
    route_geometry jsonb,  -- [[lng, lat], [lng, lat], ...]

    -- Bounds for map fitting
    bounds jsonb,  -- {minLat, maxLat, minLng, maxLng}

    -- Computed metrics
    distance_m integer,  -- Total distance in meters
    point_count integer, -- Number of points (for simplification tracking)

    -- Metadata
    name text,
    description text,

    -- Timestamps
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid REFERENCES auth.users(id),
    deleted_at timestamptz
);

-- Unique constraint: one active route per event
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_routes_unique_event
ON event_routes(event_id)
WHERE deleted_at IS NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_event_routes_event_id ON event_routes(event_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_event_routes_org_id ON event_routes(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_event_routes_status ON event_routes(status) WHERE deleted_at IS NULL;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION set_event_routes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS event_routes_updated_at ON event_routes;
CREATE TRIGGER event_routes_updated_at
BEFORE UPDATE ON event_routes
FOR EACH ROW EXECUTE FUNCTION set_event_routes_updated_at();

COMMENT ON TABLE event_routes IS 'Stores GPX route data for events with geometry and metadata';

-- ============================================================================
-- RLS POLICIES
-- ============================================================================
ALTER TABLE event_routes ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Org members can view routes" ON event_routes;
DROP POLICY IF EXISTS "Public can view published routes" ON event_routes;
DROP POLICY IF EXISTS "Org admins can create routes" ON event_routes;
DROP POLICY IF EXISTS "Org admins can update routes" ON event_routes;
DROP POLICY IF EXISTS "Org admins can delete routes" ON event_routes;

-- Org members can view all routes for their org
CREATE POLICY "Org members can view routes"
ON event_routes FOR SELECT
TO authenticated
USING (
    deleted_at IS NULL
    AND (
        -- Org member can view all
        EXISTS (
            SELECT 1 FROM org_members om
            WHERE om.org_id = event_routes.org_id
            AND om.user_id = auth.uid()
        )
        OR (
            -- Participants can view published routes for events they have tickets
            status = 'published'
            AND EXISTS (
                SELECT 1 FROM ticket_instances ti
                WHERE ti.event_id = event_routes.event_id
                AND ti.owner_user_id = auth.uid()
                AND ti.status != 'void'
            )
        )
    )
);

-- Public can view published routes for published events
CREATE POLICY "Public can view published routes"
ON event_routes FOR SELECT
TO anon
USING (
    status = 'published'
    AND deleted_at IS NULL
    AND EXISTS (
        SELECT 1 FROM events e
        WHERE e.id = event_routes.event_id
        AND e.status = 'published'
        AND e.deleted_at IS NULL
    )
);

-- Org admins can insert
CREATE POLICY "Org admins can create routes"
ON event_routes FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM org_members om
        WHERE om.org_id = event_routes.org_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
);

-- Org admins can update
CREATE POLICY "Org admins can update routes"
ON event_routes FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM org_members om
        WHERE om.org_id = event_routes.org_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
);

-- Org admins can delete
CREATE POLICY "Org admins can delete routes"
ON event_routes FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM org_members om
        WHERE om.org_id = event_routes.org_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
);

-- ============================================================================
-- STORAGE BUCKET: gpx-routes
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'gpx-routes',
    'gpx-routes',
    false,
    5242880,  -- 5MB
    ARRAY['application/gpx+xml', 'text/xml', 'application/xml']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
DROP POLICY IF EXISTS "Org members can upload GPX" ON storage.objects;
DROP POLICY IF EXISTS "Org members can read GPX" ON storage.objects;
DROP POLICY IF EXISTS "Org admins can delete GPX" ON storage.objects;

CREATE POLICY "Org members can upload GPX"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'gpx-routes'
    AND (storage.foldername(name))[1] IN (
        SELECT om.org_id::text FROM org_members om
        WHERE om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
);

CREATE POLICY "Org members can read GPX"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'gpx-routes'
    AND (storage.foldername(name))[1] IN (
        SELECT om.org_id::text FROM org_members om
        WHERE om.user_id = auth.uid()
    )
);

CREATE POLICY "Org admins can delete GPX"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'gpx-routes'
    AND (storage.foldername(name))[1] IN (
        SELECT om.org_id::text FROM org_members om
        WHERE om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
);

-- ============================================================================
-- RPC: get_event_route
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_event_route(_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_route record;
    v_is_org_member boolean := false;
    v_is_participant boolean := false;
BEGIN
    -- Check if user is org member
    IF v_user_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM events e
            JOIN org_members om ON e.org_id = om.org_id
            WHERE e.id = _event_id
            AND om.user_id = v_user_id
        ) INTO v_is_org_member;
    END IF;

    -- Check if user is participant (has ticket)
    IF NOT v_is_org_member AND v_user_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM ticket_instances ti
            WHERE ti.event_id = _event_id
            AND ti.owner_user_id = v_user_id
            AND ti.status != 'void'
        ) INTO v_is_participant;
    END IF;

    -- Get route
    SELECT * INTO v_route
    FROM event_routes
    WHERE event_id = _event_id
    AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'ROUTE_NOT_FOUND');
    END IF;

    -- Check access for non-org-members
    IF NOT v_is_org_member THEN
        -- Check if route is published and event is published
        IF v_route.status != 'published' THEN
            RETURN jsonb_build_object('error', 'ROUTE_NOT_PUBLISHED');
        END IF;

        -- Allow public access to published routes of published events
        IF NOT EXISTS (
            SELECT 1 FROM events e
            WHERE e.id = _event_id
            AND e.status = 'published'
            AND e.deleted_at IS NULL
        ) THEN
            RETURN jsonb_build_object('error', 'EVENT_NOT_PUBLISHED');
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'status', 'OK',
        'route', jsonb_build_object(
            'id', v_route.id,
            'event_id', v_route.event_id,
            'name', v_route.name,
            'description', v_route.description,
            'status', v_route.status,
            'route_geometry', v_route.route_geometry,
            'bounds', v_route.bounds,
            'distance_m', v_route.distance_m,
            'point_count', v_route.point_count,
            'gpx_file_path', CASE WHEN v_is_org_member THEN v_route.gpx_file_path ELSE NULL END,
            'created_at', v_route.created_at,
            'updated_at', v_route.updated_at
        ),
        'is_org_member', v_is_org_member
    );
END;
$$;

COMMENT ON FUNCTION public.get_event_route(uuid) IS 'Get route for event with auth-based access control';

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
    -- Check auth
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('error', 'UNAUTHORIZED');
    END IF;

    -- Validate status
    IF _status NOT IN ('draft', 'published') THEN
        RETURN jsonb_build_object('error', 'INVALID_STATUS');
    END IF;

    -- Get route and check permission
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

    -- Update status
    UPDATE event_routes
    SET
        status = _status::route_status,
        updated_at = now(),
        updated_by = v_user_id
    WHERE id = v_route.id;

    -- Audit log
    INSERT INTO audit_log (org_id, entity_type, entity_id, action, actor_id, metadata)
    VALUES (
        v_route.org_id,
        'event_route',
        v_route.id,
        CASE
            WHEN _status = 'published' THEN 'route_published'
            ELSE 'route_unpublished'
        END,
        v_user_id,
        jsonb_build_object(
            'event_id', _event_id,
            'old_status', v_old_status,
            'new_status', _status
        )
    );

    RETURN jsonb_build_object(
        'status', 'OK',
        'route_status', _status
    );
END;
$$;

COMMENT ON FUNCTION public.set_event_route_status(uuid, text) IS 'Toggle route status (draft/published)';

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
    -- Check auth
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('error', 'UNAUTHORIZED');
    END IF;

    -- Get route and check permission
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

    -- Soft delete
    UPDATE event_routes
    SET
        deleted_at = now(),
        updated_at = now(),
        updated_by = v_user_id
    WHERE id = v_route.id;

    -- Audit log
    INSERT INTO audit_log (org_id, entity_type, entity_id, action, actor_id, metadata)
    VALUES (
        v_route.org_id,
        'event_route',
        v_route.id,
        'route_deleted',
        v_user_id,
        jsonb_build_object('event_id', _event_id)
    );

    RETURN jsonb_build_object('status', 'OK');
END;
$$;

COMMENT ON FUNCTION public.delete_event_route(uuid) IS 'Soft delete event route';

-- ============================================================================
-- RPC: save_event_route (used by Edge Function and direct calls)
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
    -- Check auth
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('error', 'UNAUTHORIZED');
    END IF;

    -- Get event and check org membership
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

    -- Soft delete existing route
    UPDATE event_routes
    SET deleted_at = now()
    WHERE event_id = _event_id
    AND deleted_at IS NULL;

    -- Create new route
    INSERT INTO event_routes (
        org_id,
        event_id,
        name,
        gpx_file_path,
        route_geometry,
        bounds,
        distance_m,
        point_count,
        status,
        updated_by
    )
    VALUES (
        v_event.org_id,
        _event_id,
        COALESCE(_name, 'Route'),
        _gpx_file_path,
        _route_geometry,
        _bounds,
        _distance_m,
        _point_count,
        'draft',
        v_user_id
    )
    RETURNING id INTO v_route_id;

    -- Audit log
    INSERT INTO audit_log (org_id, entity_type, entity_id, action, actor_id, metadata)
    VALUES (
        v_event.org_id,
        'event_route',
        v_route_id,
        'route_created',
        v_user_id,
        jsonb_build_object(
            'event_id', _event_id,
            'distance_m', _distance_m,
            'point_count', _point_count
        )
    );

    RETURN jsonb_build_object(
        'status', 'OK',
        'route_id', v_route_id
    );
END;
$$;

COMMENT ON FUNCTION public.save_event_route(uuid, text, jsonb, jsonb, integer, integer, text) IS 'Save processed route data for event';

-- ============================================================================
-- GRANTS
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.get_event_route(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_event_route_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_event_route(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_event_route(uuid, text, jsonb, jsonb, integer, integer, text) TO authenticated;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
    -- Verify table exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'event_routes') THEN
        RAISE EXCEPTION 'event_routes table not created';
    END IF;

    -- Verify RLS is enabled
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'event_routes' AND rowsecurity = true) THEN
        RAISE EXCEPTION 'RLS not enabled on event_routes';
    END IF;

    -- Verify bucket exists
    IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'gpx-routes') THEN
        RAISE EXCEPTION 'gpx-routes bucket not created';
    END IF;

    RAISE NOTICE 'F003 S1: Event routes migration complete';
    RAISE NOTICE '  - event_routes table created with RLS';
    RAISE NOTICE '  - gpx-routes storage bucket created';
    RAISE NOTICE '  - RPCs: get_event_route, set_event_route_status, delete_event_route, save_event_route';
END$$;
