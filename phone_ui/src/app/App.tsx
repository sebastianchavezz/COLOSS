import { useState, useEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider } from "@/app/contexts/AuthContext";
import { ProtectedRoute } from "@/app/components/ProtectedRoute";
import { EventCard } from "@/app/components/EventCard";
import { MobileHeader } from "@/app/components/MobileHeader";
import { BottomNav } from "@/app/components/BottomNav";
import { EventDetail } from "@/app/pages/EventDetail";
import { Login } from "@/app/pages/Login";
import { AuthCallback } from "@/app/pages/AuthCallback";
import { AuthDebug } from "@/app/components/AuthDebug";
import { MyTickets } from "@/app/pages/MyTickets";
import { TicketDetail } from "@/app/pages/TicketDetail";
import { PendingTransfers } from "@/app/pages/PendingTransfers";
import { supabase } from "@/lib/supabase";

// Type for our event data
interface Event {
  id: string;
  title: string;
  organizer: string;
  date: string;
  location: string;
  distance: string;
  participants: number;
  category: "trail" | "road" | "ultra";
}

export default function App() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const location = useLocation();

  // Hide bottom nav on detail pages
  const showBottomNav = !location.pathname.startsWith('/event/') && !location.pathname.startsWith('/tickets/');

  useEffect(() => {
    async function fetchEvents() {
      try {
        console.log('🔍 Fetching events from Supabase...');

        // Simplified query first - just get events without joins
        const { data, error } = await supabase
          .from('events')
          .select('*', { count: 'exact' })
          .eq('status', 'published')
          .order('start_time', { ascending: true });

        if (error) {
          console.error('❌ Supabase error:', error);
          setError(error.message);
          return;
        }

        if (!data || data.length === 0) {
          console.warn('⚠️ No events found in database');
          setEvents([]);
          setLoading(false);
          return;
        }

        // Transform Supabase data to match our Event interface
        const transformedEvents: Event[] = data.map((event: any) => ({
          id: event.id,
          title: event.name || 'Untitled Event',
          organizer: 'Event Organizer', // Simplified for now
          date: new Date(event.start_time).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric'
          }),
          location: event.location_name || 'Location TBD',
          distance: 'Various',
          participants: 0,
          category: 'road' as const,
        }));

        setEvents(transformedEvents);
      } catch (err) {
        console.error('💥 Unexpected error:', err);
        setError('Failed to load events');
      } finally {
        setLoading(false);
      }
    }

    fetchEvents();
  }, []);

  return (
    <AuthProvider>
      <AuthDebug />
      <div className="min-h-screen bg-white flex items-center justify-center p-4">
        {/* iOS Mobile Frame */}
        <div className="w-full max-w-[390px] h-[844px] bg-white rounded-[3rem] shadow-2xl overflow-hidden relative">
          {/* Mobile App Container */}
          <div className="h-full flex flex-col bg-white overflow-hidden">
            {/* Header only on home */}
            {location.pathname === '/' && <MobileHeader />}

            <Routes>
              <Route path="/" element={
                <main className="flex-1 overflow-y-auto px-5 pt-4 pb-24">
                  {loading ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#0047FF]" />
                    </div>
                  ) : error ? (
                    <div className="text-center py-12">
                      <p className="text-red-600 mb-2">Failed to load events</p>
                      <p className="text-sm text-gray-500">{error}</p>
                    </div>
                  ) : events.length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-gray-500">No events found</p>
                    </div>
                  ) : (
                    events.map((event) => (
                      <EventCard key={event.id} {...event} />
                    ))
                  )}
                </main>
              } />
              <Route path="/event/:eventId" element={<EventDetail />} />
              <Route path="/login" element={<Login />} />
              <Route path="/auth/callback" element={<AuthCallback />} />

              {/* Protected Routes */}
              <Route path="/tickets" element={
                <ProtectedRoute>
                  <MyTickets />
                </ProtectedRoute>
              } />
              <Route path="/tickets/:ticketId" element={
                <ProtectedRoute>
                  <TicketDetail />
                </ProtectedRoute>
              } />
              <Route path="/transfers/pending" element={
                <ProtectedRoute>
                  <PendingTransfers />
                </ProtectedRoute>
              } />
            </Routes>

            {/* Bottom Navigation */}
            {showBottomNav && <BottomNav />}
          </div>
        </div>
      </div>
    </AuthProvider>
  );
}