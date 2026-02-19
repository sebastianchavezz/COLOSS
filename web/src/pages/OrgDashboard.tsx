/**
 * OrgDashboard Page
 *
 * Landing page for organizers showing org-level statistics.
 * Uses get_org_dashboard_stats RPC from F010 S1.
 * S3: Added subscription management section.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarDays,
  Ticket,
  CheckCircle,
  TrendingUp,
  Clock,
  ArrowRight,
  Loader2,
  Activity,
  RefreshCw,
  Users,
  AlertTriangle,
  Euro
} from 'lucide-react'
import { clsx } from 'clsx'
import { useOrgSafe } from '../hooks/useOrg'
import { supabase } from '../lib/supabase'
import type {
  OrgDashboardStats,
  EventSummary,
  ActivityItem,
  OrgSubscriptionStats,
  SubscriberRow
} from '../types/dashboard'

export function OrgDashboard() {
  const context = useOrgSafe()
  const org = context?.org

  const [stats, setStats] = useState<OrgDashboardStats | null>(null)
  const [subStats, setSubStats] = useState<OrgSubscriptionStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    async function fetchStats() {
      if (!org) { setLoading(false); return }

      const [dashResult, subResult] = await Promise.all([
        supabase.rpc('get_org_dashboard_stats', { _org_id: org.id }),
        supabase.rpc('get_org_subscription_stats', { _org_id: org.id })
      ])

      if (cancelled) return

      if (dashResult.error) {
        setError(dashResult.error.message)
      } else if (dashResult.data?.error) {
        setError(dashResult.data.message || dashResult.data.error)
      } else {
        setStats(dashResult.data as OrgDashboardStats)
      }

      // Subscription stats are optional (may not exist yet)
      if (!subResult.error && subResult.data && 'summary' in subResult.data && !subResult.data?.error) {
        setSubStats(subResult.data as OrgSubscriptionStats)
      }

      setLoading(false)
    }

    fetchStats()
    return () => { cancelled = true }
  }, [org?.id])

  if (!org) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
      </div>
    )
  }

  if (error || !stats) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">{error || 'Kon dashboard niet laden'}</p>
      </div>
    )
  }

  const hasSubscriptions = subStats && subStats.summary.total > 0

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{stats.org.name}</h1>
        <p className="text-gray-500">Dashboard overzicht</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<CalendarDays className="h-6 w-6 text-indigo-600" />}
          label="Evenementen"
          value={stats.summary.events.total}
          subtext={`${stats.summary.events.upcoming} aankomend`}
          color="indigo"
        />
        <StatCard
          icon={<Ticket className="h-6 w-6 text-green-600" />}
          label="Tickets verkocht"
          value={stats.summary.tickets.issued}
          subtext={`van ${stats.summary.tickets.total_capacity} capaciteit`}
          color="green"
        />
        <StatCard
          icon={<CheckCircle className="h-6 w-6 text-blue-600" />}
          label="Ingecheckt"
          value={stats.summary.tickets.checked_in}
          subtext={stats.summary.tickets.issued > 0
            ? `${Math.round((stats.summary.tickets.checked_in / stats.summary.tickets.issued) * 100)}% van verkocht`
            : '0%'}
          color="blue"
        />
        {hasSubscriptions ? (
          <StatCard
            icon={<RefreshCw className="h-6 w-6 text-purple-600" />}
            label="Actieve abonnementen"
            value={subStats.summary.active}
            subtext={`MRR: \u20AC${Number(subStats.summary.mrr).toFixed(2)}`}
            color="purple"
          />
        ) : (
          <StatCard
            icon={<TrendingUp className="h-6 w-6 text-purple-600" />}
            label="Beschikbaar"
            value={stats.summary.tickets.available}
            subtext="tickets te koop"
            color="purple"
          />
        )}
      </div>

      {/* Subscription Section (only shown when org has subscriptions) */}
      {hasSubscriptions && (
        <SubscriptionSection stats={subStats} />
      )}

      {/* Events Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-gray-900">Evenementen</h2>
          <Link
            to={`/org/${org.slug}/events`}
            className="text-sm text-indigo-600 hover:text-indigo-500 flex items-center"
          >
            Alle bekijken <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </div>

        {stats.events.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg">
            <CalendarDays className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">Geen evenementen</h3>
            <p className="mt-1 text-sm text-gray-500">Maak je eerste evenement aan.</p>
            <Link
              to={`/org/${org.slug}/events/new`}
              className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700"
            >
              Nieuw evenement
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {stats.events.slice(0, 6).map((event) => (
              <EventCard key={event.id} event={event} orgSlug={org.slug} />
            ))}
          </div>
        )}
      </div>

      {/* Recent Activity */}
      {stats.recent_activity.length > 0 && (
        <div>
          <h2 className="text-lg font-medium text-gray-900 mb-4">Recente activiteit</h2>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <ul className="divide-y divide-gray-200">
              {stats.recent_activity.map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================
// Subscription Section (F010 S3)
// ============================================

function SubscriptionSection({ stats }: { stats: OrgSubscriptionStats }) {
  const [showAll, setShowAll] = useState(false)
  const displayedSubscribers = showAll ? stats.subscribers : stats.subscribers.slice(0, 10)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-gray-900">Abonnementen</h2>
      </div>

      {/* Subscription KPI Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MiniStatCard
          icon={<Users className="h-5 w-5 text-green-600" />}
          label="Actief"
          value={stats.summary.active}
        />
        <MiniStatCard
          icon={<AlertTriangle className="h-5 w-5 text-yellow-600" />}
          label="Achterstallig"
          value={stats.summary.past_due}
        />
        <MiniStatCard
          icon={<Euro className="h-5 w-5 text-indigo-600" />}
          label="MRR"
          value={`\u20AC${Number(stats.summary.mrr).toFixed(2)}`}
        />
        <MiniStatCard
          icon={<Euro className="h-5 w-5 text-green-600" />}
          label="Totale omzet"
          value={`\u20AC${Number(stats.summary.total_revenue).toFixed(2)}`}
        />
      </div>

      {/* Subscribers Table */}
      {stats.subscribers.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200">
            <h3 className="text-sm font-medium text-gray-900">
              Leden ({stats.subscribers.length})
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">E-mail</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Evenement</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Ticket</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Bedrag</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Cycli</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Volgende betaling</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {displayedSubscribers.map((sub) => (
                  <SubscriberTableRow key={sub.subscription_id} subscriber={sub} />
                ))}
              </tbody>
            </table>
          </div>
          {stats.subscribers.length > 10 && (
            <div className="px-4 py-3 border-t border-gray-200 text-center">
              <button
                onClick={() => setShowAll(!showAll)}
                className="text-sm text-indigo-600 hover:text-indigo-500"
              >
                {showAll ? 'Minder tonen' : `Alle ${stats.subscribers.length} leden tonen`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SubscriberTableRow({ subscriber }: { subscriber: SubscriberRow }) {
  const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
    active: { bg: 'bg-green-100', text: 'text-green-800', label: 'Actief' },
    pending_mandate: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'In afwachting' },
    past_due: { bg: 'bg-red-100', text: 'text-red-800', label: 'Achterstallig' },
    cancelled: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Opgezegd' },
    completed: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Voltooid' },
    suspended: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Opgeschort' }
  }

  const intervalLabels: Record<string, string> = {
    '1 month': '/mnd',
    '3 months': '/kwt',
    '1 year': '/jr'
  }

  const { bg, text, label } = statusConfig[subscriber.status] || statusConfig.active

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-2 text-sm text-gray-900 truncate max-w-[200px]">
        {subscriber.email}
      </td>
      <td className="px-4 py-2 text-sm text-gray-500 truncate max-w-[150px]">
        {subscriber.event_name}
      </td>
      <td className="px-4 py-2 text-sm text-gray-500 truncate max-w-[120px]">
        {subscriber.ticket_type_name}
      </td>
      <td className="px-4 py-2">
        <span className={clsx('inline-flex px-2 py-0.5 rounded text-xs font-medium', bg, text)}>
          {label}
        </span>
      </td>
      <td className="px-4 py-2 text-sm text-gray-900">
        {'\u20AC'}{Number(subscriber.amount).toFixed(2)}{intervalLabels[subscriber.billing_interval] || ''}
      </td>
      <td className="px-4 py-2 text-sm text-gray-500">
        {subscriber.cycles_completed}
      </td>
      <td className="px-4 py-2 text-sm text-gray-500">
        {subscriber.next_payment_date
          ? new Date(subscriber.next_payment_date).toLocaleDateString('nl-NL', {
              day: 'numeric',
              month: 'short',
              year: 'numeric'
            })
          : '-'}
      </td>
    </tr>
  )
}

function MiniStatCard({
  icon,
  label,
  value
}: {
  icon: React.ReactNode
  label: string
  value: number | string
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex items-center space-x-3">
        <div className="flex-shrink-0">{icon}</div>
        <div>
          <p className="text-xs text-gray-500">{label}</p>
          <p className="text-lg font-semibold text-gray-900">
            {typeof value === 'number' ? value.toLocaleString() : value}
          </p>
        </div>
      </div>
    </div>
  )
}

// ============================================
// Sub-components (existing)
// ============================================

function StatCard({
  icon,
  label,
  value,
  subtext,
  color
}: {
  icon: React.ReactNode
  label: string
  value: number
  subtext: string
  color: 'indigo' | 'green' | 'blue' | 'purple'
}) {
  const bgColors = {
    indigo: 'bg-indigo-50',
    green: 'bg-green-50',
    blue: 'bg-blue-50',
    purple: 'bg-purple-50'
  }

  return (
    <div className="bg-white overflow-hidden shadow-sm rounded-lg border border-gray-200">
      <div className="p-5">
        <div className="flex items-center">
          <div className={clsx('flex-shrink-0 rounded-md p-3', bgColors[color])}>
            {icon}
          </div>
          <div className="ml-4 flex-1">
            <p className="text-sm font-medium text-gray-500">{label}</p>
            <p className="text-2xl font-semibold text-gray-900">{value.toLocaleString()}</p>
            <p className="text-xs text-gray-400">{subtext}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function EventCard({ event, orgSlug }: { event: EventSummary; orgSlug: string }) {
  const statusConfig = {
    draft: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Concept' },
    published: { bg: 'bg-green-100', text: 'text-green-800', label: 'Live' },
    closed: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Gesloten' }
  }

  const { bg, text, label } = statusConfig[event.status] || statusConfig.draft

  const checkinPercent = event.tickets.issued > 0
    ? Math.round((event.tickets.checked_in / event.tickets.issued) * 100)
    : 0

  return (
    <Link
      to={`/org/${orgSlug}/events/${event.slug}`}
      className="block bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow"
    >
      <div className="p-5">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-900 truncate">{event.name}</p>
            <p className="text-xs text-gray-500 mt-1">
              {new Date(event.start_time).toLocaleDateString('nl-NL', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
              })}
            </p>
          </div>
          <span className={clsx('inline-flex px-2 py-0.5 rounded text-xs font-medium', bg, text)}>
            {label}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-lg font-semibold text-gray-900">{event.tickets.issued}</p>
            <p className="text-xs text-gray-500">Verkocht</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-gray-900">{event.tickets.checked_in}</p>
            <p className="text-xs text-gray-500">Ingecheckt</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-gray-900">{event.tickets.available}</p>
            <p className="text-xs text-gray-500">Beschikbaar</p>
          </div>
        </div>

        {/* Check-in progress bar */}
        {event.tickets.issued > 0 && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Check-in voortgang</span>
              <span>{checkinPercent}%</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all"
                style={{ width: `${checkinPercent}%` }}
              />
            </div>
          </div>
        )}

        {event.days_until !== null && event.days_until > 0 && (
          <div className="mt-3 flex items-center text-xs text-gray-500">
            <Clock className="h-3 w-3 mr-1" />
            Nog {event.days_until} dag{event.days_until !== 1 ? 'en' : ''}
          </div>
        )}
      </div>
    </Link>
  )
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const actionLabels: Record<string, string> = {
    'REGISTRATION_CREATED_FROM_ORDER': 'Nieuwe registratie',
    'TICKET_CHECKED_IN': 'Ticket ingecheckt',
    'ORDER_PAID': 'Bestelling betaald',
    'EVENT_CREATED': 'Evenement aangemaakt',
    'EVENT_PUBLISHED': 'Evenement gepubliceerd',
    'REFUND_CREATED': 'Terugbetaling',
    'TICKET_TRANSFERRED': 'Ticket overdracht',
    'SUBSCRIPTION_PAYMENT_PROCESSED': 'Abonnement verlengd',
    'SUBSCRIPTION_CANCELLED': 'Abonnement opgezegd',
    'SUBSCRIPTION_PAYMENT_FAILED': 'Abonnementsbetaling mislukt'
  }

  return (
    <li className="px-4 py-3 hover:bg-gray-50">
      <div className="flex items-center justify-between">
        <div className="flex items-center min-w-0">
          <Activity className="h-4 w-4 text-gray-400 mr-3 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-sm text-gray-900">
              {actionLabels[item.action] || item.action}
            </p>
            {item.event_name && (
              <p className="text-xs text-gray-500 truncate">{item.event_name}</p>
            )}
          </div>
        </div>
        <time className="text-xs text-gray-400 flex-shrink-0 ml-4">
          {formatRelativeTime(item.created_at)}
        </time>
      </div>
    </li>
  )
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return 'Zojuist'
  if (diffMins < 60) return `${diffMins}m geleden`
  if (diffHours < 24) return `${diffHours}u geleden`
  if (diffDays < 7) return `${diffDays}d geleden`

  return date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
}

export default OrgDashboard
