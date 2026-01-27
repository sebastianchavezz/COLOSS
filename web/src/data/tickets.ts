/**
 * Tickets Data Access Layer
 * 
 * Alle database operaties voor ticket_types (ticket configuratie) gecentraliseerd.
 * Gebruikt de singleton Supabase client met RLS.
 * 
 * Note: "Tickets" in de UI context refereert naar ticket_types (de configuratie).
 * De tabel `tickets` bevat de daadwerkelijke verkochte/gegenereerde tickets met barcodes.
 */

import { supabase } from '../lib/supabase'
import type { TicketType } from '../types/supabase'

// ============================================================
// TYPES
// ============================================================

/** Payload voor het aanmaken van een ticket type */
export interface CreateTicketPayload {
    name: string
    description?: string | null
    price: number          // In de valuta (bijv. EUR), niet cents
    capacity_total: number // 0 = unlimited in UI, maar DB vereist waarde
    sales_start?: string | null
    sales_end?: string | null
    currency?: string
}

/** Payload voor het updaten van een ticket type */
export interface UpdateTicketPayload {
    name?: string
    description?: string | null
    price?: number
    capacity_total?: number
    sales_start?: string | null
    sales_end?: string | null
    sort_order?: number
}

/** Status type */
export type TicketStatus = 'draft' | 'published' | 'closed'

// ============================================================
// CRUD OPERATIONS
// ============================================================

/**
 * Haal alle ticket types op voor een event
 * Gesorteerd op sort_order dan created_at
 * Alleen niet-verwijderde tickets
 */
export async function listTickets(eventId: string): Promise<{
    data: TicketType[] | null
    error: Error | null
}> {
    console.log('[tickets] listTickets:', { eventId })

    const { data, error } = await supabase
        .from('ticket_type_stats') // Use the view
        .select('*')
        .eq('event_id', eventId)
        .is('deleted_at', null)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })

    if (error) {
        console.error('[tickets] listTickets error:', error)
        return { data: null, error: new Error(error.message) }
    }

    return { data: data as unknown as TicketType[], error: null }
}

/**
 * Haal een specifiek ticket type op via ID
 */
export async function getTicketById(ticketId: string): Promise<{
    data: TicketType | null
    error: Error | null
}> {
    console.log('[tickets] getTicketById:', { ticketId })

    const { data, error } = await supabase
        .from('ticket_types')
        .select('*')
        .eq('id', ticketId)
        .is('deleted_at', null)
        .maybeSingle()

    if (error) {
        console.error('[tickets] getTicketById error:', error)
        return { data: null, error: new Error(error.message) }
    }

    return { data: data as TicketType | null, error: null }
}

/**
 * Maak een nieuw ticket type aan
 * Nieuwe tickets starten altijd als draft
 */
export async function createTicket(eventId: string, payload: CreateTicketPayload): Promise<{
    data: TicketType | null
    error: Error | null
}> {
    console.log('[tickets] createTicket:', { eventId, payload })

    // Bepaal sort_order: hoogste + 1
    const { data: existingTickets } = await supabase
        .from('ticket_types')
        .select('sort_order')
        .eq('event_id', eventId)
        .is('deleted_at', null)
        .order('sort_order', { ascending: false })
        .limit(1)

    const nextSortOrder = existingTickets && existingTickets[0]
        ? (existingTickets[0].sort_order || 0) + 1
        : 0

    const { data, error } = await supabase
        .from('ticket_types')
        .insert({
            event_id: eventId,
            name: payload.name,
            description: payload.description ?? null,
            price: payload.price,
            capacity_total: payload.capacity_total,
            sales_start: payload.sales_start ?? null,
            sales_end: payload.sales_end ?? null,
            currency: payload.currency ?? 'EUR',
            status: 'draft', // Nieuwe tickets starten als draft
            sort_order: nextSortOrder,
        })
        .select()
        .single()

    if (error) {
        console.error('[tickets] createTicket error:', error)
        return { data: null, error: new Error(error.message) }
    }

    console.log('[tickets] createTicket success:', data)
    return { data: data as TicketType, error: null }
}

/**
 * Update een bestaand ticket type
 */
export async function updateTicket(ticketId: string, payload: UpdateTicketPayload): Promise<{
    data: TicketType | null
    error: Error | null
}> {
    console.log('[tickets] updateTicket:', { ticketId, payload })

    const { data, error } = await supabase
        .from('ticket_types')
        .update(payload)
        .eq('id', ticketId)
        .is('deleted_at', null)
        .select()
        .single()

    if (error) {
        console.error('[tickets] updateTicket error:', error)
        return { data: null, error: new Error(error.message) }
    }

    return { data: data as TicketType, error: null }
}

/**
 * Wijzig de status van een ticket type
 */
export async function setTicketStatus(ticketId: string, status: TicketStatus): Promise<{
    data: TicketType | null
    error: Error | null
}> {
    console.log('[tickets] setTicketStatus:', { ticketId, status })

    const { data, error } = await supabase
        .from('ticket_types')
        .update({ status })
        .eq('id', ticketId)
        .is('deleted_at', null)
        .select()
        .single()

    if (error) {
        console.error('[tickets] setTicketStatus error:', error)
        return { data: null, error: new Error(error.message) }
    }

    return { data: data as TicketType, error: null }
}

/**
 * Soft delete: zet deleted_at timestamp
 */
export async function softDeleteTicket(ticketId: string): Promise<{
    success: boolean
    error: Error | null
}> {
    console.log('[tickets] softDeleteTicket:', { ticketId })

    const { error } = await supabase
        .from('ticket_types')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', ticketId)
        .is('deleted_at', null)

    if (error) {
        console.error('[tickets] softDeleteTicket error:', error)
        return { success: false, error: new Error(error.message) }
    }

    return { success: true, error: null }
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Format prijs voor display
 * @param price - Prijs als number (bijv. 25.00)
 * @param currency - Valuta code (default EUR)
 */
export function formatPrice(price: number, currency: string = 'EUR'): string {
    return new Intl.NumberFormat('nl-NL', {
        style: 'currency',
        currency: currency,
    }).format(price)
}

/**
 * Bereken beschikbare capaciteit
 * TODO: Implementeren wanneer tickets verkocht kunnen worden
 */
export function getAvailableCapacity(ticket: TicketType, _soldCount: number = 0): number | null {
    if (ticket.capacity_total === 0) return null // Unlimited
    return ticket.capacity_total - _soldCount
}

// ============================================================
// F005 EXTENDED CONFIGURATION
// ============================================================

/**
 * Haal volledige ticket configuratie op (inclusief i18n, time slots, team config)
 * Gebruikt RPC: get_ticket_type_full
 */
export async function getTicketTypeFull(ticketTypeId: string, locale: string = 'nl') {
    console.log('[tickets] getTicketTypeFull:', { ticketTypeId, locale })

    const { data, error } = await supabase.rpc('get_ticket_type_full', {
        _ticket_type_id: ticketTypeId,
        _locale: locale
    })

    if (error) {
        console.error('[tickets] getTicketTypeFull error:', error)
        return { data: null, error: new Error(error.message) }
    }

    if (data?.error) {
        return { data: null, error: new Error(data.error) }
    }

    return { data, error: null }
}

/**
 * Update extended ticket fields (distance, category, visibility, etc.)
 * Gebruikt RPC: update_ticket_type_extended
 */
export async function updateTicketExtended(ticketTypeId: string, updates: any) {
    console.log('[tickets] updateTicketExtended:', { ticketTypeId, updates })

    const { data, error } = await supabase.rpc('update_ticket_type_extended', {
        _ticket_type_id: ticketTypeId,
        _updates: updates
    })

    if (error) {
        console.error('[tickets] updateTicketExtended error:', error)
        return { data: null, error: new Error(error.message) }
    }

    if (data?.error) {
        return { data: null, error: new Error(data.error) }
    }

    return { data, error: null }
}

/**
 * Upsert i18n content voor ticket type
 */
export async function upsertTicketI18n(
    ticketTypeId: string,
    locale: string,
    name: string,
    description?: string,
    instructions?: string
) {
    console.log('[tickets] upsertTicketI18n:', { ticketTypeId, locale })

    const { data, error } = await supabase.rpc('upsert_ticket_type_i18n', {
        _ticket_type_id: ticketTypeId,
        _locale: locale,
        _name: name,
        _description: description || null,
        _instructions: instructions || null
    })

    if (error) {
        console.error('[tickets] upsertTicketI18n error:', error)
        return { data: null, error: new Error(error.message) }
    }

    return { data, error: null }
}

/**
 * Upsert time slot
 */
export async function upsertTimeSlot(
    ticketTypeId: string,
    slotTime: string,
    options: {
        slotDate?: string | null
        label?: string | null
        capacity?: number | null
        sortOrder?: number
        id?: string | null
    } = {}
) {
    console.log('[tickets] upsertTimeSlot:', { ticketTypeId, slotTime, options })

    const { data, error } = await supabase.rpc('upsert_ticket_time_slot', {
        _ticket_type_id: ticketTypeId,
        _slot_time: slotTime,
        _slot_date: options.slotDate || null,
        _label: options.label || null,
        _capacity: options.capacity || null,
        _sort_order: options.sortOrder || 0,
        _id: options.id || null
    })

    if (error) {
        console.error('[tickets] upsertTimeSlot error:', error)
        return { data: null, error: new Error(error.message) }
    }

    return { data, error: null }
}

/**
 * Delete time slot
 */
export async function deleteTimeSlot(slotId: string) {
    console.log('[tickets] deleteTimeSlot:', { slotId })

    const { data, error } = await supabase.rpc('delete_ticket_time_slot', {
        _slot_id: slotId
    })

    if (error) {
        console.error('[tickets] deleteTimeSlot error:', error)
        return { success: false, error: new Error(error.message) }
    }

    return { success: data, error: null }
}

/**
 * Upsert team config
 */
export async function upsertTeamConfig(
    ticketTypeId: string,
    config: {
        teamRequired?: boolean
        teamMinSize?: number
        teamMaxSize?: number
        allowIncompleteTeams?: boolean
        captainRequired?: boolean
    }
) {
    console.log('[tickets] upsertTeamConfig:', { ticketTypeId, config })

    const { data, error } = await supabase.rpc('upsert_ticket_team_config', {
        _ticket_type_id: ticketTypeId,
        _team_required: config.teamRequired ?? false,
        _team_min_size: config.teamMinSize ?? 2,
        _team_max_size: config.teamMaxSize ?? 10,
        _allow_incomplete_teams: config.allowIncompleteTeams ?? false,
        _captain_required: config.captainRequired ?? true
    })

    if (error) {
        console.error('[tickets] upsertTeamConfig error:', error)
        return { data: null, error: new Error(error.message) }
    }

    return { data, error: null }
}
