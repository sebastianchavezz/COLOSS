export interface AppEvent {
    id: string
    org_id: string
    slug: string
    name: string
    description: string | null
    location_name: string | null
    start_time: string
    end_time: string | null
    status: 'draft' | 'published' | 'closed'
    created_at: string
    updated_at: string
    deleted_at: string | null
}

export interface EventSettings {
    event_id: string
    currency: string
    vat_percentage: number
    support_email: string | null
    website: string | null
    is_public_visible: boolean
    allow_waitlist: boolean
    created_at: string
    updated_at: string
}

export interface Organization {
    id: string
    name: string
    slug: string
    created_at: string
    updated_at: string
}

/**
 * TicketType: Een ticketconfiguratie/product voor een event
 * (bijv. "Early Bird", "VIP", "Standaard")
 */
export interface TicketType {
    id: string
    event_id: string
    name: string
    description: string | null
    price: number            // decimal in db, number in JS
    vat_percentage: number
    currency: string
    capacity_total: number
    sales_start: string | null
    sales_end: string | null
    status: 'draft' | 'published' | 'closed'
    sort_order: number
    created_at: string
    updated_at: string
    deleted_at: string | null
}
