/**
 * RouteMap Component
 *
 * Displays a GPX route on an interactive Mapbox GL map.
 * Used by both organizer (admin) and participant (public) views.
 * Supports 3D terrain, route draw animation, and multiple map styles.
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import MapGL, {
  Source,
  Layer,
  Marker,
  NavigationControl,
  type MapRef,
} from 'react-map-gl';
import type { LineLayerSpecification } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

const MAP_STYLES = {
  outdoors: 'mapbox://styles/mapbox/outdoors-v12',
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
  streets: 'mapbox://styles/mapbox/streets-v12',
} as const;

interface RouteMapProps {
  /** Route geometry in [[lng, lat], ...] format (GeoJSON) or [[lat, lng], ...] format */
  geometry?: number[][];
  /** Bounds for map fitting */
  bounds?: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
  /** Whether geometry is in GeoJSON order [lng, lat] (default: true) */
  isGeoJsonOrder?: boolean;
  /** Map height */
  height?: string;
  /** Show start/finish markers */
  showMarkers?: boolean;
  /** Line color */
  lineColor?: string;
  /** Line weight */
  lineWeight?: number;
  /** Additional CSS class */
  className?: string;
  /** Enable 3D terrain overlay */
  enable3DTerrain?: boolean;
  /** Animate route drawing on load */
  animateRoute?: boolean;
  /** Enable pan/zoom interaction (default: true) */
  interactive?: boolean;
  /** Map style */
  mapStyle?: 'outdoors' | 'satellite' | 'streets';
  /** Elevation data for profile (not used by map, passed through for context) */
  elevationData?: Array<{ distance: number; elevation: number }>;
}

// GeoJSON for the route line
function buildRouteGeoJSON(
  geometry: number[][],
  isGeoJsonOrder: boolean
): GeoJSON.Feature<GeoJSON.LineString> {
  const coordinates = isGeoJsonOrder
    ? geometry
    : geometry.map(([lat, lng]) => [lng, lat]);

  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates,
    },
  };
}

// Route line styling
const routeLineLayer: Omit<LineLayerSpecification, 'source'> = {
  id: 'route-line',
  type: 'line',
  layout: {
    'line-join': 'round',
    'line-cap': 'round',
  },
  paint: {
    'line-width': 4,
    'line-opacity': 0.85,
  },
};

// Route line border (for better visibility on terrain)
const routeLineBorderLayer: Omit<LineLayerSpecification, 'source'> = {
  id: 'route-line-border',
  type: 'line',
  layout: {
    'line-join': 'round',
    'line-cap': 'round',
  },
  paint: {
    'line-width': 7,
    'line-color': 'rgba(255, 255, 255, 0.5)',
  },
};

export function RouteMap({
  geometry,
  bounds,
  isGeoJsonOrder = true,
  height = '400px',
  showMarkers = true,
  lineColor = '#4f46e5',
  lineWeight = 4,
  className = '',
  enable3DTerrain = false,
  animateRoute = false,
  interactive = true,
  mapStyle = 'outdoors',
}: RouteMapProps) {
  const mapRef = useRef<MapRef>(null);
  const animationRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const [animationProgress, setAnimationProgress] = useState(animateRoute ? 0 : 1);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Track mounted state and suppress Mapbox GL raster-dem AbortError console spam.
  // Mapbox GL v3 has a known bug where cancelled DEM tile fetches during zoom/pan
  // throw unhandled AbortError rejections. This listener silences them.
  useEffect(() => {
    mountedRef.current = true;
    const suppressAbortError = (e: PromiseRejectionEvent) => {
      if (e.reason?.name === 'AbortError') {
        e.preventDefault();
      }
    };
    window.addEventListener('unhandledrejection', suppressAbortError);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('unhandledrejection', suppressAbortError);
      // Remove terrain before unmount to prevent AbortError on in-flight DEM tiles
      const map = mapRef.current?.getMap();
      if (map && map.getTerrain()) {
        map.setTerrain(null);
      }
    };
  }, []);

  // Token check
  if (!MAPBOX_TOKEN) {
    return (
      <div
        className={`rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center ${className}`}
        style={{ height, width: '100%' }}
      >
        <div className="text-center p-6">
          <div className="text-gray-400 text-4xl mb-3">&#x1F5FA;</div>
          <p className="text-sm text-gray-600 font-medium">Kaart niet beschikbaar</p>
          <p className="text-xs text-gray-400 mt-1">
            Mapbox access token ontbreekt (VITE_MAPBOX_ACCESS_TOKEN)
          </p>
        </div>
      </div>
    );
  }

  // Compute coordinates for markers
  const coordinates =
    geometry && geometry.length > 0
      ? isGeoJsonOrder
        ? geometry
        : geometry.map(([lat, lng]) => [lng, lat])
      : [];

  const startPoint = coordinates.length > 0 ? coordinates[0] : null;
  const endPoint =
    coordinates.length > 1 ? coordinates[coordinates.length - 1] : null;
  const showEndMarker =
    endPoint &&
    startPoint &&
    (endPoint[0] !== startPoint[0] || endPoint[1] !== startPoint[1]);

  // Build GeoJSON for animated or full route
  const routeGeoJSON =
    geometry && geometry.length > 0
      ? animateRoute && animationProgress < 1
        ? buildRouteGeoJSON(
            geometry.slice(
              0,
              Math.max(2, Math.floor(geometry.length * animationProgress))
            ),
            isGeoJsonOrder
          )
        : buildRouteGeoJSON(geometry, isGeoJsonOrder)
      : null;

  // Fit bounds when geometry or bounds change
  const fitMapBounds = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    if (bounds) {
      map.fitBounds(
        [
          [bounds.minLng, bounds.minLat],
          [bounds.maxLng, bounds.maxLat],
        ],
        { padding: 40, duration: 1000 }
      );
    } else if (coordinates.length > 0) {
      // Calculate bounds from coordinates
      let minLng = Infinity,
        maxLng = -Infinity,
        minLat = Infinity,
        maxLat = -Infinity;
      for (const [lng, lat] of coordinates) {
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        { padding: 40, duration: 1000 }
      );
    }
  }, [bounds, coordinates]);

  // Enable 3D terrain after map is idle to avoid AbortError on DEM tile fetches
  const enableTerrain = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || !enable3DTerrain || !mountedRef.current) return;

    function addTerrain() {
      if (!mountedRef.current) return;
      const m = mapRef.current?.getMap();
      if (!m) return;
      if (!m.getSource('mapbox-dem')) {
        m.addSource('mapbox-dem', {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512,
          maxzoom: 14,
        });
      }
      if (!m.getTerrain()) {
        m.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
      }
    }

    // Wait for idle so base tiles are loaded before adding DEM source
    if (map.isStyleLoaded() && map.loaded()) {
      addTerrain();
    } else {
      map.once('idle', addTerrain);
    }
  }, [enable3DTerrain]);

  // Fit bounds after map loads, then enable terrain
  useEffect(() => {
    if (mapLoaded && (geometry?.length || bounds)) {
      fitMapBounds();
      if (enable3DTerrain) {
        enableTerrain();
      }
    }
  }, [mapLoaded, geometry, bounds, fitMapBounds, enable3DTerrain, enableTerrain]);

  // Route draw animation
  useEffect(() => {
    if (!animateRoute || !mapLoaded || !geometry?.length) return;

    setAnimationProgress(0);
    const startTime = performance.now();
    const duration = 1500; // 1.5s animation

    function animate(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimationProgress(eased);
      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      }
    }

    // Small delay so the map fits bounds first
    const timeout = setTimeout(() => {
      animationRef.current = requestAnimationFrame(animate);
    }, 1200);

    return () => {
      clearTimeout(timeout);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [animateRoute, mapLoaded, geometry]);

  // Dynamic line paint (color + weight)
  const linePaint = {
    ...routeLineLayer.paint,
    'line-color': lineColor,
    'line-width': lineWeight,
  };

  return (
    <div
      className={`rounded-lg overflow-hidden ${className}`}
      style={{ height, width: '100%' }}
    >
      <MapGL
        ref={mapRef}
        initialViewState={{
          longitude: 5.1214,
          latitude: 52.0907,
          zoom: 7,
        }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={MAP_STYLES[mapStyle]}
        mapboxAccessToken={MAPBOX_TOKEN}
        interactive={interactive}
        scrollZoom={interactive}
        dragPan={interactive}
        dragRotate={interactive && enable3DTerrain}
        touchZoomRotate={interactive}
        onLoad={() => setMapLoaded(true)}
        attributionControl={true}
        pitch={enable3DTerrain ? 45 : 0}
      >
        {interactive && <NavigationControl position="top-right" />}

        {/* Route line (border for contrast) */}
        {routeGeoJSON && (
          <Source id="route-border" type="geojson" data={routeGeoJSON}>
            <Layer {...routeLineBorderLayer} />
          </Source>
        )}

        {/* Route line (main) */}
        {routeGeoJSON && (
          <Source id="route" type="geojson" data={routeGeoJSON}>
            <Layer
              {...routeLineLayer}
              paint={linePaint as LineLayerSpecification['paint']}
            />
          </Source>
        )}

        {/* Start marker */}
        {showMarkers && startPoint && (
          <Marker longitude={startPoint[0]} latitude={startPoint[1]} anchor="center">
            <div className="w-7 h-7 rounded-full bg-green-500 border-[3px] border-white shadow-lg flex items-center justify-center text-white text-xs font-bold">
              S
            </div>
          </Marker>
        )}

        {/* Finish marker */}
        {showMarkers && showEndMarker && endPoint && (
          <Marker longitude={endPoint[0]} latitude={endPoint[1]} anchor="center">
            <div className="w-7 h-7 rounded-full bg-red-500 border-[3px] border-white shadow-lg flex items-center justify-center text-white text-xs font-bold">
              F
            </div>
          </Marker>
        )}
      </MapGL>
    </div>
  );
}
