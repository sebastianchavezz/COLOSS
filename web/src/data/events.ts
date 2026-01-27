/**
 * Events Data Access Layer
 * 
 * Alle database operaties voor events gecentraliseerd.
 * Gebruikt de singleton Supabase client met RLS.
 * 
 * Geen service_role key nodig - alles gaat via anon key + user JWT.
 */

import { supabase } from '../lib/supabase'
import type { AppEvent } from '../types/supabase'

// ============================================================
// TYPES
// ============================================================

/** Payload voor het aanmaken van een event */
export interface CreateEventPayload {
    name: string
    start_time: string // ISO datetime string
    end_time?: string | null
    location_name?: string | null
    description?: string | null
}

/** Payload voor het updaten van een event */
export interface UpdateEventPayload {
    name?: string
    start_time?: string
    end_time?: string | null
    location_name?: string | null
    description?: string | null
}

/** Type alias voor event status */
export type EventStatus = 'draft' | 'published' | 'closed'

// ============================================================
// HELPERS
// ============================================================

/**
 * Slugify: Converteer string naar URL-safe slug
 * - Lowercase
 * - Spaties -> hyphens
 * - Verwijder speciale karakters
 * - Max 50 karakters
 */
export function slugify(text: string): string {
    return text
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')       // Verwijder speciale karakters
        .replace(/[\s_-]+/g, '-')        // Vervang witruimte/underscores door hyphens
        .replace(/^-+|-+$/g, '')         // Verwijder leading/trailing hyphens
        .substring(0, 50)                 // Max lengte
}

/**
 * Genereer unieke slug voor event binnen org
 * Probeert base slug, dan slug-2, slug-3, etc.
 */
async function generateUniqueSlug(orgId: string, baseName: string): Promise<string> {
    const baseSlug = slugify(baseName)

    // Probeer eerst de base slug
    const { data: existing } = await supabase
        .from('events')
        .select('slug')
        .eq('org_id', orgId)
        .eq('slug', baseSlug)
        .is('deleted_at', null)
        .maybeSingle()

    if (!existing) {
        return baseSlug
    }

    // Base slug bestaat, probeer met suffix
    for (let i = 2; i <= 100; i++) {
        const candidateSlug = `${baseSlug}-${i}`
        const { data: conflict } = await supabase
            .from('events')
            .select('slug')
            .eq('org_id', orgId)
            .eq('slug', candidateSlug)
            .is('deleted_at', null)
            .maybeSingle()

        if (!conflict) {
            return candidateSlug
        }
    }

    // Fallback: voeg random suffix toe
    return `${baseSlug}-${Date.now().toString(36)}`
}

// ============================================================
// CRUD OPERATIONS
// ============================================================

/**
 * Haal alle events op voor een organisatie
 * Gesorteerd op start_time (opkomend)
 * Alleen niet-verwijderde events
 */
export async function listEvents(orgId: string): Promise<{
    data: AppEvent[] | null
    error: Error | null
}> {
    console.log('[events] listEvents:', { orgId })

    const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .order('start_time', { ascending: true })

    if (error) {
        console.error('[events] listEvents error:', error)
        return { data: null, error: new Error(error.message) }
    }

    return { data: data as AppEvent[], error: null }
}

/**
 * Haal een specifiek event op via slug
 */
export async function getEventBySlug(orgId: string, eventSlug: string): Promise<{
    data: AppEvent | null
    error: Error | null
}> {
    console.log('[events] getEventBySlug:', { orgId, eventSlug })

    const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('org_id', orgId)
        .eq('slug', eventSlug)
        .is('deleted_at', null)
        .maybeSingle()

    if (error) {
        console.error('[events] getEventBySlug error:', error)
        return { data: null, error: new Error(error.message) }
    }

    return { data: data as AppEvent | null, error: null }
}

/**
 * Haal een specifiek event op via ID
 */
export async function getEventById(eventId: string): Promise<{
    data: AppEvent | null
    error: Error | null
}> {
    console.log('[events] getEventById:', { eventId })

    const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('id', eventId)
        .is('deleted_at', null)
        .maybeSingle()

    if (error) {
        console.error('[events] getEventById error:', error)
        return { data: null, error: new Error(error.message) }
    }

    return { data: data as AppEvent | null, error: null }
}

/**
 * Maak een nieuw event aan
 * Genereert automatisch een unieke slug op basis van de naam
 */
export async function createEvent(orgId: string, payload: CreateEventPayload): Promise<{
    data: AppEvent | null
    error: Error | null
}> {
    console.log('[events] createEvent:', { orgId, payload })

    // Genereer unieke slug
    const slug = await generateUniqueSlug(orgId, payload.name)

    const { data, error } = await supabase
        .from('events')
        .insert({
            org_id: orgId,
            slug,
            name: payload.name,
            start_time: payload.start_time,
            end_time: payload.end_time ?? null,
            location_name: payload.location_name ?? null,
            description: payload.description ?? null,
            status: 'draft' // Nieuwe events starten altijd als draft
        })
        .select()
        .single()

    if (error) {
        console.error('[events] createEvent error:', error)
        return { data: null, error: new Error(error.message) }
    }

    console.log('[events] createEvent success:', data)
    return { data: data as AppEvent, error: null }
}

/**
 * Update een bestaand event
 */
export async function updateEvent(eventId: string, payload: UpdateEventPayload): Promise<{
    data: AppEvent | null
    error: Error | null
}> {
    console.log('[events] updateEvent:', { eventId, payload })

    const { data, error } = await supabase
        .from('events')
        .update(payload)
        .eq('id', eventId)
        .is('deleted_at', null)
        .select()
        .single()

    if (error) {
        console.error('[events] updateEvent error:', error)
        return { data: null, error: new Error(error.message) }
    }

    return { data: data as AppEvent, error: null }
}

/**
 * Wijzig de status van een event
 * Mogelijke transities: draft <-> published, published -> closed, closed -> published
 */
export async function setEventStatus(eventId: string, status: EventStatus): Promise<{
    data: AppEvent | null
    error: Error | null
}> {
    console.log('[events] setEventStatus:', { eventId, status })

    const { data, error } = await supabase
        .from('events')
        .update({ status })
        .eq('id', eventId)
        .is('deleted_at', null)
        .select()
        .single()

    if (error) {
        console.error('[events] setEventStatus error:', error)
        return { data: null, error: new Error(error.message) }
    }

    return { data: data as AppEvent, error: null }
}

/**
 * Soft delete: zet deleted_at timestamp
 * Event blijft in DB maar is niet meer zichtbaar in normale queries
 */
export async function softDeleteEvent(eventId: string): Promise<{
    success: boolean
    error: Error | null
}> {
    console.log('[events] softDeleteEvent:', { eventId })

    const { error } = await supabase
        .from('events')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', eventId)
        .is('deleted_at', null)

    if (error) {
        console.error('[events] softDeleteEvent error:', error)
        return { success: false, error: new Error(error.message) }
    }

    return { success: true, error: null }
}
