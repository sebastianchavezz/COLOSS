/**
 * Public Events Data Access Layer
 * 
 * Specifiek voor publieke toegang (anonieme gebruikers).
 * Gebruikt de 'public_events' view om governance en privacy settings af te dwingen.
 */

import { supabase } from '../lib/supabase'
import type { AppEvent } from '../types/supabase'

/**
 * Haal een publiek event op via slug.
 * Faalt als het event niet bestaat, niet published is, of als is_private=true.
 */
export async function getPublicEventBySlug(eventSlug: string): Promise<{
    data: AppEvent | null
    error: Error | null
}> {
    console.log('[public_events] getPublicEventBySlug:', { eventSlug })

    const { data, error } = await supabase
        .from('public_events')
        .select('id, slug, name, start_time, location_name, status')
        .eq('slug', eventSlug)
        .maybeSingle()

    if (error) {
        console.error('[public_events] getPublicEventBySlug error:', error)
        return { data: null, error: new Error(error.message) }
    }

    return { data: data as AppEvent | null, error: null }
}

/**
 * Haal een publiek event op via ID.
 */
export async function getPublicEventById(eventId: string): Promise<{
    data: AppEvent | null
    error: Error | null
}> {
    console.log('[public_events] getPublicEventById:', { eventId })

    const { data, error } = await supabase
        .from('public_events')
        .select('id, slug, name, start_time, location_name, status')
        .eq('id', eventId)
        .maybeSingle()

    if (error) {
        console.error('[public_events] getPublicEventById error:', error)
        return { data: null, error: new Error(error.message) }
    }

    return { data: data as AppEvent | null, error: null }
}
