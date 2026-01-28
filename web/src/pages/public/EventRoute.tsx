/**
 * EventRoute (Public)
 *
 * Participant view for event routes.
 * Read-only, only shows published routes for published events.
 *
 * Route: /events/:eventSlug/route OR /e/:eventSlug/route
 */

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Map, Loader2, AlertCircle, ArrowLeft, MapPin, Ruler } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { RouteMap } from '../../components/RouteMap';
import { formatDistance } from '../../lib/gpx';

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
  created_at: string;
  updated_at: string;
}

interface EventInfo {
  id: string;
  name: string;
  slug: string;
  start_time: string | null;
  location_name: string | null;
}

export function EventRoute() {
  const { eventSlug } = useParams<{ eventSlug: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [route, setRoute] = useState<EventRoute | null>(null);

  useEffect(() => {
    async function fetchData() {
      if (!eventSlug) return;

      setLoading(true);
      setError(null);

      try {
        // Get event by slug
        const { data: eventData, error: eventError } = await supabase
          .from('events')
          .select('id, name, slug, start_time, location_name, status')
          .eq('slug', eventSlug)
          .eq('status', 'published')
          .is('deleted_at', null)
          .single();

        if (eventError || !eventData) {
          setError('Evenement niet gevonden');
          setLoading(false);
          return;
        }

        setEvent(eventData);

        // Get route
        const { data: routeData, error: routeError } = await supabase.rpc('get_event_route', {
          _event_id: eventData.id,
        });

        if (routeError) {
          console.error('Route error:', routeError);
          // Don't set error - route might just not exist
        } else if (routeData?.error) {
          // Route not found or not published
          if (routeData.error !== 'ROUTE_NOT_FOUND') {
            console.log('Route status:', routeData.error);
          }
        } else if (routeData?.route) {
          setRoute(routeData.route);
        }
      } catch (err: any) {
        console.error('Error:', err);
        setError(err.message || 'Kon gegevens niet ophalen');
      }

      setLoading(false);
    }

    fetchData();
  }, [eventSlug]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (error && !event) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-red-500" />
          <h2 className="mt-4 text-xl font-semibold text-gray-900">
            Evenement niet gevonden
          </h2>
          <p className="mt-2 text-gray-600">{error}</p>
          <Link
            to="/events"
            className="mt-4 inline-flex items-center text-indigo-600 hover:text-indigo-500"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Terug naar evenementen
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center space-x-4">
            <Link
              to={`/e/${eventSlug}`}
              className="text-gray-500 hover:text-gray-700"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Route</h1>
              <p className="text-sm text-gray-500">{event?.name}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {route ? (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            {/* Route info */}
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">
                    {route.name}
                  </h2>
                  {route.description && (
                    <p className="mt-1 text-gray-600">{route.description}</p>
                  )}
                </div>
                <div className="flex items-center space-x-6 text-sm">
                  <div className="flex items-center text-gray-500">
                    <Ruler className="h-5 w-5 mr-2" />
                    <span className="font-medium text-gray-900">
                      {formatDistance(route.distance_m)}
                    </span>
                  </div>
                  {event?.location_name && (
                    <div className="flex items-center text-gray-500">
                      <MapPin className="h-5 w-5 mr-2" />
                      <span>{event.location_name}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Map */}
            <div className="p-0">
              <RouteMap
                geometry={route.route_geometry}
                bounds={route.bounds}
                height="500px"
                className="rounded-none"
              />
            </div>

            {/* Legend */}
            <div className="p-4 bg-gray-50 border-t border-gray-200">
              <div className="flex items-center justify-center space-x-6 text-sm text-gray-600">
                <div className="flex items-center">
                  <div className="w-4 h-4 rounded-full bg-green-500 mr-2" />
                  <span>Start</span>
                </div>
                <div className="flex items-center">
                  <div className="w-4 h-4 rounded-full bg-red-500 mr-2" />
                  <span>Finish</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          // Empty state
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <Map className="mx-auto h-16 w-16 text-gray-300" />
            <h2 className="mt-4 text-xl font-semibold text-gray-900">
              Geen route beschikbaar
            </h2>
            <p className="mt-2 text-gray-500">
              De organisator heeft nog geen route gepubliceerd voor dit
              evenement.
            </p>
            <Link
              to={`/e/${eventSlug}`}
              className="mt-6 inline-flex items-center text-indigo-600 hover:text-indigo-500"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Terug naar evenement
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
