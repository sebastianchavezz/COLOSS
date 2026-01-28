/**
 * F014: Team Management - Data Layer
 */

import { supabase } from '../lib/supabase'

export type AppRole = 'owner' | 'admin' | 'support' | 'finance'

export interface OrgMember {
    id: string
    user_id: string
    email: string
    role: AppRole
    created_at: string
}

/**
 * List all members of an organization
 */
export async function listOrgMembers(orgId: string) {
    const { data, error } = await supabase.rpc('list_org_members', {
        _org_id: orgId,
    })

    if (error) {
        console.error('[team] List error:', error)
        return { data: null, error }
    }

    return { data: data as OrgMember[], error: null }
}

/**
 * Invite a new member by email
 */
export async function inviteOrgMember(orgId: string, email: string, role: AppRole = 'support') {
    const { data, error } = await supabase.rpc('invite_org_member', {
        _org_id: orgId,
        _email: email,
        _role: role,
    })

    if (error) {
        console.error('[team] Invite error:', error)
        return { data: null, error }
    }

    return { data: data as { success?: boolean; error?: string; message?: string; member_id?: string }, error: null }
}

/**
 * Update a member's role
 */
export async function updateMemberRole(memberId: string, newRole: AppRole) {
    const { data, error } = await supabase.rpc('update_member_role', {
        _member_id: memberId,
        _new_role: newRole,
    })

    if (error) {
        console.error('[team] Update role error:', error)
        return { data: null, error }
    }

    return { data: data as { success?: boolean; error?: string }, error: null }
}

/**
 * Remove a member from the organization
 */
export async function removeOrgMember(memberId: string) {
    const { data, error } = await supabase.rpc('remove_org_member', {
        _member_id: memberId,
    })

    if (error) {
        console.error('[team] Remove error:', error)
        return { data: null, error }
    }

    return { data: data as { success?: boolean; error?: string }, error: null }
}

/**
 * Get current user's role in the organization
 */
export async function getCurrentUserRole(orgId: string) {
    const { data, error } = await supabase.rpc('get_current_user_role', {
        _org_id: orgId,
    })

    if (error) {
        console.error('[team] Get role error:', error)
        return { data: null, error }
    }

    return { data: data as AppRole | null, error: null }
}

/**
 * Role display config
 */
export const roleConfig: Record<AppRole, { label: string; color: string; bgColor: string }> = {
    owner: { label: 'Eigenaar', color: 'text-purple-800', bgColor: 'bg-purple-100' },
    admin: { label: 'Admin', color: 'text-blue-800', bgColor: 'bg-blue-100' },
    support: { label: 'Support', color: 'text-green-800', bgColor: 'bg-green-100' },
    finance: { label: 'Finance', color: 'text-yellow-800', bgColor: 'bg-yellow-100' },
}

/**
 * Roles that can be assigned (not owner)
 */
export const assignableRoles: AppRole[] = ['admin', 'support', 'finance']
