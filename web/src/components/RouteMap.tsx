/**
 * RouteMap Component
 *
 * Displays a GPX route on an interactive Leaflet map.
 * Used by both organizer (admin) and participant (public) views.
 */

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icons in Leaflet with Vite bundler
// Use CDN URLs to avoid Vite import issues
const iconUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png';
const iconRetinaUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png';
const shadowUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
  iconUrl,
  iconRetinaUrl,
  shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

// Custom icons for start/finish
const startIcon = L.divIcon({
  html: `<div style="background: #22c55e; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 12px;">S</div>`,
  className: 'custom-div-icon',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

const finishIcon = L.divIcon({
  html: `<div style="background: #ef4444; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 12px;">F</div>`,
  className: 'custom-div-icon',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

interface RouteMapProps {
  /** Route geometry in [[lng, lat], ...] format (GeoJSON) or [[lat, lng], ...] format (Leaflet) */
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
}

export function RouteMap({
  geometry,
  bounds,
  isGeoJsonOrder = true,
  height = '400px',
  showMarkers = true,
  lineColor = '#4f46e5',
  lineWeight = 4,
  className = '',
}: RouteMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);
  const markersRef = useRef<L.Marker[]>([]);

  useEffect(() => {
    if (!mapRef.current) return;

    // Initialize map if not already
    if (!mapInstanceRef.current) {
      mapInstanceRef.current = L.map(mapRef.current, {
        zoomControl: true,
        scrollWheelZoom: true,
      }).setView([52.0907, 5.1214], 8); // Default: Netherlands center

      // Add tile layer (OpenStreetMap)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(mapInstanceRef.current);
    }

    const map = mapInstanceRef.current;

    // Clear existing polyline and markers
    if (polylineRef.current) {
      polylineRef.current.remove();
      polylineRef.current = null;
    }
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // Add new polyline if geometry exists
    if (geometry && geometry.length > 0) {
      // Convert to Leaflet [lat, lng] format
      const positions: [number, number][] = isGeoJsonOrder
        ? geometry.map(([lng, lat]) => [lat, lng])
        : (geometry as [number, number][]);

      // Draw polyline
      polylineRef.current = L.polyline(positions, {
        color: lineColor,
        weight: lineWeight,
        opacity: 0.8,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);

      // Add start marker
      if (showMarkers && positions.length > 0) {
        const startMarker = L.marker(positions[0], { icon: startIcon })
          .bindPopup('Start')
          .addTo(map);
        markersRef.current.push(startMarker);

        // Add finish marker (if different from start)
        const lastPos = positions[positions.length - 1];
        if (lastPos[0] !== positions[0][0] || lastPos[1] !== positions[0][1]) {
          const finishMarker = L.marker(lastPos, { icon: finishIcon })
            .bindPopup('Finish')
            .addTo(map);
          markersRef.current.push(finishMarker);
        }
      }

      // Fit bounds
      if (bounds) {
        map.fitBounds([
          [bounds.minLat, bounds.minLng],
          [bounds.maxLat, bounds.maxLng],
        ], { padding: [20, 20] });
      } else {
        map.fitBounds(polylineRef.current.getBounds(), { padding: [20, 20] });
      }
    }

    return () => {
      // Cleanup markers on unmount
      markersRef.current.forEach((m) => m.remove());
    };
  }, [geometry, bounds, isGeoJsonOrder, showMarkers, lineColor, lineWeight]);

  // Cleanup map on unmount
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={mapRef}
      className={`rounded-lg overflow-hidden ${className}`}
      style={{ height, width: '100%' }}
    />
  );
}
