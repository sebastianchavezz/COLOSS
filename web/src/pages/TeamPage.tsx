/**
 * TeamPage
 *
 * Team/member management voor organisaties.
 * Features:
 * - List all members
 * - Add member by email
 * - Change member role
 * - Remove member
 */

import { useEffect, useState, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
    Users, Plus, Trash2, Loader2, Shield, Mail
} from 'lucide-react'
import { clsx } from 'clsx'
import type { Organization } from '../types/supabase'
import {
    listOrgMembers,
    inviteOrgMember,
    updateMemberRole,
    removeOrgMember,
    getCurrentUserRole,
    roleConfig,
    assignableRoles,
    type OrgMember,
    type AppRole
} from '../data/team'

interface LayoutContext {
    org: Organization
}

export function TeamPage() {
    const context = useOutletContext<LayoutContext>()
    const org = context?.org

    const [members, setMembers] = useState<OrgMember[]>([])
    const [currentRole, setCurrentRole] = useState<AppRole | null>(null)
    const [loading, setLoading] = useState(true)
    const [actionLoading, setActionLoading] = useState<string | null>(null)

    // Add member form
    const [showAddForm, setShowAddForm] = useState(false)
    const [newEmail, setNewEmail] = useState('')
    const [newRole, setNewRole] = useState<AppRole>('support')
    const [addError, setAddError] = useState<string | null>(null)

    // Delete confirmation
    const [deleteTarget, setDeleteTarget] = useState<OrgMember | null>(null)

    const isOwner = currentRole === 'owner'

    const fetchData = useCallback(async () => {
        if (!org) return

        setLoading(true)

        const [membersRes, roleRes] = await Promise.all([
            listOrgMembers(org.id),
            getCurrentUserRole(org.id)
        ])

        if (membersRes.data) setMembers(membersRes.data)
        if (roleRes.data) setCurrentRole(roleRes.data)

        setLoading(false)
    }, [org?.id])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    const handleAddMember = async () => {
        if (!org || !newEmail.trim()) return

        setActionLoading('add')
        setAddError(null)

        const { data, error } = await inviteOrgMember(org.id, newEmail.trim(), newRole)

        if (error || data?.error) {
            setAddError(
                data?.message ||
                (data?.error === 'USER_NOT_FOUND' ? 'Geen gebruiker gevonden met dit emailadres' :
                data?.error === 'ALREADY_MEMBER' ? 'Deze gebruiker is al lid' :
                data?.error === 'UNAUTHORIZED' ? 'Geen toestemming' :
                'Er ging iets mis')
            )
        } else {
            setShowAddForm(false)
            setNewEmail('')
            setNewRole('support')
            fetchData()
        }

        setActionLoading(null)
    }

    const handleRoleChange = async (member: OrgMember, newRole: AppRole) => {
        setActionLoading(member.id)

        const { data, error } = await updateMemberRole(member.id, newRole)

        if (!error && data?.success) {
            fetchData()
        }

        setActionLoading(null)
    }

    const handleRemove = async () => {
        if (!deleteTarget) return

        setActionLoading(deleteTarget.id)

        const { data, error } = await removeOrgMember(deleteTarget.id)

        if (!error && data?.success) {
            setDeleteTarget(null)
            fetchData()
        }

        setActionLoading(null)
    }

    // Guard: wait for org context
    if (!org) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
            </div>
        )
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
            </div>
        )
    }

    return (
        <div className="max-w-4xl">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Team</h1>
                    <p className="text-sm text-gray-500">
                        Beheer de leden van je organisatie
                    </p>
                </div>
                {isOwner && (
                    <button
                        onClick={() => setShowAddForm(true)}
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
                    >
                        <Plus className="mr-1.5 h-4 w-4" />
                        Nieuw lid
                    </button>
                )}
            </div>

            {/* Members List */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Lid
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Rol
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Toegevoegd
                            </th>
                            {isOwner && (
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Acties
                                </th>
                            )}
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {members.map((member) => {
                            const config = roleConfig[member.role]

                            return (
                                <tr key={member.id}>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="flex items-center">
                                            <div className="flex-shrink-0 h-10 w-10 bg-gray-100 rounded-full flex items-center justify-center">
                                                <Users className="h-5 w-5 text-gray-400" />
                                            </div>
                                            <div className="ml-4">
                                                <div className="text-sm font-medium text-gray-900">
                                                    {member.email}
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        {isOwner && member.role !== 'owner' ? (
                                            <select
                                                value={member.role}
                                                onChange={(e) => handleRoleChange(member, e.target.value as AppRole)}
                                                disabled={actionLoading === member.id}
                                                className="text-sm rounded-md border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
                                            >
                                                {assignableRoles.map(role => (
                                                    <option key={role} value={role}>
                                                        {roleConfig[role].label}
                                                    </option>
                                                ))}
                                            </select>
                                        ) : (
                                            <span className={clsx(
                                                'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                                                config.bgColor,
                                                config.color
                                            )}>
                                                <Shield className="mr-1 h-3 w-3" />
                                                {config.label}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {new Date(member.created_at).toLocaleDateString('nl-NL')}
                                    </td>
                                    {isOwner && (
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            {member.role !== 'owner' && (
                                                <button
                                                    onClick={() => setDeleteTarget(member)}
                                                    disabled={actionLoading === member.id}
                                                    className="text-red-600 hover:text-red-900 disabled:opacity-50"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            )}
                                        </td>
                                    )}
                                </tr>
                            )
                        })}
                    </tbody>
                </table>

                {members.length === 0 && (
                    <div className="text-center py-12 text-gray-500">
                        Geen teamleden gevonden
                    </div>
                )}
            </div>

            {/* Role Legend */}
            <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                <h3 className="text-sm font-medium text-gray-700 mb-2">Rollen</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                    {Object.entries(roleConfig).map(([role, config]) => (
                        <div key={role} className="flex items-center">
                            <span className={clsx(
                                'inline-block w-3 h-3 rounded-full mr-2',
                                config.bgColor
                            )} />
                            <span className="text-gray-600">{config.label}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Add Member Modal */}
            {showAddForm && (
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                        <h3 className="text-lg font-medium text-gray-900 mb-4">Nieuw teamlid toevoegen</h3>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">
                                    E-mailadres
                                </label>
                                <div className="mt-1 relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                    <input
                                        type="email"
                                        value={newEmail}
                                        onChange={(e) => setNewEmail(e.target.value)}
                                        placeholder="naam@voorbeeld.nl"
                                        className="pl-10 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                    />
                                </div>
                                <p className="mt-1 text-xs text-gray-500">
                                    De gebruiker moet al een account hebben
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700">
                                    Rol
                                </label>
                                <select
                                    value={newRole}
                                    onChange={(e) => setNewRole(e.target.value as AppRole)}
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                >
                                    {assignableRoles.map(role => (
                                        <option key={role} value={role}>
                                            {roleConfig[role].label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {addError && (
                                <div className="p-3 bg-red-50 text-red-700 text-sm rounded-md">
                                    {addError}
                                </div>
                            )}
                        </div>

                        <div className="mt-6 flex justify-end space-x-3">
                            <button
                                onClick={() => {
                                    setShowAddForm(false)
                                    setAddError(null)
                                }}
                                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                            >
                                Annuleren
                            </button>
                            <button
                                onClick={handleAddMember}
                                disabled={actionLoading === 'add' || !newEmail.trim()}
                                className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                            >
                                {actionLoading === 'add' ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    'Toevoegen'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteTarget && (
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                        <h3 className="text-lg font-medium text-gray-900 mb-2">Lid verwijderen?</h3>
                        <p className="text-sm text-gray-500 mb-4">
                            Weet je zeker dat je <strong>{deleteTarget.email}</strong> wilt verwijderen uit het team?
                        </p>
                        <div className="flex justify-end space-x-3">
                            <button
                                onClick={() => setDeleteTarget(null)}
                                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                            >
                                Annuleren
                            </button>
                            <button
                                onClick={handleRemove}
                                disabled={actionLoading === deleteTarget.id}
                                className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
                            >
                                {actionLoading === deleteTarget.id ? 'Verwijderen...' : 'Verwijderen'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
