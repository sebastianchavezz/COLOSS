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
    subscriptions?: SubscriptionsSummary;
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

export interface SubscriptionsSummary {
  active: number;
  past_due: number;
  mrr: number;
}

// ============================================
// Subscription Dashboard (F010 S3)
// ============================================

export interface OrgSubscriptionStats {
  summary: {
    total: number;
    active: number;
    pending_mandate: number;
    past_due: number;
    cancelled: number;
    completed: number;
    suspended: number;
    mrr: number;
    total_revenue: number;
  };
  per_event: SubscriptionEventBreakdown[];
  subscribers: SubscriberRow[];
  recent_payments: SubscriptionPaymentRow[];
  generated_at: string;
  error?: string;
  message?: string;
}

export interface SubscriptionEventBreakdown {
  event_id: string;
  event_name: string;
  event_slug: string;
  event_mode: string;
  active: number;
  past_due: number;
  cancelled: number;
  total: number;
}

export interface SubscriberRow {
  subscription_id: string;
  user_id: string;
  email: string;
  event_id: string;
  event_name: string;
  ticket_type_name: string;
  status: string;
  billing_interval: string;
  amount: number;
  currency: string;
  cycles_completed: number;
  current_period_start: string | null;
  current_period_end: string | null;
  next_payment_date: string | null;
  started_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
}

export interface SubscriptionPaymentRow {
  payment_id: string;
  subscription_id: string;
  email: string;
  event_name: string;
  mollie_payment_id: string;
  status: string;
  amount: number;
  currency: string;
  cycle_number: number | null;
  period_start: string | null;
  period_end: string | null;
  failure_reason: string | null;
  created_at: string;
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
