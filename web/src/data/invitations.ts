/**
 * F013: Invitation System - Data Layer
 */

import { supabase } from '../lib/supabase'

export interface InvitationCode {
    id: string
    code: string
    label: string | null
    uses_count: number
    max_uses: number | null
    is_active: boolean
    expires_at: string | null
    created_at: string
}

export interface InvitationStats {
    total_codes: number
    total_redemptions: number
    period: {
        from: string
        to: string
    }
    codes: InvitationCode[]
    daily: { date: string; count: number }[]
}

export interface ValidationResult {
    valid: boolean
    error?: string
    code_id?: string
    code?: string
    org?: {
        id: string
        name: string
        slug: string
    }
    event?: {
        id: string
        name: string
        slug: string
    } | null
    uses_remaining?: number | null
    label?: string
}

export interface RedemptionResult {
    success: boolean
    error?: string
    org_id?: string
    event_id?: string
    redirect?: string
}

/**
 * Generate a new invitation code
 */
export async function generateInvitationCode(
    orgId: string,
    eventId?: string | null,
    options?: {
        maxUses?: number
        expiresAt?: string
        label?: string
    }
) {
    const { data, error } = await supabase.rpc('generate_invitation_code', {
        _org_id: orgId,
        _event_id: eventId || null,
        _max_uses: options?.maxUses || null,
        _expires_at: options?.expiresAt || null,
        _label: options?.label || null,
    })

    if (error) {
        console.error('[invitations] Generate error:', error)
        return { data: null, error }
    }

    return { data: data as { success: boolean; code: string; id: string; activation_link: string; error?: string }, error: null }
}

/**
 * Validate an invitation code (public)
 */
export async function validateInvitationCode(code: string) {
    const { data, error } = await supabase.rpc('validate_invitation_code', {
        _code: code,
    })

    if (error) {
        console.error('[invitations] Validate error:', error)
        return { data: null, error }
    }

    return { data: data as ValidationResult, error: null }
}

/**
 * Redeem an invitation code
 */
export async function redeemInvitationCode(code: string, email?: string) {
    const { data, error } = await supabase.rpc('redeem_invitation_code', {
        _code: code,
        _email: email || null,
    })

    if (error) {
        console.error('[invitations] Redeem error:', error)
        return { data: null, error }
    }

    return { data: data as RedemptionResult, error: null }
}

/**
 * Get invitation statistics for an org/event
 */
export async function getInvitationStats(
    orgId: string,
    eventId?: string | null,
    fromDate?: string,
    toDate?: string
) {
    const { data, error } = await supabase.rpc('get_invitation_stats', {
        _org_id: orgId,
        _event_id: eventId || null,
        _from_date: fromDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        _to_date: toDate || new Date().toISOString(),
    })

    if (error) {
        console.error('[invitations] Stats error:', error)
        return { data: null, error }
    }

    return { data: data as InvitationStats, error: null }
}

/**
 * Deactivate an invitation code
 */
export async function deactivateInvitationCode(codeId: string) {
    const { data, error } = await supabase.rpc('deactivate_invitation_code', {
        _code_id: codeId,
    })

    if (error) {
        console.error('[invitations] Deactivate error:', error)
        return { data: null, error }
    }

    return { data: data as { success: boolean; error?: string }, error: null }
}
