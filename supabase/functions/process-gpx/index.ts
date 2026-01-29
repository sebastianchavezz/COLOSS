/**
 * Process GPX Edge Function
 *
 * Handles GPX file upload, parsing, simplification, and storage for event routes.
 *
 * Features:
 * - Parse GPX XML (tracks and routes)
 * - Simplify path using Douglas-Peucker algorithm
 * - Calculate distance and bounds
 * - Store original GPX in storage bucket
 * - Save processed route to database
 *
 * @endpoint POST /functions/v1/process-gpx
 * @auth Required (org admin/owner)
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

interface GpxPoint {
  lat: number;
  lng: number;
  ele?: number;
}

interface ProcessedRoute {
  geometry: number[][]; // [lng, lat] pairs (GeoJSON order)
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  distance_m: number;
  point_count: number;
}

// Haversine distance in meters
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Perpendicular distance from point to line
function perpendicularDistance(
  point: GpxPoint,
  lineStart: GpxPoint,
  lineEnd: GpxPoint
): number {
  const dx = lineEnd.lng - lineStart.lng;
  const dy = lineEnd.lat - lineStart.lat;
  const norm = Math.sqrt(dx * dx + dy * dy);

  if (norm === 0) {
    return haversineDistance(point.lat, point.lng, lineStart.lat, lineStart.lng);
  }

  // Approximate perpendicular distance
  return (
    (Math.abs(
      (lineEnd.lat - lineStart.lat) * point.lng -
        (lineEnd.lng - lineStart.lng) * point.lat +
        lineEnd.lng * lineStart.lat -
        lineEnd.lat * lineStart.lng
    ) /
      norm) *
    111000
  ); // Rough conversion to meters
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

// Parse GPX XML content
function parseGpx(gpxContent: string): GpxPoint[] {
  const points: GpxPoint[] = [];

  // Simple XML parsing using regex (Deno doesn't have DOMParser in all contexts)
  // Extract track points
  const trkptRegex =
    /<trkpt[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*>[\s\S]*?<\/trkpt>/gi;
  const trkptRegex2 =
    /<trkpt[^>]*lon="([^"]+)"[^>]*lat="([^"]+)"[^>]*>[\s\S]*?<\/trkpt>/gi;

  let match;

  // Try lat first, then lon
  while ((match = trkptRegex.exec(gpxContent)) !== null) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    if (!isNaN(lat) && !isNaN(lon)) {
      points.push({ lat, lng: lon });
    }
  }

  // If no matches, try lon first
  if (points.length === 0) {
    while ((match = trkptRegex2.exec(gpxContent)) !== null) {
      const lon = parseFloat(match[1]);
      const lat = parseFloat(match[2]);
      if (!isNaN(lat) && !isNaN(lon)) {
        points.push({ lat, lng: lon });
      }
    }
  }

  // Fallback to route points if no track points
  if (points.length === 0) {
    const rteptRegex =
      /<rtept[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*>/gi;
    while ((match = rteptRegex.exec(gpxContent)) !== null) {
      const lat = parseFloat(match[1]);
      const lon = parseFloat(match[2]);
      if (!isNaN(lat) && !isNaN(lon)) {
        points.push({ lat, lng: lon });
      }
    }
  }

  // Final fallback: waypoints
  if (points.length === 0) {
    const wptRegex = /<wpt[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*>/gi;
    while ((match = wptRegex.exec(gpxContent)) !== null) {
      const lat = parseFloat(match[1]);
      const lon = parseFloat(match[2]);
      if (!isNaN(lat) && !isNaN(lon)) {
        points.push({ lat, lng: lon });
      }
    }
  }

  return points;
}

// Process route from points
function processRoute(points: GpxPoint[]): ProcessedRoute {
  // Simplify for performance (tolerance ~10m in coordinate space)
  const simplified =
    points.length > 500 ? simplifyPath(points, 0.0001) : points;

  // Calculate bounds
  let minLat = Infinity,
    maxLat = -Infinity;
  let minLng = Infinity,
    maxLng = -Infinity;

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
      simplified[i - 1].lat,
      simplified[i - 1].lng,
      simplified[i].lat,
      simplified[i].lng
    );
  }

  return {
    geometry: simplified.map((p) => [p.lng, p.lat]), // GeoJSON order [lng, lat]
    bounds: { minLat, maxLat, minLng, maxLng },
    distance_m: Math.round(distance),
    point_count: simplified.length,
  };
}

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // Only allow POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseServiceKey || !anonKey) {
      throw new Error("Missing environment variables");
    }

    // Service role client for DB operations (bypasses RLS)
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Verify auth - get token from header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.log("No Authorization header or invalid format");
      return new Response(JSON.stringify({ error: "UNAUTHORIZED", message: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Auth header received");

    // Create client with user's token to verify (same pattern as create-order-public)
    let user: { id: string } | null = null;
    try {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } }
      });
      const { data } = await userClient.auth.getUser();
      user = data.user;
    } catch (e) {
      console.error("Auth verification failed:", e);
    }

    if (!user) {
      console.error("No user found for token");
      return new Response(JSON.stringify({ error: "UNAUTHORIZED", message: "Invalid or expired token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("User verified:", user.id);

    // Parse request body
    const { event_id, gpx_content, name } = await req.json();

    if (!event_id || !gpx_content) {
      return new Response(
        JSON.stringify({ error: "MISSING_PARAMS", message: "event_id and gpx_content are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check file size (5MB limit)
    const gpxSize = new Blob([gpx_content]).size;
    if (gpxSize > 5 * 1024 * 1024) {
      return new Response(
        JSON.stringify({ error: "FILE_TOO_LARGE", message: "GPX file must be under 5MB" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get event and check permission
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id, org_id")
      .eq("id", event_id)
      .is("deleted_at", null)
      .single();

    if (eventError || !event) {
      return new Response(JSON.stringify({ error: "EVENT_NOT_FOUND" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check org membership
    const { data: membership, error: memberError } = await supabase
      .from("org_members")
      .select("role")
      .eq("org_id", event.org_id)
      .eq("user_id", user.id)
      .single();

    if (memberError || !membership || !["owner", "admin"].includes(membership.role)) {
      return new Response(
        JSON.stringify({ error: "UNAUTHORIZED", message: "Must be org admin or owner" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Parse and process GPX
    const points = parseGpx(gpx_content);

    if (points.length < 2) {
      return new Response(
        JSON.stringify({
          error: "INVALID_GPX",
          message: "GPX must contain at least 2 valid track points",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const originalPointCount = points.length;
    const processed = processRoute(points);

    // Store GPX file
    const filePath = `${event.org_id}/${event_id}/route.gpx`;
    const { error: uploadError } = await supabase.storage
      .from("gpx-routes")
      .upload(filePath, gpx_content, {
        contentType: "application/gpx+xml",
        upsert: true,
      });

    if (uploadError) {
      console.error("GPX upload error:", uploadError);
      // Continue without file storage - route data is stored in DB
    }

    // Soft delete existing route first
    await supabase
      .from("event_routes")
      .update({ deleted_at: new Date().toISOString() })
      .eq("event_id", event_id)
      .is("deleted_at", null);

    // Insert new route directly (service role bypasses RLS)
    const { data: savedRoute, error: saveError } = await supabase
      .from("event_routes")
      .insert({
        org_id: event.org_id,
        event_id: event_id,
        name: name || "Route",
        gpx_file_path: uploadError ? null : filePath,
        route_geometry: processed.geometry,
        bounds: processed.bounds,
        distance_m: processed.distance_m,
        point_count: processed.point_count,
        status: "draft",
        updated_by: user.id,
      })
      .select()
      .single();

    if (saveError) {
      console.error("Save route error:", saveError);
      return new Response(
        JSON.stringify({
          error: "SAVE_FAILED",
          details: saveError.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Audit log (non-blocking) - table has BOTH resource_type/resource_id AND entity_type as NOT NULL
    try {
      await supabase
        .from("audit_log")
        .insert({
          org_id: event.org_id,
          user_id: user.id,
          action: "route_created",
          resource_type: "event_route",
          resource_id: savedRoute.id,
          entity_type: "event_route",
          entity_id: savedRoute.id,
          details: {
            event_id: event_id,
            distance_m: processed.distance_m,
            point_count: processed.point_count,
          },
          metadata: {
            event_id: event_id,
            distance_m: processed.distance_m,
            point_count: processed.point_count,
          },
        });
    } catch (e) {
      console.error("Audit log error:", e);
    }

    return new Response(
      JSON.stringify({
        status: "OK",
        route: {
          id: savedRoute.id,
          event_id: savedRoute.event_id,
          name: savedRoute.name,
          status: savedRoute.status,
          route_geometry: savedRoute.route_geometry,
          bounds: savedRoute.bounds,
          distance_m: savedRoute.distance_m,
          point_count: savedRoute.point_count,
          gpx_file_path: savedRoute.gpx_file_path,
          created_at: savedRoute.created_at,
          updated_at: savedRoute.updated_at,
        },
        processing: {
          original_points: originalPointCount,
          simplified_points: processed.point_count,
          file_stored: !uploadError,
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Process GPX error:", err);
    return new Response(
      JSON.stringify({
        error: "INTERNAL_ERROR",
        message: err instanceof Error ? err.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
