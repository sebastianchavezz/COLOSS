/**
 * Dashboard Types for Organizer Dashboard (F010)
 *
 * These types match the JSONB structure returned by the dashboard RPCs:
 * - get_org_dashboard_stats
 * - get_event_dashboard_stats
 * - get_event_participant_stats
 */

// ============================================
// Organization Dashboard
// ============================================

export interface OrgDashboardStats {
  org: {
    id: string;
    name: string;
    slug: string;
    created_at: string;
  };
  summary: {
    events: EventsSummary;
    tickets: TicketsSummary;
  };
  events: EventSummary[];
  recent_activity: ActivityItem[];
  generated_at: string;
  // Error case
  error?: string;
  message?: string;
}

export interface EventsSummary {
  total: number;
  draft: number;
  published: number;
  closed: number;
  upcoming: number;
}

export interface TicketsSummary {
  issued: number;
  checked_in: number;
  available: number;
  total_capacity: number;
}

export interface EventSummary {
  id: string;
  name: string;
  slug: string;
  status: "draft" | "published" | "closed";
  start_time: string;
  end_time: string | null;
  tickets: {
    issued: number;
    checked_in: number;
    available: number;
    capacity: number;
  };
  checkin_percentage: number;
  days_until: number | null;
}

export interface ActivityItem {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
  event_name: string | null;
  metadata: Record<string, unknown> | null;
}

// ============================================
// Event Dashboard
// ============================================

export interface EventDashboardStats {
  event: EventDetail;
  tickets: TicketsSummary;
  ticket_types: TicketTypeStats[];
  checkins: CheckinStats;
  recent_orders: RecentOrder[];
  recent_checkins: RecentCheckin[];
  generated_at: string;
  // Error case
  error?: string;
  message?: string;
}

export interface EventDetail {
  id: string;
  name: string;
  slug: string;
  status: "draft" | "published" | "closed";
  start_time: string;
  end_time: string | null;
  location_name: string | null;
  org_name: string;
  description: string | null;
}

export interface TicketTypeStats {
  id: string;
  name: string;
  price: number;
  capacity: number;
  sold: number;
  checked_in: number;
  available: number;
  sales_start: string | null;
  sales_end: string | null;
}

export interface CheckinStats {
  total: number;
  today: number;
  last_checkin_at: string | null;
  hourly: HourlyCheckin[];
}

export interface HourlyCheckin {
  hour: string;
  count: number;
}

export interface RecentOrder {
  id: string;
  email: string;
  total_amount: number;
  currency: string;
  status: string;
  created_at: string;
}

export interface RecentCheckin {
  ticket_id: string;
  checked_in_at: string;
  ticket_type_name: string;
  source: string;
}

// ============================================
// Participant Stats
// ============================================

export interface EventParticipantStats {
  event_id: string;
  participants: ParticipantSummary;
  ticket_distribution: TicketDistribution[];
  generated_at: string;
  // Error case
  error?: string;
  message?: string;
}

export interface ParticipantSummary {
  total_orders: number;
  paid_orders: number;
  pending_orders: number;
  unique_emails: number;
  authenticated_users: number;
  guest_orders: number;
}

export interface TicketDistribution {
  ticket_type_id: string;
  ticket_type_name: string;
  count: number;
  percentage: number;
}

// ============================================
// API Response Helpers
// ============================================

export type DashboardApiResponse<T> = T & {
  error?: string;
  message?: string;
};

export function isDashboardError<T>(
  response: DashboardApiResponse<T>
): response is T & { error: string; message: string } {
  return "error" in response && response.error !== undefined;
}
