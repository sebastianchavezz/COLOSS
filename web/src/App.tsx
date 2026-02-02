/**
 * App Routes Configuration
 * 
 * Routing structuur:
 * /login                           - Login pagina
 * /                                - Redirect naar /org/demo/events
 * /org/:orgSlug                    - Org container (Layout)
 * /org/:orgSlug/events             - Events lijst
 * /org/:orgSlug/events/new         - Nieuw event aanmaken
 * /org/:orgSlug/events/:eventSlug  - Event detail (met sub-routes)
 */

import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import { Layout } from './components/Layout'
import { EventsList } from './pages/EventsList'
import { EventCreate } from './pages/EventCreate'
import {
  EventDetail,
  EventOverview,
  EventProducts,
} from './pages/EventDetail'
import { EventSettings } from './pages/EventSettings'
import { EventCommunication } from './pages/EventCommunication'
import { EventMessaging } from './pages/EventMessaging'
import { EventFaqAdmin } from './pages/EventFaqAdmin'
import { EventTickets } from './pages/EventTickets'
import { EventOrders } from './pages/EventOrders'
import { EventParticipants } from './pages/EventParticipants'
import { PublicEventCheckout } from './pages/public/PublicEventCheckout'
import { PublicConfirm } from './pages/public/PublicConfirm'
import { PublicEvents } from './pages/public/PublicEvents'
import { PublicEventDetail } from './pages/public/PublicEventDetail'
import { ParticipantChat } from './pages/ParticipantChat'
import { PublicFaq } from './pages/PublicFaq'
import Login from './pages/Login'
import Signup from './pages/Signup'
import ResetPassword from './pages/ResetPassword'
import AuthCallback from './pages/AuthCallback'
import AuthDebug from './components/AuthDebug'

import { ScanPage } from './pages/ScanPage'
import { Scanner } from './pages/events/Scanner'
import { MobileScanner } from './pages/MobileScanner'
import CheckIn from './pages/events/CheckIn'
import Transfers from './pages/events/Transfers'
import { EventRouteAdmin } from './pages/events/EventRouteAdmin'
import { EventRouteTab } from './pages/events/EventRouteTab'
import { EventRoute } from './pages/public/EventRoute'
import { EventInvitations } from './pages/EventInvitations'
import { PublicInvite } from './pages/public/PublicInvite'
import { TeamPage } from './pages/TeamPage'
import { OrgDashboard } from './pages/OrgDashboard'
import { Homepage } from './pages/Homepage'
import { ComingSoon } from './pages/ComingSoon'
import { SporterLayout, SporterDashboard, MijnTickets, MijnBerichten, Profiel } from './pages/sporter'

// Set to true to enable "Coming Soon" mode for deployment
const COMING_SOON_MODE = false

function App() {
  // Coming Soon Mode - only homepage and coming-soon page work
  if (COMING_SOON_MODE) {
    return (
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Homepage />} />
            <Route path="/coming-soon" element={<ComingSoon />} />
            {/* All other routes go to Coming Soon */}
            <Route path="*" element={<ComingSoon />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    )
  }

  return (
    <AuthProvider>
      <AuthDebug />
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<Homepage />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/e/:eventSlug" element={<PublicEventCheckout />} />
          <Route path="/e/:eventSlug/confirm" element={<PublicConfirm />} />
          <Route path="/e/:eventSlug/chat" element={<ParticipantChat />} />
          <Route path="/e/:eventSlug/faq" element={<PublicFaq />} />
          <Route path="/e/:eventSlug/route" element={<EventRoute />} />

          {/* Public Invite */}
          <Route path="/invite/:code" element={<PublicInvite />} />

          {/* Public Event Discovery */}
          <Route path="/events" element={<PublicEvents />} />
          <Route path="/events/:slug" element={<PublicEventDetail />} />

          {/* Protected Routes Wrapper */}
          <Route element={<ProtectedRoute><Outlet /></ProtectedRoute>}>

            {/* Sporter Dashboard Routes */}
            <Route path="/my" element={<SporterLayout />}>
              <Route index element={<SporterDashboard />} />
              <Route path="tickets" element={<MijnTickets />} />
              <Route path="messages" element={<MijnBerichten />} />
              <Route path="profile" element={<Profiel />} />
            </Route>

            {/* Organizer Scan Routes */}
            <Route path="/scan/:eventSlug" element={<ScanPage />} />
            <Route path="/scan/m/:eventSlug" element={<MobileScanner />} />

            {/* Operations Routes (Direct Access) */}
            <Route path="/events/:eventId/check-in" element={<CheckIn />} />
            <Route path="/events/:eventId/transfers" element={<Transfers />} />
            <Route path="/events/:eventId/route" element={<EventRouteAdmin />} />

            {/* Redirect /dashboard naar default org */}
            <Route path="/dashboard" element={<Navigate to="/org/demo/events" replace />} />

            {/* Org-scoped routes (protected by Layout) */}
            <Route path="/org/:orgSlug" element={<Layout><Outlet /></Layout>}>
              {/* Org Dashboard landing page */}
              <Route index element={<OrgDashboard />} />

              {/* Events module */}
              <Route path="events" element={<EventsList />} />
              <Route path="events/new" element={<EventCreate />} />

              {/* Event detail met sub-routes */}
              <Route path="events/:eventSlug" element={<EventDetail />}>
                <Route index element={<EventOverview />} />
                <Route path="tickets" element={<EventTickets />} />
                <Route path="orders" element={<EventOrders />} />
                <Route path="participants" element={<EventParticipants />} />
                <Route path="route" element={<EventRouteTab />} />
                <Route path="products" element={<EventProducts />} />
                <Route path="communication" element={<EventCommunication />} />
                <Route path="messaging" element={<EventMessaging />} />
                <Route path="faq" element={<EventFaqAdmin />} />
                <Route path="invitations" element={<EventInvitations />} />
                <Route path="scanner" element={<Scanner />} />
                <Route path="settings" element={<EventSettings />} />
              </Route>

              {/* Org-level routes */}
              <Route path="team" element={<TeamPage />} />
              <Route path="finance" element={<div className="p-4 text-gray-500">Finance Dashboard - Coming soon</div>} />
              <Route path="settings" element={<div className="p-4 text-gray-500">Organisatie Instellingen - Coming soon</div>} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
