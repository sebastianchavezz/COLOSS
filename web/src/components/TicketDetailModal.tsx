/**
 * Ticket Detail Modal - Uitgebreide configuratie
 *
 * Features:
 * - Tabs: Basis, Details, i18n, Tijdslots, Teams
 * - Alle nieuwe F005 velden
 * - Real-time opslaan per sectie
 */

import { useEffect, useState } from 'react'
import { X, Loader2, Save, Plus, Trash2, Globe, Clock, Users } from 'lucide-react'
import { clsx } from 'clsx'
import {
    getTicketTypeFull,
    updateTicketExtended,
    upsertTicketI18n,
    upsertTimeSlot,
    deleteTimeSlot,
    upsertTeamConfig,
} from '../data/tickets'

interface TicketDetailModalProps {
    ticketId: string
    onClose: () => void
    onSaved?: () => void
}

type Tab = 'basis' | 'details' | 'i18n' | 'slots' | 'teams'

export function TicketDetailModal({ ticketId, onClose, onSaved }: TicketDetailModalProps) {
    const [activeTab, setActiveTab] = useState<Tab>('basis')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [data, setData] = useState<any>(null)

    // Load full ticket data
    useEffect(() => {
        loadTicketData()
    }, [ticketId])

    async function loadTicketData() {
        setLoading(true)
        setError(null)

        const { data: fullData, error: loadError } = await getTicketTypeFull(ticketId)

        if (loadError) {
            setError(loadError.message)
        } else {
            setData(fullData)
        }

        setLoading(false)
    }

    if (loading) {
        return (
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
                <div className="bg-white rounded-lg shadow-xl p-8">
                    <Loader2 className="h-8 w-8 animate-spin text-indigo-600 mx-auto" />
                    <p className="mt-4 text-sm text-gray-500">Laden...</p>
                </div>
            </div>
        )
    }

    if (error || !data) {
        return (
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
                <div className="bg-white rounded-lg shadow-xl p-8 max-w-md">
                    <p className="text-red-600 font-medium">Fout bij laden</p>
                    <p className="mt-2 text-sm text-gray-600">{error || 'Onbekende fout'}</p>
                    <button
                        onClick={onClose}
                        className="mt-4 px-4 py-2 bg-gray-200 rounded-md text-sm font-medium"
                    >
                        Sluiten
                    </button>
                </div>
            </div>
        )
    }

    const tabs = [
        { id: 'basis' as Tab, label: 'Basis', icon: Save },
        { id: 'details' as Tab, label: 'Details', icon: Save },
        { id: 'i18n' as Tab, label: 'Vertalingen', icon: Globe },
        { id: 'slots' as Tab, label: 'Tijdslots', icon: Clock },
        { id: 'teams' as Tab, label: 'Teams', icon: Users },
    ]

    return (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-medium text-gray-900">{data.ticket_type.name}</h3>
                        <p className="text-sm text-gray-500">Ticket configuratie</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X className="h-6 w-6" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="border-b border-gray-200 px-6">
                    <div className="flex space-x-8">
                        {tabs.map((tab) => {
                            const Icon = tab.icon
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={clsx(
                                        'flex items-center space-x-2 py-4 border-b-2 text-sm font-medium transition-colors',
                                        activeTab === tab.id
                                            ? 'border-indigo-600 text-indigo-600'
                                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                    )}
                                >
                                    <Icon className="h-4 w-4" />
                                    <span>{tab.label}</span>
                                </button>
                            )
                        })}
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-6 py-6">
                    {activeTab === 'basis' && (
                        <BasisTab
                            ticket={data.ticket_type}
                            onSave={async (updates) => {
                                setSaving(true)
                                const { error } = await updateTicketExtended(ticketId, updates)
                                if (error) setError(error.message)
                                else {
                                    await loadTicketData()
                                    onSaved?.()
                                }
                                setSaving(false)
                            }}
                            saving={saving}
                        />
                    )}

                    {activeTab === 'details' && (
                        <DetailsTab
                            ticket={data.ticket_type}
                            onSave={async (updates) => {
                                setSaving(true)
                                const { error } = await updateTicketExtended(ticketId, updates)
                                if (error) setError(error.message)
                                else {
                                    await loadTicketData()
                                    onSaved?.()
                                }
                                setSaving(false)
                            }}
                            saving={saving}
                        />
                    )}

                    {activeTab === 'i18n' && (
                        <I18nTab
                            ticketId={ticketId}
                            i18n={data.i18n}
                            onSave={async (locale, name, description, instructions) => {
                                setSaving(true)
                                const { error } = await upsertTicketI18n(
                                    ticketId,
                                    locale,
                                    name,
                                    description,
                                    instructions
                                )
                                if (error) setError(error.message)
                                else await loadTicketData()
                                setSaving(false)
                            }}
                            saving={saving}
                        />
                    )}

                    {activeTab === 'slots' && (
                        <SlotsTab
                            ticketId={ticketId}
                            timeSlots={data.time_slots}
                            onRefresh={loadTicketData}
                        />
                    )}

                    {activeTab === 'teams' && (
                        <TeamsTab
                            ticketId={ticketId}
                            teamConfig={data.team_config}
                            onSave={async (config) => {
                                setSaving(true)
                                const { error } = await upsertTeamConfig(ticketId, config)
                                if (error) setError(error.message)
                                else await loadTicketData()
                                setSaving(false)
                            }}
                            saving={saving}
                        />
                    )}
                </div>

                {/* Error display */}
                {error && (
                    <div className="px-6 py-3 bg-red-50 border-t border-red-200">
                        <p className="text-sm text-red-800">{error}</p>
                        <button onClick={() => setError(null)} className="text-sm text-red-600 underline">
                            Verbergen
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}

// ============================================================
// BASIS TAB
// ============================================================

interface BasisTabProps {
    ticket: any
    onSave: (updates: any) => void
    saving: boolean
}

function BasisTab({ ticket, onSave, saving }: BasisTabProps) {
    const [name, setName] = useState(ticket.name || '')
    const [description, setDescription] = useState(ticket.description || '')
    const [price, setPrice] = useState(ticket.price?.toString() || '0')
    const [capacity, setCapacity] = useState(ticket.capacity_total?.toString() || '0')

    return (
        <div className="space-y-6">
            <div>
                <label className="block text-sm font-medium text-gray-700">Naam</label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700">Beschrijving</label>
                <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700">Prijs (EUR)</label>
                    <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">Capaciteit</label>
                    <input
                        type="number"
                        min="0"
                        value={capacity}
                        onChange={(e) => setCapacity(e.target.value)}
                        className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                    <p className="mt-1 text-xs text-gray-500">0 = onbeperkt</p>
                </div>
            </div>

            <div className="flex justify-end">
                <button
                    onClick={() =>
                        onSave({
                            name,
                            description,
                            price: parseFloat(price),
                            capacity_total: parseInt(capacity, 10),
                        })
                    }
                    disabled={saving}
                    className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                >
                    {saving ? (
                        <>
                            <Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4" />
                            Opslaan...
                        </>
                    ) : (
                        <>
                            <Save className="-ml-1 mr-2 h-4 w-4" />
                            Opslaan
                        </>
                    )}
                </button>
            </div>
        </div>
    )
}

// ============================================================
// DETAILS TAB
// ============================================================

interface DetailsTabProps {
    ticket: any
    onSave: (updates: any) => void
    saving: boolean
}

function DetailsTab({ ticket, onSave, saving }: DetailsTabProps) {
    const [distanceValue, setDistanceValue] = useState(ticket.distance_value?.toString() || '')
    const [distanceUnit, setDistanceUnit] = useState(ticket.distance_unit || 'km')
    const [imageUrl, setImageUrl] = useState(ticket.image_url || '')
    const [category, setCategory] = useState(ticket.ticket_category || 'individual')
    const [visibility, setVisibility] = useState(ticket.visibility || 'visible')
    const [maxPerParticipant, setMaxPerParticipant] = useState(ticket.max_per_participant?.toString() || '')

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700">Afstand</label>
                    <input
                        type="number"
                        step="0.01"
                        value={distanceValue}
                        onChange={(e) => setDistanceValue(e.target.value)}
                        placeholder="Bijv. 42.195"
                        className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">Eenheid</label>
                    <select
                        value={distanceUnit}
                        onChange={(e) => setDistanceUnit(e.target.value)}
                        className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    >
                        <option value="km">Kilometer (km)</option>
                        <option value="m">Meter (m)</option>
                        <option value="mi">Mijl (mi)</option>
                        <option value="hrs">Uren (hrs)</option>
                    </select>
                </div>
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700">Afbeelding URL</label>
                <input
                    type="url"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="https://..."
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
                {imageUrl && (
                    <img src={imageUrl} alt="Preview" className="mt-2 h-20 w-40 object-cover rounded border" />
                )}
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700">Categorie</label>
                <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                >
                    <option value="individual">Individual</option>
                    <option value="team">Team</option>
                    <option value="relay">Relay</option>
                    <option value="kids">Kids</option>
                    <option value="vip">VIP</option>
                    <option value="spectator">Toeschouwer</option>
                    <option value="other">Anders</option>
                </select>
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700">Zichtbaarheid</label>
                <select
                    value={visibility}
                    onChange={(e) => setVisibility(e.target.value)}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                >
                    <option value="visible">Zichtbaar</option>
                    <option value="hidden">Verborgen</option>
                    <option value="invitation_only">Alleen op uitnodiging</option>
                </select>
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700">Max per deelnemer</label>
                <input
                    type="number"
                    min="1"
                    value={maxPerParticipant}
                    onChange={(e) => setMaxPerParticipant(e.target.value)}
                    placeholder="Leeg = onbeperkt"
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
            </div>

            <div className="flex justify-end">
                <button
                    onClick={() =>
                        onSave({
                            distance_value: distanceValue ? parseFloat(distanceValue) : null,
                            distance_unit: distanceUnit,
                            image_url: imageUrl || null,
                            ticket_category: category,
                            visibility: visibility,
                            max_per_participant: maxPerParticipant ? parseInt(maxPerParticipant, 10) : null,
                        })
                    }
                    disabled={saving}
                    className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                >
                    {saving ? (
                        <>
                            <Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4" />
                            Opslaan...
                        </>
                    ) : (
                        <>
                            <Save className="-ml-1 mr-2 h-4 w-4" />
                            Opslaan
                        </>
                    )}
                </button>
            </div>
        </div>
    )
}

// ============================================================
// I18N TAB
// ============================================================

interface I18nTabProps {
    ticketId: string
    i18n: any
    onSave: (locale: string, name: string, description: string, instructions: string) => void
    saving: boolean
}

function I18nTab({ i18n, onSave, saving }: I18nTabProps) {
    const [locale, setLocale] = useState('nl')
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [instructions, setInstructions] = useState('')

    // Load locale data when changed
    useEffect(() => {
        const data = i18n[locale]
        if (data) {
            setName(data.name || '')
            setDescription(data.description || '')
            setInstructions(data.instructions || '')
        } else {
            setName('')
            setDescription('')
            setInstructions('')
        }
    }, [locale, i18n])

    return (
        <div className="space-y-6">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Taal</label>
                <div className="flex space-x-2">
                    {['nl', 'en', 'fr', 'de'].map((l) => (
                        <button
                            key={l}
                            onClick={() => setLocale(l)}
                            className={clsx(
                                'px-3 py-1 text-sm font-medium rounded-md',
                                locale === l
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            )}
                        >
                            {l.toUpperCase()}
                        </button>
                    ))}
                </div>
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700">Naam</label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700">Beschrijving</label>
                <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700">Instructies</label>
                <textarea
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    rows={4}
                    placeholder="Getoond in bevestigingsmail..."
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
            </div>

            <div className="flex justify-end">
                <button
                    onClick={() => onSave(locale, name, description, instructions)}
                    disabled={saving || !name}
                    className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                >
                    {saving ? (
                        <>
                            <Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4" />
                            Opslaan...
                        </>
                    ) : (
                        <>
                            <Save className="-ml-1 mr-2 h-4 w-4" />
                            Opslaan
                        </>
                    )}
                </button>
            </div>
        </div>
    )
}

// ============================================================
// SLOTS TAB
// ============================================================

interface SlotsTabProps {
    ticketId: string
    timeSlots: any[]
    onRefresh: () => void
}

function SlotsTab({ ticketId, timeSlots, onRefresh }: SlotsTabProps) {
    const [adding, setAdding] = useState(false)
    const [slotTime, setSlotTime] = useState('08:00')
    const [label, setLabel] = useState('')
    const [capacity, setCapacity] = useState('')
    const [saving, setSaving] = useState(false)

    async function handleAddSlot() {
        if (!slotTime) return

        setSaving(true)
        const { error } = await upsertTimeSlot(ticketId, slotTime, {
            label: label || null,
            capacity: capacity ? parseInt(capacity, 10) : null,
        })

        if (!error) {
            setAdding(false)
            setSlotTime('08:00')
            setLabel('')
            setCapacity('')
            onRefresh()
        }

        setSaving(false)
    }

    async function handleDelete(slotId: string) {
        if (!confirm('Tijdslot verwijderen?')) return

        const { error } = await deleteTimeSlot(slotId)
        if (!error) onRefresh()
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500">Starttijden/waves voor dit ticket</p>
                <button
                    onClick={() => setAdding(true)}
                    className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded text-indigo-700 bg-indigo-100 hover:bg-indigo-200"
                >
                    <Plus className="h-3 w-3 mr-1" />
                    Toevoegen
                </button>
            </div>

            {adding && (
                <div className="bg-gray-50 border border-gray-200 rounded-md p-4 space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Tijd</label>
                            <input
                                type="time"
                                value={slotTime}
                                onChange={(e) => setSlotTime(e.target.value)}
                                className="block w-full text-sm border-gray-300 rounded-md"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Label</label>
                            <input
                                type="text"
                                value={label}
                                onChange={(e) => setLabel(e.target.value)}
                                placeholder="Wave A"
                                className="block w-full text-sm border-gray-300 rounded-md"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Capaciteit</label>
                            <input
                                type="number"
                                value={capacity}
                                onChange={(e) => setCapacity(e.target.value)}
                                placeholder="Optioneel"
                                className="block w-full text-sm border-gray-300 rounded-md"
                            />
                        </div>
                    </div>

                    <div className="flex justify-end space-x-2">
                        <button
                            onClick={() => setAdding(false)}
                            className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                        >
                            Annuleren
                        </button>
                        <button
                            onClick={handleAddSlot}
                            disabled={saving}
                            className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
                        >
                            {saving ? 'Opslaan...' : 'Opslaan'}
                        </button>
                    </div>
                </div>
            )}

            {timeSlots.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">Geen tijdslots geconfigureerd</div>
            ) : (
                <div className="space-y-2">
                    {timeSlots.map((slot: any) => (
                        <div
                            key={slot.id}
                            className="flex items-center justify-between p-3 bg-gray-50 rounded-md border border-gray-200"
                        >
                            <div>
                                <div className="font-medium text-sm">
                                    {slot.slot_time} {slot.label && `- ${slot.label}`}
                                </div>
                                {slot.capacity && (
                                    <div className="text-xs text-gray-500">Capaciteit: {slot.capacity}</div>
                                )}
                            </div>
                            <button
                                onClick={() => handleDelete(slot.id)}
                                className="text-red-600 hover:text-red-800"
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

// ============================================================
// TEAMS TAB
// ============================================================

interface TeamsTabProps {
    ticketId: string
    teamConfig: any
    onSave: (config: any) => void
    saving: boolean
}

function TeamsTab({ teamConfig, onSave, saving }: TeamsTabProps) {
    const [teamRequired, setTeamRequired] = useState(teamConfig.team_required || false)
    const [minSize, setMinSize] = useState(teamConfig.team_min_size?.toString() || '2')
    const [maxSize, setMaxSize] = useState(teamConfig.team_max_size?.toString() || '10')
    const [allowIncomplete, setAllowIncomplete] = useState(teamConfig.allow_incomplete_teams || false)
    const [captainRequired, setCaptainRequired] = useState(teamConfig.captain_required ?? true)

    return (
        <div className="space-y-6">
            <div className="flex items-center">
                <input
                    id="teamRequired"
                    type="checkbox"
                    checked={teamRequired}
                    onChange={(e) => setTeamRequired(e.target.checked)}
                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                />
                <label htmlFor="teamRequired" className="ml-2 block text-sm text-gray-900">
                    Team verplicht voor dit ticket
                </label>
            </div>

            {teamRequired && (
                <>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Min. teamgrootte</label>
                            <input
                                type="number"
                                min="1"
                                value={minSize}
                                onChange={(e) => setMinSize(e.target.value)}
                                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700">Max. teamgrootte</label>
                            <input
                                type="number"
                                min="1"
                                value={maxSize}
                                onChange={(e) => setMaxSize(e.target.value)}
                                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            />
                        </div>
                    </div>

                    <div className="flex items-center">
                        <input
                            id="allowIncomplete"
                            type="checkbox"
                            checked={allowIncomplete}
                            onChange={(e) => setAllowIncomplete(e.target.checked)}
                            className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                        />
                        <label htmlFor="allowIncomplete" className="ml-2 block text-sm text-gray-900">
                            Sta incomplete teams toe
                        </label>
                    </div>

                    <div className="flex items-center">
                        <input
                            id="captainRequired"
                            type="checkbox"
                            checked={captainRequired}
                            onChange={(e) => setCaptainRequired(e.target.checked)}
                            className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                        />
                        <label htmlFor="captainRequired" className="ml-2 block text-sm text-gray-900">
                            Teamcaptain verplicht
                        </label>
                    </div>
                </>
            )}

            <div className="flex justify-end">
                <button
                    onClick={() =>
                        onSave({
                            teamRequired,
                            teamMinSize: parseInt(minSize, 10),
                            teamMaxSize: parseInt(maxSize, 10),
                            allowIncompleteTeams: allowIncomplete,
                            captainRequired,
                        })
                    }
                    disabled={saving}
                    className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                >
                    {saving ? (
                        <>
                            <Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4" />
                            Opslaan...
                        </>
                    ) : (
                        <>
                            <Save className="-ml-1 mr-2 h-4 w-4" />
                            Opslaan
                        </>
                    )}
                </button>
            </div>
        </div>
    )
}
