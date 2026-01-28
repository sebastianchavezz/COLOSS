# Sprint S1: Architecture - GPX Route Import

**Flow**: F003 Event Creation
**Sprint**: S1
**Date**: 2026-01-28

---

## Overview

This sprint implements GPX route management for events:
1. Database table for routes with geometry storage
2. RPC functions for CRUD operations
3. Storage bucket for original GPX files
4. Frontend components for upload/preview

---

## Database Design

### Table: event_routes

```sql
CREATE TYPE route_status AS ENUM ('draft', 'published');

CREATE TABLE public.event_routes (
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
    deleted_at timestamptz,

    -- Constraints
    CONSTRAINT unique_event_route UNIQUE (event_id) WHERE deleted_at IS NULL
);

-- Indexes
CREATE INDEX idx_event_routes_event_id ON event_routes(event_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_event_routes_org_id ON event_routes(org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_event_routes_status ON event_routes(status) WHERE deleted_at IS NULL;
```

### RLS Policies

```sql
ALTER TABLE event_routes ENABLE ROW LEVEL SECURITY;

-- Org members can view all routes for their org
CREATE POLICY "Org members can view routes"
ON event_routes FOR SELECT
TO authenticated
USING (
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
            JOIN events e ON ti.event_id = e.id
            WHERE e.id = event_routes.event_id
            AND ti.owner_user_id = auth.uid()
            AND ti.status != 'void'
        )
    )
);

-- Public can view published routes for published events
CREATE POLICY "Public can view published routes"
ON event_routes FOR SELECT
TO anon
USING (
    status = 'published'
    AND EXISTS (
        SELECT 1 FROM events e
        WHERE e.id = event_routes.event_id
        AND e.status = 'published'
        AND e.deleted_at IS NULL
    )
    AND deleted_at IS NULL
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
```

---

## Storage Design

### Bucket: gpx-routes

```sql
-- Create storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'gpx-routes',
    'gpx-routes',
    false,  -- Private bucket
    5242880,  -- 5MB limit
    ARRAY['application/gpx+xml', 'text/xml', 'application/xml']
);

-- Storage policies
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
```

---

## RPC Functions

### upload_event_route

```sql
CREATE OR REPLACE FUNCTION public.upload_event_route(
    _event_id uuid,
    _gpx_content text,
    _name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event record;
    v_user_id uuid := auth.uid();
    v_org_id uuid;
    v_route_id uuid;
    v_geometry jsonb;
    v_bounds jsonb;
    v_distance int;
    v_point_count int;
    v_file_path text;
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

    v_org_id := v_event.org_id;

    -- Parse GPX and extract geometry (simplified version - real parsing in Edge Function)
    -- For now, we expect pre-parsed geometry from client
    -- Full GPX parsing happens in Edge Function for server-side validation

    -- Delete existing route for this event (replace behavior)
    UPDATE event_routes
    SET deleted_at = now()
    WHERE event_id = _event_id
    AND deleted_at IS NULL;

    -- Create new route
    INSERT INTO event_routes (
        org_id,
        event_id,
        name,
        status,
        created_at,
        updated_at,
        updated_by
    )
    VALUES (
        v_org_id,
        _event_id,
        COALESCE(_name, 'Route'),
        'draft',
        now(),
        now(),
        v_user_id
    )
    RETURNING id INTO v_route_id;

    -- Audit log
    INSERT INTO audit_log (org_id, entity_type, entity_id, action, actor_id, metadata)
    VALUES (
        v_org_id,
        'event_route',
        v_route_id,
        'route_created',
        v_user_id,
        jsonb_build_object('event_id', _event_id)
    );

    RETURN jsonb_build_object(
        'status', 'OK',
        'route_id', v_route_id,
        'message', 'Route created - upload GPX via Edge Function'
    );
END;
$$;
```

### get_event_route

```sql
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
    SELECT EXISTS (
        SELECT 1 FROM events e
        JOIN org_members om ON e.org_id = om.org_id
        WHERE e.id = _event_id
        AND om.user_id = v_user_id
    ) INTO v_is_org_member;

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

    -- Check access
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
```

### set_event_route_status

```sql
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
```

### delete_event_route

```sql
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
```

---

## Edge Function: process-gpx

```typescript
// supabase/functions/process-gpx/index.ts

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GpxPoint {
  lat: number;
  lng: number;
  ele?: number;
}

interface ProcessedRoute {
  geometry: number[][]; // [lng, lat] pairs
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  distance_m: number;
  point_count: number;
}

// Haversine distance in meters
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Douglas-Peucker simplification
function simplifyPath(points: GpxPoint[], tolerance: number): GpxPoint[] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let maxIndex = 0;
  const end = points.length - 1;

  for (let i = 1; i < end; i++) {
    const dist = perpendicularDistance(points[i], points[0], points[end]);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  if (maxDist > tolerance) {
    const left = simplifyPath(points.slice(0, maxIndex + 1), tolerance);
    const right = simplifyPath(points.slice(maxIndex), tolerance);
    return [...left.slice(0, -1), ...right];
  }

  return [points[0], points[end]];
}

function perpendicularDistance(point: GpxPoint, lineStart: GpxPoint, lineEnd: GpxPoint): number {
  const dx = lineEnd.lng - lineStart.lng;
  const dy = lineEnd.lat - lineStart.lat;
  const norm = Math.sqrt(dx * dx + dy * dy);
  if (norm === 0) return haversineDistance(point.lat, point.lng, lineStart.lat, lineStart.lng);

  return Math.abs(
    (lineEnd.lat - lineStart.lat) * point.lng -
    (lineEnd.lng - lineStart.lng) * point.lat +
    lineEnd.lng * lineStart.lat -
    lineEnd.lat * lineStart.lng
  ) / norm * 111000; // Rough conversion to meters
}

function parseGpx(gpxContent: string): GpxPoint[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(gpxContent, "text/xml");
  if (!doc) throw new Error("Invalid GPX XML");

  const points: GpxPoint[] = [];

  // Try track points first
  const trkpts = doc.querySelectorAll("trkpt");
  if (trkpts.length > 0) {
    for (const pt of trkpts) {
      const lat = parseFloat(pt.getAttribute("lat") || "");
      const lon = parseFloat(pt.getAttribute("lon") || "");
      if (!isNaN(lat) && !isNaN(lon)) {
        const ele = pt.querySelector("ele");
        points.push({
          lat,
          lng: lon,
          ele: ele ? parseFloat(ele.textContent || "") : undefined
        });
      }
    }
  }

  // Fallback to route points
  if (points.length === 0) {
    const rtepts = doc.querySelectorAll("rtept");
    for (const pt of rtepts) {
      const lat = parseFloat(pt.getAttribute("lat") || "");
      const lon = parseFloat(pt.getAttribute("lon") || "");
      if (!isNaN(lat) && !isNaN(lon)) {
        points.push({ lat, lng: lon });
      }
    }
  }

  return points;
}

function processRoute(points: GpxPoint[]): ProcessedRoute {
  // Simplify for performance (tolerance ~10m)
  const simplified = points.length > 1000
    ? simplifyPath(points, 0.0001)
    : points;

  // Calculate bounds
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;

  for (const p of simplified) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }

  // Calculate total distance
  let distance = 0;
  for (let i = 1; i < simplified.length; i++) {
    distance += haversineDistance(
      simplified[i-1].lat, simplified[i-1].lng,
      simplified[i].lat, simplified[i].lng
    );
  }

  return {
    geometry: simplified.map(p => [p.lng, p.lat]), // GeoJSON order
    bounds: { minLat, maxLat, minLng, maxLng },
    distance_m: Math.round(distance),
    point_count: simplified.length
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Verify user
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { event_id, gpx_content, name } = await req.json();

    if (!event_id || !gpx_content) {
      return new Response(JSON.stringify({ error: "MISSING_PARAMS" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Check permission
    const { data: event } = await supabase
      .from("events")
      .select("id, org_id")
      .eq("id", event_id)
      .single();

    if (!event) {
      return new Response(JSON.stringify({ error: "EVENT_NOT_FOUND" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: membership } = await supabase
      .from("org_members")
      .select("role")
      .eq("org_id", event.org_id)
      .eq("user_id", user.id)
      .single();

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Parse and process GPX
    const points = parseGpx(gpx_content);
    if (points.length < 2) {
      return new Response(JSON.stringify({ error: "INVALID_GPX", message: "GPX must contain at least 2 points" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const processed = processRoute(points);

    // Store GPX file
    const filePath = `${event.org_id}/${event_id}/route.gpx`;
    const { error: uploadError } = await supabase.storage
      .from("gpx-routes")
      .upload(filePath, gpx_content, {
        contentType: "application/gpx+xml",
        upsert: true
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      // Continue without file storage
    }

    // Soft delete existing route
    await supabase
      .from("event_routes")
      .update({ deleted_at: new Date().toISOString() })
      .eq("event_id", event_id)
      .is("deleted_at", null);

    // Create new route
    const { data: route, error: insertError } = await supabase
      .from("event_routes")
      .insert({
        org_id: event.org_id,
        event_id,
        name: name || "Route",
        gpx_file_path: filePath,
        route_geometry: processed.geometry,
        bounds: processed.bounds,
        distance_m: processed.distance_m,
        point_count: processed.point_count,
        status: "draft",
        updated_by: user.id
      })
      .select()
      .single();

    if (insertError) {
      return new Response(JSON.stringify({ error: "INSERT_FAILED", details: insertError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Audit log
    await supabase.from("audit_log").insert({
      org_id: event.org_id,
      entity_type: "event_route",
      entity_id: route.id,
      action: "route_created",
      actor_id: user.id,
      metadata: {
        event_id,
        distance_m: processed.distance_m,
        point_count: processed.point_count,
        original_point_count: points.length
      }
    });

    return new Response(JSON.stringify({
      status: "OK",
      route: {
        id: route.id,
        event_id: route.event_id,
        name: route.name,
        status: route.status,
        route_geometry: route.route_geometry,
        bounds: route.bounds,
        distance_m: route.distance_m,
        point_count: route.point_count
      }
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: "INTERNAL_ERROR", message: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
```

---

## Frontend Components

### File Structure

```
web/src/
├── pages/
│   ├── events/
│   │   └── EventRouteAdmin.tsx    # Organizer: upload + manage
│   └── public/
│       └── EventRoute.tsx         # Participant: view route
├── components/
│   └── RouteMap.tsx               # Shared map component
└── lib/
    └── gpx.ts                     # GPX parsing utilities
```

### Dependencies to Install

```bash
cd web && npm install leaflet react-leaflet @types/leaflet @tmcw/togeojson
```

---

## Grants

```sql
GRANT EXECUTE ON FUNCTION public.upload_event_route(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_route(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_event_route_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_event_route(uuid) TO authenticated;
```

---

*Architecture - F003 S1 - 2026-01-28*
