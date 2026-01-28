/**
 * EventInvitations Page
 *
 * Invitation management voor organizers.
 * Features:
 * - Generate nieuwe codes
 * - QR code display
 * - Copy activation link
 * - Statistics overzicht
 */

import { useEffect, useState, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import {
    Plus, Copy, Check, Link2, QrCode, Trash2, Loader2,
    Users, TrendingUp, Calendar
} from 'lucide-react'
import { clsx } from 'clsx'
import type { AppEvent, Organization } from '../types/supabase'
import {
    generateInvitationCode,
    getInvitationStats,
    deactivateInvitationCode,
    type InvitationCode,
    type InvitationStats
} from '../data/invitations'

interface EventDetailContext {
    event: AppEvent
    org: Organization
    refreshEvent: () => void
}

export function EventInvitations() {
    const { event, org } = useOutletContext<EventDetailContext>()

    const [stats, setStats] = useState<InvitationStats | null>(null)
    const [loading, setLoading] = useState(true)
    const [generating, setGenerating] = useState(false)
    const [copiedCode, setCopiedCode] = useState<string | null>(null)
    const [selectedCode, setSelectedCode] = useState<InvitationCode | null>(null)

    // Form state
    const [showForm, setShowForm] = useState(false)
    const [formLabel, setFormLabel] = useState('')
    const [formMaxUses, setFormMaxUses] = useState('')
    const [formExpiry, setFormExpiry] = useState('')

    const fetchStats = useCallback(async () => {
        if (!org || !event) return

        setLoading(true)
        const { data, error } = await getInvitationStats(org.id, event.id)

        if (error) {
            console.error('[EventInvitations] Error:', error)
        } else if (data) {
            setStats(data)
            // Select first active code if available
            if (data.codes.length > 0 && !selectedCode) {
                const activeCode = data.codes.find(c => c.is_active)
                if (activeCode) setSelectedCode(activeCode)
            }
        }
        setLoading(false)
    }, [org?.id, event?.id])

    useEffect(() => {
        fetchStats()
    }, [fetchStats])

    const handleGenerate = async () => {
        if (!org || !event) return

        setGenerating(true)
        const { data, error } = await generateInvitationCode(
            org.id,
            event.id,
            {
                label: formLabel || undefined,
                maxUses: formMaxUses ? parseInt(formMaxUses) : undefined,
                expiresAt: formExpiry || undefined,
            }
        )

        if (error || data?.error) {
            console.error('[EventInvitations] Generate error:', error || data?.error)
        } else {
            // Reset form
            setShowForm(false)
            setFormLabel('')
            setFormMaxUses('')
            setFormExpiry('')
            // Refresh
            await fetchStats()
        }
        setGenerating(false)
    }

    const handleDeactivate = async (codeId: string) => {
        const { error } = await deactivateInvitationCode(codeId)
        if (!error) {
            if (selectedCode?.id === codeId) setSelectedCode(null)
            fetchStats()
        }
    }

    const handleCopy = async (code: string) => {
        const link = `${window.location.origin}/invite/${code}`
        await navigator.clipboard.writeText(link)
        setCopiedCode(code)
        setTimeout(() => setCopiedCode(null), 2000)
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
            </div>
        )
    }

    const activeCodes = stats?.codes.filter(c => c.is_active) || []

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-medium text-gray-900">Uitnodigingen</h2>
                    <p className="text-sm text-gray-500">
                        Nodig deelnemers uit via een link, QR code, of activatiecode.
                    </p>
                </div>
                <button
                    onClick={() => setShowForm(true)}
                    className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
                >
                    <Plus className="mr-1.5 h-4 w-4" />
                    Nieuwe code
                </button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center">
                        <div className="p-2 bg-indigo-100 rounded-lg">
                            <Link2 className="h-5 w-5 text-indigo-600" />
                        </div>
                        <div className="ml-3">
                            <p className="text-sm text-gray-500">Actieve codes</p>
                            <p className="text-2xl font-semibold text-gray-900">{activeCodes.length}</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center">
                        <div className="p-2 bg-green-100 rounded-lg">
                            <Users className="h-5 w-5 text-green-600" />
                        </div>
                        <div className="ml-3">
                            <p className="text-sm text-gray-500">Nieuwe leden (7 dagen)</p>
                            <p className="text-2xl font-semibold text-gray-900">{stats?.total_redemptions || 0}</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center">
                        <div className="p-2 bg-yellow-100 rounded-lg">
                            <TrendingUp className="h-5 w-5 text-yellow-600" />
                        </div>
                        <div className="ml-3">
                            <p className="text-sm text-gray-500">Totaal gebruikt</p>
                            <p className="text-2xl font-semibold text-gray-900">
                                {stats?.codes.reduce((sum, c) => sum + c.uses_count, 0) || 0}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* QR Code Display */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h3 className="text-sm font-medium text-gray-700 mb-4">QR Code</h3>

                    {selectedCode ? (
                        <div className="text-center">
                            <div className="inline-block p-4 bg-white border border-gray-200 rounded-lg">
                                <QRCodeSVG
                                    value={`${window.location.origin}/invite/${selectedCode.code}`}
                                    size={200}
                                    level="M"
                                />
                            </div>
                            <p className="mt-4 text-sm text-gray-500">Activatiecode:</p>
                            <p className="text-xl font-mono font-bold text-gray-900">{selectedCode.code}</p>
                            {selectedCode.label && (
                                <p className="mt-1 text-sm text-gray-500">{selectedCode.label}</p>
                            )}
                            <button
                                onClick={() => handleCopy(selectedCode.code)}
                                className="mt-4 inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                            >
                                {copiedCode === selectedCode.code ? (
                                    <>
                                        <Check className="mr-1.5 h-4 w-4 text-green-500" />
                                        Gekopieerd!
                                    </>
                                ) : (
                                    <>
                                        <Link2 className="mr-1.5 h-4 w-4" />
                                        Activatielink kopiëren
                                    </>
                                )}
                            </button>
                        </div>
                    ) : (
                        <div className="text-center py-8 text-gray-500">
                            <QrCode className="mx-auto h-12 w-12 text-gray-300" />
                            <p className="mt-2">Geen actieve code geselecteerd</p>
                            <button
                                onClick={() => setShowForm(true)}
                                className="mt-2 text-indigo-600 hover:text-indigo-500 text-sm"
                            >
                                Maak een nieuwe code
                            </button>
                        </div>
                    )}
                </div>

                {/* Codes List */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h3 className="text-sm font-medium text-gray-700 mb-4">Actieve codes</h3>

                    {activeCodes.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                            <p>Nog geen uitnodigingscodes</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {activeCodes.map((code) => (
                                <div
                                    key={code.id}
                                    onClick={() => setSelectedCode(code)}
                                    className={clsx(
                                        'p-3 rounded-lg border cursor-pointer transition-colors',
                                        selectedCode?.id === code.id
                                            ? 'border-indigo-500 bg-indigo-50'
                                            : 'border-gray-200 hover:bg-gray-50'
                                    )}
                                >
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="font-mono font-medium text-gray-900">{code.code}</p>
                                            {code.label && (
                                                <p className="text-sm text-gray-500">{code.label}</p>
                                            )}
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <span className="text-sm text-gray-500">
                                                {code.uses_count}{code.max_uses ? `/${code.max_uses}` : ''} gebruikt
                                            </span>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    handleCopy(code.code)
                                                }}
                                                className="p-1 text-gray-400 hover:text-gray-600"
                                                title="Kopieer link"
                                            >
                                                {copiedCode === code.code ? (
                                                    <Check className="h-4 w-4 text-green-500" />
                                                ) : (
                                                    <Copy className="h-4 w-4" />
                                                )}
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    handleDeactivate(code.id)
                                                }}
                                                className="p-1 text-gray-400 hover:text-red-600"
                                                title="Deactiveren"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>
                                    {code.expires_at && (
                                        <p className="mt-1 text-xs text-gray-400 flex items-center">
                                            <Calendar className="mr-1 h-3 w-3" />
                                            Verloopt {new Date(code.expires_at).toLocaleDateString('nl-NL')}
                                        </p>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Daily Chart */}
            {stats && stats.daily.length > 0 && (
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h3 className="text-sm font-medium text-gray-700 mb-4">Nieuwe leden per dag</h3>
                    <div className="flex items-end space-x-2 h-32">
                        {stats.daily.map((day, i) => {
                            const maxCount = Math.max(...stats.daily.map(d => d.count), 1)
                            const height = (day.count / maxCount) * 100
                            return (
                                <div key={i} className="flex-1 flex flex-col items-center">
                                    <div
                                        className="w-full bg-indigo-500 rounded-t"
                                        style={{ height: `${Math.max(height, 4)}%` }}
                                        title={`${day.count} nieuwe leden`}
                                    />
                                    <span className="text-xs text-gray-400 mt-1">
                                        {new Date(day.date).toLocaleDateString('nl-NL', { day: 'numeric' })}
                                    </span>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {/* Generate Form Modal */}
            {showForm && (
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                        <h3 className="text-lg font-medium text-gray-900 mb-4">Nieuwe uitnodigingscode</h3>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">
                                    Label (optioneel)
                                </label>
                                <input
                                    type="text"
                                    value={formLabel}
                                    onChange={(e) => setFormLabel(e.target.value)}
                                    placeholder="bijv. Summer Campaign"
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700">
                                    Max. aantal keer te gebruiken (optioneel)
                                </label>
                                <input
                                    type="number"
                                    value={formMaxUses}
                                    onChange={(e) => setFormMaxUses(e.target.value)}
                                    placeholder="Onbeperkt"
                                    min="1"
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700">
                                    Vervaldatum (optioneel)
                                </label>
                                <input
                                    type="datetime-local"
                                    value={formExpiry}
                                    onChange={(e) => setFormExpiry(e.target.value)}
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                                />
                            </div>
                        </div>

                        <div className="mt-6 flex justify-end space-x-3">
                            <button
                                onClick={() => setShowForm(false)}
                                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                            >
                                Annuleren
                            </button>
                            <button
                                onClick={handleGenerate}
                                disabled={generating}
                                className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                            >
                                {generating ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    'Genereer code'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
