/**
 * EventRouteAdmin
 *
 * Organizer page for managing event routes.
 * Features: GPX upload (drag & drop), preview, publish/unpublish, delete.
 *
 * Route: /events/:eventId/route
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Upload,
  Map,
  Check,
  X,
  Trash2,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  ArrowLeft,
  FileText,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { RouteMap } from '../../components/RouteMap';
import { readGpxFile, formatDistance, ParsedGpx } from '../../lib/gpx';

interface EventRoute {
  id: string;
  event_id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'published';
  route_geometry: number[][];
  bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
  distance_m: number;
  point_count: number;
  gpx_file_path: string | null;
  created_at: string;
  updated_at: string;
}

export function EventRouteAdmin() {
  const { eventId } = useParams<{ eventId: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<any>(null);
  const [route, setRoute] = useState<EventRoute | null>(null);

  // Upload state
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ParsedGpx | null>(null);
  const [gpxContent, setGpxContent] = useState<string | null>(null);

  // Action state
  const [actionLoading, setActionLoading] = useState(false);

  // Fetch event and route
  useEffect(() => {
    async function fetchData() {
      if (!eventId) return;

      setLoading(true);
      setError(null);

      try {
        // Get event
        const { data: eventData, error: eventError } = await supabase
          .from('events')
          .select('id, name, slug, org_id, status')
          .eq('id', eventId)
          .single();

        if (eventError) throw eventError;
        setEvent(eventData);

        // Get route
        const { data: routeData } = await supabase.rpc('get_event_route', {
          _event_id: eventId,
        });

        if (routeData?.route) {
          setRoute(routeData.route);
        }
      } catch (err: any) {
        console.error('Error fetching data:', err);
        setError(err.message || 'Kon gegevens niet ophalen');
      }

      setLoading(false);
    }

    fetchData();
  }, [eventId]);

  // Handle file drop
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    setUploadError(null);

    const file = e.dataTransfer.files[0];
    if (!file) return;

    try {
      const { content, parsed } = await readGpxFile(file);
      setGpxContent(content);
      setPreview(parsed);
    } catch (err: any) {
      setUploadError(err.message || 'Kon GPX niet lezen');
    }
  }, []);

  // Handle file select
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const { content, parsed } = await readGpxFile(file);
      setGpxContent(content);
      setPreview(parsed);
    } catch (err: any) {
      setUploadError(err.message || 'Kon GPX niet lezen');
    }
  }, []);

  // Save route to server
  const handleSave = async () => {
    if (!gpxContent || !eventId) return;

    setUploading(true);
    setUploadError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('process-gpx', {
        body: {
          event_id: eventId,
          gpx_content: gpxContent,
          name: preview?.name || 'Route',
        },
      });

      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);

      // Refresh route data
      const { data: routeData } = await supabase.rpc('get_event_route', {
        _event_id: eventId,
      });

      if (routeData?.route) {
        setRoute(routeData.route);
      }

      // Clear preview
      setPreview(null);
      setGpxContent(null);
    } catch (err: any) {
      console.error('Upload error:', err);
      setUploadError(err.message || 'Kon route niet opslaan');
    }

    setUploading(false);
  };

  // Cancel preview
  const handleCancelPreview = () => {
    setPreview(null);
    setGpxContent(null);
    setUploadError(null);
  };

  // Toggle publish status
  const handleToggleStatus = async () => {
    if (!route || !eventId) return;

    setActionLoading(true);

    try {
      const newStatus = route.status === 'published' ? 'draft' : 'published';
      const { data, error: rpcError } = await supabase.rpc('set_event_route_status', {
        _event_id: eventId,
        _status: newStatus,
      });

      if (rpcError) throw rpcError;
      if (data?.error) throw new Error(data.error);

      setRoute({ ...route, status: newStatus });
    } catch (err: any) {
      console.error('Status error:', err);
      setError(err.message || 'Kon status niet wijzigen');
    }

    setActionLoading(false);
  };

  // Delete route
  const handleDelete = async () => {
    if (!route || !eventId) return;
    if (!confirm('Weet je zeker dat je deze route wilt verwijderen?')) return;

    setActionLoading(true);

    try {
      const { data, error: rpcError } = await supabase.rpc('delete_event_route', {
        _event_id: eventId,
      });

      if (rpcError) throw rpcError;
      if (data?.error) throw new Error(data.error);

      setRoute(null);
    } catch (err: any) {
      console.error('Delete error:', err);
      setError(err.message || 'Kon route niet verwijderen');
    }

    setActionLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (error && !event) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-red-500" />
          <p className="mt-2 text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Link
                to={`/events/${eventId}`}
                className="text-gray-500 hover:text-gray-700"
              >
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">
                  Route beheren
                </h1>
                <p className="text-sm text-gray-500">{event?.name}</p>
              </div>
            </div>

            {route && (
              <div className="flex items-center space-x-3">
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    route.status === 'published'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-yellow-100 text-yellow-800'
                  }`}
                >
                  {route.status === 'published' ? 'Gepubliceerd' : 'Concept'}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-4">
            <div className="flex">
              <AlertCircle className="h-5 w-5 text-red-500" />
              <p className="ml-3 text-sm text-red-800">{error}</p>
            </div>
          </div>
        )}

        {/* Preview Mode */}
        {preview && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium text-gray-900">
                Preview: {preview.name || 'Route'}
              </h2>
              <div className="flex items-center space-x-3">
                <button
                  onClick={handleCancelPreview}
                  className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  <X className="h-4 w-4 mr-2" />
                  Annuleren
                </button>
                <button
                  onClick={handleSave}
                  disabled={uploading}
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4 mr-2" />
                  )}
                  Opslaan
                </button>
              </div>
            </div>

            {/* Preview info */}
            <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
              <div className="bg-gray-50 rounded-lg p-3">
                <span className="text-gray-500">Afstand</span>
                <p className="font-medium">{formatDistance(preview.distance_m)}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <span className="text-gray-500">Punten</span>
                <p className="font-medium">{preview.points.length}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <span className="text-gray-500">Status</span>
                <p className="font-medium text-yellow-600">Preview</p>
              </div>
            </div>

            {/* Preview map */}
            <RouteMap
              geometry={preview.points.map((p) => [p.lng, p.lat])}
              bounds={preview.bounds}
              height="400px"
            />

            {uploadError && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-md p-3">
                <p className="text-sm text-red-800">{uploadError}</p>
              </div>
            )}
          </div>
        )}

        {/* Existing Route */}
        {route && !preview && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium text-gray-900">
                {route.name}
              </h2>
              <div className="flex items-center space-x-3">
                <button
                  onClick={handleToggleStatus}
                  disabled={actionLoading}
                  className={`inline-flex items-center px-3 py-2 border rounded-md text-sm font-medium ${
                    route.status === 'published'
                      ? 'border-yellow-300 text-yellow-700 bg-yellow-50 hover:bg-yellow-100'
                      : 'border-green-300 text-green-700 bg-green-50 hover:bg-green-100'
                  }`}
                >
                  {route.status === 'published' ? (
                    <>
                      <EyeOff className="h-4 w-4 mr-2" />
                      Verbergen
                    </>
                  ) : (
                    <>
                      <Eye className="h-4 w-4 mr-2" />
                      Publiceren
                    </>
                  )}
                </button>
                <button
                  onClick={handleDelete}
                  disabled={actionLoading}
                  className="inline-flex items-center px-3 py-2 border border-red-300 rounded-md text-sm font-medium text-red-700 bg-white hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Verwijderen
                </button>
              </div>
            </div>

            {/* Route info */}
            <div className="grid grid-cols-4 gap-4 mb-4 text-sm">
              <div className="bg-gray-50 rounded-lg p-3">
                <span className="text-gray-500">Afstand</span>
                <p className="font-medium">{formatDistance(route.distance_m)}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <span className="text-gray-500">Punten</span>
                <p className="font-medium">{route.point_count}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <span className="text-gray-500">Status</span>
                <p
                  className={`font-medium ${
                    route.status === 'published'
                      ? 'text-green-600'
                      : 'text-yellow-600'
                  }`}
                >
                  {route.status === 'published' ? 'Gepubliceerd' : 'Concept'}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <span className="text-gray-500">Laatst bijgewerkt</span>
                <p className="font-medium">
                  {new Date(route.updated_at).toLocaleDateString('nl-NL')}
                </p>
              </div>
            </div>

            {/* Route map */}
            <RouteMap
              geometry={route.route_geometry}
              bounds={route.bounds}
              height="400px"
            />
          </div>
        )}

        {/* Upload Section */}
        {!preview && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">
              {route ? 'Route vervangen' : 'Route uploaden'}
            </h2>

            {/* Drop zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                isDragging
                  ? 'border-indigo-500 bg-indigo-50'
                  : 'border-gray-300 hover:border-gray-400'
              }`}
            >
              <Upload
                className={`mx-auto h-12 w-12 ${
                  isDragging ? 'text-indigo-500' : 'text-gray-400'
                }`}
              />
              <p className="mt-4 text-lg font-medium text-gray-900">
                Sleep een GPX bestand hierheen
              </p>
              <p className="mt-2 text-sm text-gray-500">of</p>
              <label className="mt-4 inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 cursor-pointer">
                <FileText className="h-4 w-4 mr-2" />
                Selecteer GPX bestand
                <input
                  type="file"
                  accept=".gpx"
                  onChange={handleFileSelect}
                  className="sr-only"
                />
              </label>
              <p className="mt-4 text-xs text-gray-500">
                Alleen .gpx bestanden, max 5MB
              </p>
            </div>

            {uploadError && !preview && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-md p-3">
                <p className="text-sm text-red-800">{uploadError}</p>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!route && !preview && (
          <div className="mt-6 text-center text-gray-500">
            <Map className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-2">Nog geen route geüpload</p>
            <p className="text-sm">
              Upload een GPX bestand om de route van dit evenement in te stellen.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
