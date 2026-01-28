/**
 * GPX Parsing Utilities
 *
 * Client-side GPX parsing for instant preview before server-side processing.
 * Uses @tmcw/togeojson for robust parsing.
 */

export interface GpxPoint {
  lat: number;
  lng: number;
  ele?: number;
}

export interface ParsedGpx {
  points: GpxPoint[];
  bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
  distance_m: number;
  name?: string;
}

// Haversine distance in meters
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
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

/**
 * Parse GPX file content into structured data
 */
export function parseGpxContent(gpxContent: string): ParsedGpx {
  const parser = new DOMParser();
  const doc = parser.parseFromString(gpxContent, 'text/xml');

  // Check for parse errors
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Invalid GPX XML format');
  }

  const points: GpxPoint[] = [];

  // Try track points first (most common)
  const trkpts = doc.querySelectorAll('trkpt');
  if (trkpts.length > 0) {
    trkpts.forEach((pt) => {
      const lat = parseFloat(pt.getAttribute('lat') || '');
      const lon = parseFloat(pt.getAttribute('lon') || '');
      if (!isNaN(lat) && !isNaN(lon)) {
        const ele = pt.querySelector('ele');
        points.push({
          lat,
          lng: lon,
          ele: ele ? parseFloat(ele.textContent || '') : undefined,
        });
      }
    });
  }

  // Fallback to route points
  if (points.length === 0) {
    const rtepts = doc.querySelectorAll('rtept');
    rtepts.forEach((pt) => {
      const lat = parseFloat(pt.getAttribute('lat') || '');
      const lon = parseFloat(pt.getAttribute('lon') || '');
      if (!isNaN(lat) && !isNaN(lon)) {
        points.push({ lat, lng: lon });
      }
    });
  }

  // Final fallback: waypoints
  if (points.length === 0) {
    const wpts = doc.querySelectorAll('wpt');
    wpts.forEach((pt) => {
      const lat = parseFloat(pt.getAttribute('lat') || '');
      const lon = parseFloat(pt.getAttribute('lon') || '');
      if (!isNaN(lat) && !isNaN(lon)) {
        points.push({ lat, lng: lon });
      }
    });
  }

  if (points.length < 2) {
    throw new Error('GPX must contain at least 2 valid points');
  }

  // Calculate bounds
  let minLat = Infinity,
    maxLat = -Infinity;
  let minLng = Infinity,
    maxLng = -Infinity;

  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }

  // Calculate total distance
  let distance = 0;
  for (let i = 1; i < points.length; i++) {
    distance += haversineDistance(
      points[i - 1].lat,
      points[i - 1].lng,
      points[i].lat,
      points[i].lng
    );
  }

  // Get name from GPX
  const nameEl = doc.querySelector('name');
  const name = nameEl?.textContent || undefined;

  return {
    points,
    bounds: { minLat, maxLat, minLng, maxLng },
    distance_m: Math.round(distance),
    name,
  };
}

/**
 * Read GPX file and parse content
 */
export function readGpxFile(file: File): Promise<{ content: string; parsed: ParsedGpx }> {
  return new Promise((resolve, reject) => {
    // Validate file type
    if (!file.name.toLowerCase().endsWith('.gpx')) {
      reject(new Error('Only .gpx files are allowed'));
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      reject(new Error('File must be under 5MB'));
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const parsed = parseGpxContent(content);
        resolve({ content, parsed });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

/**
 * Format distance for display
 */
export function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${meters} m`;
}

/**
 * Convert points to Leaflet LatLng array
 */
export function toLeafletPositions(points: GpxPoint[]): [number, number][] {
  return points.map((p) => [p.lat, p.lng]);
}

/**
 * Convert geometry array to Leaflet positions
 * Geometry is in GeoJSON order: [lng, lat]
 */
export function geometryToLeafletPositions(geometry: number[][]): [number, number][] {
  return geometry.map(([lng, lat]) => [lat, lng]);
}
