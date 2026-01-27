import { useEffect, useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { clsx } from 'clsx'

// --- Types ---

type LocaleString = { nl?: string; en?: string; fr?: string; de?: string }

type PaymentSettings = {
    payment_profile_id: string | null
    invoice_prefix: string
    vat_number: string
    vat_rate: number
}

type TransferSettings = {
    transfers_enabled: boolean
    transfer_expiry_hours: number
    cancel_roles: string[]
}

type CommunicationSettings = {
    // Legacy keys (still supported)
    reply_to_email?: string
    default_locale?: 'nl' | 'en' | 'fr'
    confirmation_message?: string

    // NEW: Sprint Communication - Nested structure
    sender?: {
        default_from_name: string
        default_from_email: string
        default_reply_to: string | null
    }
    provider?: {
        resend: {
            enabled: boolean
            api_key_ref: string
        }
    }
    bulk?: {
        batch_size: number
        delay_between_batches_ms: number
        max_recipients_per_campaign: number
    }
    compliance?: {
        unsubscribe_enabled: boolean
        bounce_threshold: number
        complaint_threshold: number
    }
    rate_limits?: {
        emails_per_minute: number
        emails_per_hour: number
    }
    retry?: {
        max_attempts: number
        initial_delay_ms: number
        backoff_multiplier: number
    }
}

type GovernanceSettings = {
    is_private: boolean
}

type LegalSettings = {
    mode: 'none' | 'pdf' | 'url' | 'inline_text'
    pdf_file_id: string | null
    url: string | null
    inline_text: LocaleString | null
}

// NEW: Sprint 2 types
type BasicInfoSettings = {
    name: LocaleString
    description: LocaleString
    contact_email: string | null
    website: string | null
}

type ContentCommunicationSettings = {
    checkout_message: LocaleString
    email_subject: LocaleString
    email_body: LocaleString
    extra_recipients: string[]
}

// NEW: Sprint 3 types
type BrandingSettings = {
    hero_image_id: string | null
    logo_image_id: string | null
    primary_color: string
}

// NEW: Sprint 4 types
type WaitlistSettings = {
    enabled: boolean
}

type InterestListSettings = {
    enabled: boolean
}

// NEW: Sprint 6 types
type TicketPdfSettings = {
    available_from: string | null
    banner_image_id: string | null
}

type TicketPrivacySettings = {
    show: {
        name: boolean
        email: boolean
        birthdate: boolean
        gender: boolean
        nationality: boolean
        address: boolean
        phone: boolean
        emergency_contact: boolean
    }
}

type EffectiveSettings = {
    payments: PaymentSettings
    transfers: TransferSettings
    communication: CommunicationSettings
    governance: GovernanceSettings
    legal: LegalSettings
    basic_info: BasicInfoSettings
    content_communication: ContentCommunicationSettings
    branding: BrandingSettings
    waitlist: WaitlistSettings
    interest_list: InterestListSettings
    ticket_pdf: TicketPdfSettings
    ticket_privacy: TicketPrivacySettings
}

type Permissions = {
    role: string
    can_edit_payments: boolean
    can_edit_transfers: boolean
    can_edit_communication: boolean
    can_edit_governance: boolean
    can_edit_legal: boolean
    can_edit_basic_info: boolean
    can_edit_content_communication: boolean
    can_edit_branding: boolean
    can_edit_waitlist: boolean
    can_edit_interest_list: boolean
    can_edit_ticket_pdf: boolean
    can_edit_ticket_privacy: boolean
}

// --- Toast Component ---

type ToastType = 'success' | 'error' | 'info'

function Toast({ message, type, onClose }: { message: string; type: ToastType; onClose: () => void }) {
    useEffect(() => {
        const timer = setTimeout(onClose, 4000)
        return () => clearTimeout(timer)
    }, [onClose])

    const colors = {
        success: 'bg-green-50 border-green-400 text-green-700',
        error: 'bg-red-50 border-red-400 text-red-700',
        info: 'bg-blue-50 border-blue-400 text-blue-700'
    }

    return (
        <div className={clsx('fixed bottom-4 right-4 z-50 border-l-4 p-4 rounded shadow-lg max-w-md', colors[type])}>
            <div className="flex justify-between items-start">
                <span>{message}</span>
                <button onClick={onClose} className="ml-4 text-lg leading-none">&times;</button>
            </div>
        </div>
    )
}

// --- Helper ---

function normalizeConfig(data: any): EffectiveSettings | null {
    if (!data) return null

    // Check if it has the core required domains
    const requiredDomains = ['payments', 'transfers', 'communication', 'governance', 'legal']
    const hasRequiredDomains = requiredDomains.every(domain => data[domain] !== undefined)

    if (hasRequiredDomains) {
        return data as EffectiveSettings
    }

    // Try nested structures
    if (Array.isArray(data) && data.length > 0) return normalizeConfig(data[0])
    if (data.settings) return normalizeConfig(data.settings)

    console.warn('[Settings] Unknown data shape:', data)
    return null
}

// --- Debug Panel ---

function DebugPanel({ data, permissions, eventId }: { data: any; permissions: Permissions | null; eventId: string }) {
    return (
        <details className="mt-8 p-4 bg-gray-100 rounded text-xs font-mono border border-gray-300">
            <summary className="cursor-pointer font-bold">Debug Info</summary>
            <div className="mt-2 space-y-1">
                <div>EventID: {eventId}</div>
                <div>Role: {permissions?.role || 'unknown'}</div>
                <div>Permissions: {JSON.stringify(permissions)}</div>
                <pre className="mt-2 overflow-auto max-h-48">{JSON.stringify(data, null, 2)}</pre>
            </div>
        </details>
    )
}

// --- Tab Button ---

function TabButton({ active, onClick, children, disabled }: { active: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={clsx(
                "py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap transition-colors",
                active
                    ? "border-indigo-500 text-indigo-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300",
                disabled && "opacity-50 cursor-not-allowed"
            )}
        >
            {children}
        </button>
    )
}

// --- Locale Tabs Component ---

function LocaleTabs({ activeLocale, onChange }: { activeLocale: string; onChange: (locale: string) => void }) {
    const locales = [
        { code: 'nl', label: 'Nederlands' },
        { code: 'en', label: 'English' },
        { code: 'fr', label: 'Français' }
    ]

    return (
        <div className="flex space-x-2 mb-4">
            {locales.map(l => (
                <button
                    key={l.code}
                    type="button"
                    onClick={() => onChange(l.code)}
                    className={clsx(
                        "px-3 py-1 text-sm rounded-md",
                        activeLocale === l.code
                            ? "bg-indigo-100 text-indigo-700"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    )}
                >
                    {l.label}
                </button>
            ))}
        </div>
    )
}

// --- Main Component ---

type TabName = 'governance' | 'content' | 'branding' | 'waitlist' | 'tickets' | 'payments' | 'transfers' | 'communication'

export function Settings({ eventId }: { eventId: string }) {
    const [searchParams] = useSearchParams()
    const showDebug = searchParams.get('debug') === '1'

    const [activeTab, setActiveTab] = useState<TabName>('governance')
    const [activeLocale, setActiveLocale] = useState('nl')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [config, setConfig] = useState<EffectiveSettings | null>(null)
    const [permissions, setPermissions] = useState<Permissions | null>(null)
    const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null)

    // Forms
    const paymentsForm = useForm<PaymentSettings>()
    const transfersForm = useForm<TransferSettings>()
    const commsForm = useForm<CommunicationSettings>()
    const governanceForm = useForm<GovernanceSettings>()
    const legalForm = useForm<LegalSettings>()
    const basicInfoForm = useForm<BasicInfoSettings>()
    const contentCommForm = useForm<ContentCommunicationSettings>()
    const brandingForm = useForm<BrandingSettings>()
    const waitlistForm = useForm<WaitlistSettings>()
    const interestListForm = useForm<InterestListSettings>()
    const ticketPdfForm = useForm<TicketPdfSettings>()
    const ticketPrivacyForm = useForm<TicketPrivacySettings>()

    const legalMode = legalForm.watch('mode')

    const fetchConfig = useCallback(async () => {
        if (!eventId) return
        setLoading(true)
        try {
            const [configRes, permRes] = await Promise.all([
                supabase.rpc('get_event_config', { _event_id: eventId }),
                supabase.rpc('get_event_config_permissions', { _event_id: eventId })
            ])

            if (configRes.error) throw configRes.error
            if (permRes.error) throw permRes.error

            const normalized = normalizeConfig(configRes.data)
            if (!normalized) throw new Error('Invalid config format')

            setConfig(normalized)
            setPermissions(permRes.data as Permissions)

            paymentsForm.reset(normalized.payments)
            transfersForm.reset(normalized.transfers)
            commsForm.reset(normalized.communication)
            governanceForm.reset(normalized.governance)
            legalForm.reset(normalized.legal)
            basicInfoForm.reset(normalized.basic_info)
            contentCommForm.reset(normalized.content_communication)
            brandingForm.reset(normalized.branding)
            waitlistForm.reset(normalized.waitlist)
            interestListForm.reset(normalized.interest_list)
            ticketPdfForm.reset(normalized.ticket_pdf)
            ticketPrivacyForm.reset(normalized.ticket_privacy)

        } catch (err: any) {
            console.error('[Settings] Fetch error:', err)
            setToast({ message: err.message || 'Failed to load settings', type: 'error' })
        } finally {
            setLoading(false)
        }
    }, [eventId])

    useEffect(() => {
        fetchConfig()
    }, [fetchConfig])

    const handleSave = async (domain: string, patch: any) => {
        setSaving(true)
        try {
            if (domain === 'payments' && patch.vat_rate !== undefined) {
                patch.vat_rate = Number(patch.vat_rate)
            }
            if (domain === 'transfers' && patch.transfer_expiry_hours !== undefined) {
                patch.transfer_expiry_hours = Number(patch.transfer_expiry_hours)
            }
            // Filter out empty strings from extra_recipients
            if (domain === 'content_communication' && patch.extra_recipients) {
                patch.extra_recipients = patch.extra_recipients.filter((email: string) => email && email.trim() !== '')
            }

            const { data, error } = await supabase.rpc('set_event_config', {
                _event_id: eventId,
                _domain: domain,
                _patch: patch
            })

            if (error) throw error

            const normalized = normalizeConfig(data)
            if (normalized) {
                setConfig(normalized)
                if (domain === 'payments') paymentsForm.reset(normalized.payments)
                if (domain === 'transfers') transfersForm.reset(normalized.transfers)
                if (domain === 'communication') commsForm.reset(normalized.communication)
                if (domain === 'governance') governanceForm.reset(normalized.governance)
                if (domain === 'legal') legalForm.reset(normalized.legal)
                if (domain === 'basic_info') basicInfoForm.reset(normalized.basic_info)
                if (domain === 'content_communication') contentCommForm.reset(normalized.content_communication)
                if (domain === 'branding') brandingForm.reset(normalized.branding)
                if (domain === 'waitlist') waitlistForm.reset(normalized.waitlist)
                if (domain === 'interest_list') interestListForm.reset(normalized.interest_list)
                if (domain === 'ticket_pdf') ticketPdfForm.reset(normalized.ticket_pdf)
                if (domain === 'ticket_privacy') ticketPrivacyForm.reset(normalized.ticket_privacy)
            }

            setToast({ message: `${domain.replace('_', ' ')} settings saved`, type: 'success' })

        } catch (err: any) {
            console.error('[Settings] Save error:', err)
            setToast({ message: err.message || 'Failed to save', type: 'error' })
        } finally {
            setSaving(false)
        }
    }

    const handleReset = async (domain: string) => {
        if (!confirm(`Reset ${domain.replace('_', ' ')} settings to defaults?`)) return

        setSaving(true)
        try {
            const { data, error } = await supabase.rpc('reset_event_config_domain', {
                _event_id: eventId,
                _domain: domain
            })

            if (error) throw error

            const normalized = normalizeConfig(data)
            if (normalized) {
                setConfig(normalized)
                if (domain === 'payments') paymentsForm.reset(normalized.payments)
                if (domain === 'transfers') transfersForm.reset(normalized.transfers)
                if (domain === 'communication') commsForm.reset(normalized.communication)
                if (domain === 'governance') governanceForm.reset(normalized.governance)
                if (domain === 'legal') legalForm.reset(normalized.legal)
                if (domain === 'basic_info') basicInfoForm.reset(normalized.basic_info)
                if (domain === 'content_communication') contentCommForm.reset(normalized.content_communication)
                if (domain === 'branding') brandingForm.reset(normalized.branding)
                if (domain === 'waitlist') waitlistForm.reset(normalized.waitlist)
                if (domain === 'interest_list') interestListForm.reset(normalized.interest_list)
                if (domain === 'ticket_pdf') ticketPdfForm.reset(normalized.ticket_pdf)
                if (domain === 'ticket_privacy') ticketPrivacyForm.reset(normalized.ticket_privacy)
            }

            setToast({ message: `${domain.replace('_', ' ')} settings reset`, type: 'info' })

        } catch (err: any) {
            console.error('[Settings] Reset error:', err)
            setToast({ message: err.message || 'Failed to reset', type: 'error' })
        } finally {
            setSaving(false)
        }
    }

    const canEditPayments = permissions?.can_edit_payments ?? false
    const canEditTransfers = permissions?.can_edit_transfers ?? false
    const canEditCommunication = permissions?.can_edit_communication ?? false
    const canEditGovernance = permissions?.can_edit_governance ?? false
    const canEditLegal = permissions?.can_edit_legal ?? false
    const canEditBasicInfo = permissions?.can_edit_basic_info ?? false
    const canEditContentComm = permissions?.can_edit_content_communication ?? false
    const canEditBranding = permissions?.can_edit_branding ?? false
    const canEditWaitlist = permissions?.can_edit_waitlist ?? false
    const canEditInterestList = permissions?.can_edit_interest_list ?? false
    const canEditTicketPdf = permissions?.can_edit_ticket_pdf ?? false
    const canEditTicketPrivacy = permissions?.can_edit_ticket_privacy ?? false

    if (loading) {
        return (
            <div className="p-6 flex items-center justify-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                <span className="ml-2 text-gray-500">Loading settings...</span>
            </div>
        )
    }

    if (!config) {
        return (
            <div className="p-6 text-red-600">
                Failed to load configuration. Please refresh the page.
            </div>
        )
    }

    return (
        <div className="bg-white shadow sm:rounded-lg">
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

            {/* Tabs */}
            <div className="border-b border-gray-200 px-6">
                <nav className="-mb-px flex space-x-8 overflow-x-auto" aria-label="Settings tabs">
                    <TabButton active={activeTab === 'governance'} onClick={() => setActiveTab('governance')}>
                        Governance
                    </TabButton>
                    <TabButton active={activeTab === 'content'} onClick={() => setActiveTab('content')}>
                        Content
                    </TabButton>
                    <TabButton active={activeTab === 'branding'} onClick={() => setActiveTab('branding')}>
                        Branding
                    </TabButton>
                    <TabButton active={activeTab === 'waitlist'} onClick={() => setActiveTab('waitlist')}>
                        Wachtlijst & Interesse
                    </TabButton>
                    <TabButton active={activeTab === 'tickets'} onClick={() => setActiveTab('tickets')}>
                        Tickets & Privacy
                    </TabButton>
                    <TabButton active={activeTab === 'payments'} onClick={() => setActiveTab('payments')}>
                        Payments
                    </TabButton>
                    <TabButton active={activeTab === 'transfers'} onClick={() => setActiveTab('transfers')}>
                        Transfers
                    </TabButton>
                    <TabButton active={activeTab === 'communication'} onClick={() => setActiveTab('communication')}>
                        Communication
                    </TabButton>
                </nav>
            </div>

            <div className="p-6">
                {/* --- GOVERNANCE TAB --- */}
                {activeTab === 'governance' && (
                    <div className="space-y-8">
                        <form onSubmit={governanceForm.handleSubmit(d => handleSave('governance', d))} className="space-y-6">
                            <div>
                                <h3 className="text-lg font-medium text-gray-900 mb-4">Event Visibility</h3>
                                <div className="flex items-start">
                                    <div className="flex items-center h-5">
                                        <input
                                            id="is_private"
                                            type="checkbox"
                                            {...governanceForm.register('is_private')}
                                            disabled={!canEditGovernance || saving}
                                            className="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 disabled:bg-gray-100"
                                        />
                                    </div>
                                    <div className="ml-3 text-sm">
                                        <label htmlFor="is_private" className="font-medium text-gray-700">Besloten evenement</label>
                                        <p className="text-gray-500">Event is niet zichtbaar in publieke overzichten, maar wel bereikbaar via directe link.</p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-between items-center">
                                <button type="button" onClick={() => handleReset('governance')} disabled={!canEditGovernance || saving} className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50">
                                    Reset to defaults
                                </button>
                                {canEditGovernance && (
                                    <button type="submit" disabled={saving} className="px-4 py-2 bg-indigo-600 text-white rounded-md disabled:opacity-50">
                                        {saving ? 'Saving...' : 'Save Visibility'}
                                    </button>
                                )}
                            </div>
                        </form>

                        <hr className="border-gray-200" />

                        <form onSubmit={legalForm.handleSubmit(d => handleSave('legal', d))} className="space-y-6">
                            <div>
                                <h3 className="text-lg font-medium text-gray-900 mb-4">Voorwaarden (Terms)</h3>
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Type voorwaarden</label>
                                        <select
                                            {...legalForm.register('mode')}
                                            disabled={!canEditLegal || saving}
                                            className="block w-full py-2 px-3 border border-gray-300 rounded-md shadow-sm disabled:bg-gray-100"
                                        >
                                            <option value="none">Geen voorwaarden</option>
                                            <option value="pdf">PDF bestand</option>
                                            <option value="url">Link naar externe pagina</option>
                                            <option value="inline_text">Tekst invoeren</option>
                                        </select>
                                    </div>

                                    {legalMode === 'pdf' && (
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700">PDF File ID</label>
                                            <input type="text" {...legalForm.register('pdf_file_id')} disabled={!canEditLegal || saving} placeholder="UUID" className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100" />
                                        </div>
                                    )}

                                    {legalMode === 'url' && (
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700">URL</label>
                                            <input type="url" {...legalForm.register('url')} disabled={!canEditLegal || saving} placeholder="https://..." className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100" />
                                        </div>
                                    )}

                                    {legalMode === 'inline_text' && (
                                        <div className="space-y-4">
                                            <LocaleTabs activeLocale={activeLocale} onChange={setActiveLocale} />
                                            <textarea
                                                rows={4}
                                                {...legalForm.register(`inline_text.${activeLocale}` as any)}
                                                disabled={!canEditLegal || saving}
                                                className="block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                                placeholder={`Voorwaarden (${activeLocale.toUpperCase()})`}
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex justify-between items-center">
                                <button type="button" onClick={() => handleReset('legal')} disabled={!canEditLegal || saving} className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50">
                                    Reset to defaults
                                </button>
                                {canEditLegal && (
                                    <button type="submit" disabled={saving} className="px-4 py-2 bg-indigo-600 text-white rounded-md disabled:opacity-50">
                                        {saving ? 'Saving...' : 'Save Terms'}
                                    </button>
                                )}
                            </div>
                        </form>
                    </div>
                )}

                {/* --- CONTENT TAB (NEW SPRINT 2) --- */}
                {activeTab === 'content' && (
                    <div className="space-y-8">
                        {/* Basic Info Section */}
                        <form onSubmit={basicInfoForm.handleSubmit(d => handleSave('basic_info', d))} className="space-y-6">
                            <div>
                                <h3 className="text-lg font-medium text-gray-900 mb-4">Event Informatie</h3>
                                <LocaleTabs activeLocale={activeLocale} onChange={setActiveLocale} />

                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Naam ({activeLocale.toUpperCase()})</label>
                                        <input
                                            type="text"
                                            {...basicInfoForm.register(`name.${activeLocale}` as any)}
                                            disabled={!canEditBasicInfo || saving}
                                            className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Omschrijving ({activeLocale.toUpperCase()})</label>
                                        <textarea
                                            rows={4}
                                            {...basicInfoForm.register(`description.${activeLocale}` as any)}
                                            disabled={!canEditBasicInfo || saving}
                                            className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700">Contact E-mail</label>
                                            <input
                                                type="email"
                                                {...basicInfoForm.register('contact_email')}
                                                disabled={!canEditBasicInfo || saving}
                                                className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700">Website</label>
                                            <input
                                                type="url"
                                                {...basicInfoForm.register('website')}
                                                disabled={!canEditBasicInfo || saving}
                                                className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                                placeholder="https://..."
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-between items-center">
                                <button type="button" onClick={() => handleReset('basic_info')} disabled={!canEditBasicInfo || saving} className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50">
                                    Reset to defaults
                                </button>
                                {canEditBasicInfo && (
                                    <button type="submit" disabled={saving} className="px-4 py-2 bg-indigo-600 text-white rounded-md disabled:opacity-50">
                                        {saving ? 'Saving...' : 'Save Info'}
                                    </button>
                                )}
                            </div>
                        </form>

                        <hr className="border-gray-200" />

                        {/* Content Communication Section */}
                        <form onSubmit={contentCommForm.handleSubmit(d => handleSave('content_communication', d))} className="space-y-6">
                            <div>
                                <h3 className="text-lg font-medium text-gray-900 mb-4">Checkout & E-mail Content</h3>
                                <LocaleTabs activeLocale={activeLocale} onChange={setActiveLocale} />

                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Checkout Bevestigingsbericht ({activeLocale.toUpperCase()})</label>
                                        <textarea
                                            rows={3}
                                            {...contentCommForm.register(`checkout_message.${activeLocale}` as any)}
                                            disabled={!canEditContentComm || saving}
                                            className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                            placeholder="Tekst die na checkout wordt getoond"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">E-mail Onderwerp ({activeLocale.toUpperCase()})</label>
                                        <input
                                            type="text"
                                            {...contentCommForm.register(`email_subject.${activeLocale}` as any)}
                                            disabled={!canEditContentComm || saving}
                                            className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">E-mail Body ({activeLocale.toUpperCase()})</label>
                                        <textarea
                                            rows={4}
                                            {...contentCommForm.register(`email_body.${activeLocale}` as any)}
                                            disabled={!canEditContentComm || saving}
                                            className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                            placeholder="Placeholders: {{first_name}}, {{event_name}}, etc."
                                        />
                                        <p className="mt-1 text-xs text-gray-500">Placeholders worden niet gevalideerd. Gebruik op eigen risico.</p>
                                    </div>
                                </div>
                            </div>

                            <hr className="border-gray-200" />

                            <div>
                                <h4 className="text-md font-medium text-gray-900 mb-2">Extra Notificatie Ontvangers</h4>
                                <p className="text-sm text-gray-500 mb-4">Maximaal 5 e-mailadressen die een kopie ontvangen van bevestigingsmails.</p>
                                <div className="space-y-2">
                                    {[0, 1, 2, 3, 4].map(i => (
                                        <input
                                            key={i}
                                            type="email"
                                            {...contentCommForm.register(`extra_recipients.${i}` as any)}
                                            disabled={!canEditContentComm || saving}
                                            className="block w-full border-gray-300 rounded-md disabled:bg-gray-100 text-sm"
                                            placeholder={`E-mail ${i + 1} (optioneel)`}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div className="flex justify-between items-center">
                                <button type="button" onClick={() => handleReset('content_communication')} disabled={!canEditContentComm || saving} className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50">
                                    Reset to defaults
                                </button>
                                {canEditContentComm && (
                                    <button type="submit" disabled={saving} className="px-4 py-2 bg-indigo-600 text-white rounded-md disabled:opacity-50">
                                        {saving ? 'Saving...' : 'Save Content'}
                                    </button>
                                )}
                            </div>
                        </form>
                    </div>
                )}

                {/* --- PAYMENTS TAB --- */}
                {activeTab === 'payments' && (
                    <form onSubmit={paymentsForm.handleSubmit(d => handleSave('payments', d))} className="space-y-6">
                        <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-6">
                            <div className="sm:col-span-4">
                                <label className="block text-sm font-medium text-gray-700">Payment Profile ID</label>
                                <input type="text" {...paymentsForm.register('payment_profile_id')} disabled={!canEditPayments || saving} className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100" placeholder="UUID (optional)" />
                            </div>
                            <div className="sm:col-span-3">
                                <label className="block text-sm font-medium text-gray-700">Invoice Prefix</label>
                                <input type="text" {...paymentsForm.register('invoice_prefix')} disabled={!canEditPayments || saving} className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100" />
                            </div>
                            <div className="sm:col-span-3">
                                <label className="block text-sm font-medium text-gray-700">VAT Number</label>
                                <input type="text" {...paymentsForm.register('vat_number')} disabled={!canEditPayments || saving} className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100" />
                            </div>
                            <div className="sm:col-span-2">
                                <label className="block text-sm font-medium text-gray-700">VAT Rate (%)</label>
                                <input type="number" step="0.1" {...paymentsForm.register('vat_rate')} disabled={!canEditPayments || saving} className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100" />
                            </div>
                        </div>
                        <div className="flex justify-between items-center">
                            <button type="button" onClick={() => handleReset('payments')} disabled={!canEditPayments || saving} className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50">
                                Reset to defaults
                            </button>
                            {canEditPayments && (
                                <button type="submit" disabled={saving} className="px-4 py-2 bg-indigo-600 text-white rounded-md disabled:opacity-50">
                                    {saving ? 'Saving...' : 'Save Payments'}
                                </button>
                            )}
                        </div>
                    </form>
                )}

                {/* --- TRANSFERS TAB --- */}
                {activeTab === 'transfers' && (
                    <form onSubmit={transfersForm.handleSubmit(d => handleSave('transfers', d))} className="space-y-6">
                        <div className="space-y-4">
                            <div className="flex items-start">
                                <input id="transfers_enabled" type="checkbox" {...transfersForm.register('transfers_enabled')} disabled={!canEditTransfers || saving} className="h-4 w-4 text-indigo-600 border-gray-300 rounded" />
                                <div className="ml-3 text-sm">
                                    <label htmlFor="transfers_enabled" className="font-medium text-gray-700">Enable Transfers</label>
                                    <p className="text-gray-500">Allow ticket transfers between participants.</p>
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Transfer Expiry (Hours)</label>
                                <input type="number" {...transfersForm.register('transfer_expiry_hours')} disabled={!canEditTransfers || saving} className="mt-1 block w-32 border-gray-300 rounded-md disabled:bg-gray-100" />
                            </div>
                        </div>
                        <div className="flex justify-between items-center">
                            <button type="button" onClick={() => handleReset('transfers')} disabled={!canEditTransfers || saving} className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50">
                                Reset to defaults
                            </button>
                            {canEditTransfers && (
                                <button type="submit" disabled={saving} className="px-4 py-2 bg-indigo-600 text-white rounded-md disabled:opacity-50">
                                    {saving ? 'Saving...' : 'Save Transfers'}
                                </button>
                            )}
                        </div>
                    </form>
                )}

                {/* --- COMMUNICATION TAB --- */}
                {activeTab === 'communication' && (
                    <form onSubmit={commsForm.handleSubmit(d => handleSave('communication', d))} className="space-y-8">
                        {/* Legacy Settings */}
                        <div>
                            <h3 className="text-lg font-medium text-gray-900 mb-4">Basis Communicatie</h3>
                            <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-6">
                                <div className="sm:col-span-4">
                                    <label className="block text-sm font-medium text-gray-700">Reply-To Email (legacy)</label>
                                    <input type="email" {...commsForm.register('reply_to_email')} disabled={!canEditCommunication || saving} className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100" />
                                </div>
                                <div className="sm:col-span-2">
                                    <label className="block text-sm font-medium text-gray-700">Default Locale</label>
                                    <select {...commsForm.register('default_locale')} disabled={!canEditCommunication || saving} className="mt-1 block w-full py-2 px-3 border border-gray-300 rounded-md disabled:bg-gray-100">
                                        <option value="nl">Nederlands</option>
                                        <option value="en">English</option>
                                        <option value="fr">Français</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <hr className="border-gray-200" />

                        {/* NEW: Email Sender Settings */}
                        <div>
                            <h3 className="text-lg font-medium text-gray-900 mb-2">Email Afzender</h3>
                            <p className="text-sm text-gray-500 mb-4">Configureer wie er als afzender verschijnt in uitgaande emails.</p>
                            <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-6">
                                <div className="sm:col-span-3">
                                    <label className="block text-sm font-medium text-gray-700">Afzender Naam</label>
                                    <input
                                        type="text"
                                        {...commsForm.register('sender.default_from_name')}
                                        disabled={!canEditCommunication || saving}
                                        placeholder="Bijv: COLOSS Events"
                                        className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                    />
                                </div>
                                <div className="sm:col-span-3">
                                    <label className="block text-sm font-medium text-gray-700">Afzender Email</label>
                                    <input
                                        type="email"
                                        {...commsForm.register('sender.default_from_email')}
                                        disabled={!canEditCommunication || saving}
                                        placeholder="noreply@coloss.nl"
                                        className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                    />
                                </div>
                                <div className="sm:col-span-6">
                                    <label className="block text-sm font-medium text-gray-700">Reply-To Email</label>
                                    <input
                                        type="email"
                                        {...commsForm.register('sender.default_reply_to')}
                                        disabled={!canEditCommunication || saving}
                                        placeholder="support@coloss.nl (optioneel)"
                                        className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                    />
                                    <p className="mt-1 text-sm text-gray-500">Email adres waar antwoorden naartoe gaan.</p>
                                </div>
                            </div>
                        </div>

                        <hr className="border-gray-200" />

                        {/* NEW: Bulk Email Settings */}
                        <div>
                            <h3 className="text-lg font-medium text-gray-900 mb-2">Bulk Messaging</h3>
                            <p className="text-sm text-gray-500 mb-4">Instellingen voor massa-email campagnes naar deelnemers.</p>
                            <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-6">
                                <div className="sm:col-span-2">
                                    <label className="block text-sm font-medium text-gray-700">Batch Grootte</label>
                                    <input
                                        type="number"
                                        {...commsForm.register('bulk.batch_size', { valueAsNumber: true })}
                                        disabled={!canEditCommunication || saving}
                                        min="1"
                                        max="500"
                                        placeholder="100"
                                        className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                    />
                                    <p className="mt-1 text-sm text-gray-500">Emails per batch (1-500)</p>
                                </div>
                                <div className="sm:col-span-2">
                                    <label className="block text-sm font-medium text-gray-700">Batch Delay (ms)</label>
                                    <input
                                        type="number"
                                        {...commsForm.register('bulk.delay_between_batches_ms', { valueAsNumber: true })}
                                        disabled={!canEditCommunication || saving}
                                        min="100"
                                        max="10000"
                                        placeholder="1000"
                                        className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                    />
                                    <p className="mt-1 text-sm text-gray-500">Wachttijd tussen batches</p>
                                </div>
                                <div className="sm:col-span-2">
                                    <label className="block text-sm font-medium text-gray-700">Max Ontvangers</label>
                                    <input
                                        type="number"
                                        {...commsForm.register('bulk.max_recipients_per_campaign', { valueAsNumber: true })}
                                        disabled={!canEditCommunication || saving}
                                        min="1"
                                        max="100000"
                                        placeholder="10000"
                                        className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                    />
                                    <p className="mt-1 text-sm text-gray-500">Per campagne</p>
                                </div>
                            </div>
                        </div>

                        <hr className="border-gray-200" />

                        {/* NEW: Compliance Settings */}
                        <div>
                            <h3 className="text-lg font-medium text-gray-900 mb-2">Compliance & Spam Preventie</h3>
                            <p className="text-sm text-gray-500 mb-4">GDPR en anti-spam instellingen.</p>
                            <div className="space-y-4">
                                <div className="flex items-start">
                                    <div className="flex items-center h-5">
                                        <input
                                            id="unsubscribe_enabled"
                                            type="checkbox"
                                            {...commsForm.register('compliance.unsubscribe_enabled')}
                                            disabled={!canEditCommunication || saving}
                                            className="focus:ring-indigo-500 h-4 w-4 text-indigo-600 border-gray-300 rounded disabled:opacity-50"
                                        />
                                    </div>
                                    <div className="ml-3 text-sm">
                                        <label htmlFor="unsubscribe_enabled" className="font-medium text-gray-700">Unsubscribe Link Tonen</label>
                                        <p className="text-gray-500">Verplicht voor marketing emails (GDPR)</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Bounce Threshold</label>
                                        <input
                                            type="number"
                                            {...commsForm.register('compliance.bounce_threshold', { valueAsNumber: true })}
                                            disabled={!canEditCommunication || saving}
                                            min="1"
                                            max="10"
                                            placeholder="3"
                                            className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                        />
                                        <p className="mt-1 text-sm text-gray-500">Max bounces voordat email geblokkeerd wordt</p>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Complaint Threshold</label>
                                        <input
                                            type="number"
                                            {...commsForm.register('compliance.complaint_threshold', { valueAsNumber: true })}
                                            disabled={!canEditCommunication || saving}
                                            min="1"
                                            max="5"
                                            placeholder="1"
                                            className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                        />
                                        <p className="mt-1 text-sm text-gray-500">Max spam complaints voordat email geblokkeerd wordt</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <hr className="border-gray-200" />

                        {/* NEW: Rate Limits */}
                        <div>
                            <h3 className="text-lg font-medium text-gray-900 mb-2">Rate Limits</h3>
                            <p className="text-sm text-gray-500 mb-4">Maximum aantal emails per tijdseenheid.</p>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Emails per Minuut</label>
                                    <input
                                        type="number"
                                        {...commsForm.register('rate_limits.emails_per_minute', { valueAsNumber: true })}
                                        disabled={!canEditCommunication || saving}
                                        min="1"
                                        max="1000"
                                        placeholder="100"
                                        className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Emails per Uur</label>
                                    <input
                                        type="number"
                                        {...commsForm.register('rate_limits.emails_per_hour', { valueAsNumber: true })}
                                        disabled={!canEditCommunication || saving}
                                        min="1"
                                        max="50000"
                                        placeholder="5000"
                                        className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                    />
                                </div>
                            </div>
                        </div>

                        <hr className="border-gray-200" />

                        {/* NEW: Retry Configuration */}
                        <div>
                            <h3 className="text-lg font-medium text-gray-900 mb-2">Retry Configuratie</h3>
                            <p className="text-sm text-gray-500 mb-4">Hoe vaak gefaalde emails opnieuw proberen.</p>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Max Pogingen</label>
                                    <input
                                        type="number"
                                        {...commsForm.register('retry.max_attempts', { valueAsNumber: true })}
                                        disabled={!canEditCommunication || saving}
                                        min="1"
                                        max="10"
                                        placeholder="3"
                                        className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Initiële Delay (ms)</label>
                                    <input
                                        type="number"
                                        {...commsForm.register('retry.initial_delay_ms', { valueAsNumber: true })}
                                        disabled={!canEditCommunication || saving}
                                        min="1000"
                                        max="600000"
                                        placeholder="60000"
                                        className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                    />
                                    <p className="mt-1 text-sm text-gray-500">1 min = 60000ms</p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Backoff Multiplier</label>
                                    <input
                                        type="number"
                                        {...commsForm.register('retry.backoff_multiplier', { valueAsNumber: true })}
                                        disabled={!canEditCommunication || saving}
                                        min="1"
                                        max="5"
                                        step="0.1"
                                        placeholder="2"
                                        className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                    />
                                    <p className="mt-1 text-sm text-gray-500">Exponential backoff</p>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-between items-center pt-4">
                            <button type="button" onClick={() => handleReset('communication')} disabled={!canEditCommunication || saving} className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50">
                                Reset to defaults
                            </button>
                            {canEditCommunication && (
                                <button type="submit" disabled={saving} className="px-4 py-2 bg-indigo-600 text-white rounded-md disabled:opacity-50">
                                    {saving ? 'Saving...' : 'Save Communication Settings'}
                                </button>
                            )}
                        </div>
                    </form>
                )}

                {/* --- BRANDING TAB (NEW Sprint 3) --- */}
                {activeTab === 'branding' && (
                    <form onSubmit={brandingForm.handleSubmit(d => handleSave('branding', d))} className="space-y-6">
                        <div>
                            <h3 className="text-lg font-medium text-gray-900 mb-4">Event Branding</h3>
                            <p className="text-sm text-gray-500 mb-6">
                                Afbeeldingen en kleuren voor checkout, bevestigingspagina en ticket PDF.
                            </p>

                            <div className="space-y-6">
                                {/* Hero Image */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Hero Afbeelding ID</label>
                                    <input
                                        type="text"
                                        {...brandingForm.register('hero_image_id')}
                                        disabled={!canEditBranding || saving}
                                        className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                        placeholder="UUID van geüploade afbeelding (optioneel)"
                                    />
                                    <p className="mt-1 text-xs text-gray-500">
                                        Aanbevolen: 1200x400px, max 5MB. Toegestaan: PNG, JPEG, WebP.
                                    </p>
                                    {/* TODO: Implement file upload component in future sprint */}
                                </div>

                                {/* Logo Image */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Logo Afbeelding ID</label>
                                    <input
                                        type="text"
                                        {...brandingForm.register('logo_image_id')}
                                        disabled={!canEditBranding || saving}
                                        className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                        placeholder="UUID van geüploade logo (optioneel)"
                                    />
                                    <p className="mt-1 text-xs text-gray-500">
                                        Aanbevolen: 200x200px, max 2MB. Toegestaan: PNG, JPEG, WebP.
                                    </p>
                                </div>

                                {/* Primary Color */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Accentkleur</label>
                                    <div className="mt-1 flex items-center space-x-3">
                                        <input
                                            type="color"
                                            {...brandingForm.register('primary_color')}
                                            disabled={!canEditBranding || saving}
                                            className="h-10 w-14 border border-gray-300 rounded cursor-pointer disabled:cursor-not-allowed"
                                        />
                                        <input
                                            type="text"
                                            {...brandingForm.register('primary_color', {
                                                pattern: {
                                                    value: /^#[0-9A-Fa-f]{6}$/,
                                                    message: 'Ongeldige hex kleur (gebruik #RRGGBB)'
                                                }
                                            })}
                                            disabled={!canEditBranding || saving}
                                            className="block w-32 border-gray-300 rounded-md disabled:bg-gray-100 font-mono text-sm"
                                            placeholder="#4F46E5"
                                        />
                                    </div>
                                    {brandingForm.formState.errors.primary_color && (
                                        <p className="mt-1 text-xs text-red-600">
                                            {brandingForm.formState.errors.primary_color.message}
                                        </p>
                                    )}
                                    <p className="mt-1 text-xs text-gray-500">
                                        Wordt gebruikt voor buttons en links in checkout.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-between items-center">
                            <button type="button" onClick={() => handleReset('branding')} disabled={!canEditBranding || saving} className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50">
                                Reset to defaults
                            </button>
                            {canEditBranding && (
                                <button type="submit" disabled={saving} className="px-4 py-2 bg-indigo-600 text-white rounded-md disabled:opacity-50">
                                    {saving ? 'Saving...' : 'Save Branding'}
                                </button>
                            )}
                        </div>
                    </form>
                )}

                {/* --- WAITLIST & INTEREST TAB (NEW Sprint 4) --- */}
                {activeTab === 'waitlist' && (
                    <div className="space-y-12">
                        {/* Waitlist Section */}
                        <form onSubmit={waitlistForm.handleSubmit(d => handleSave('waitlist', d))} className="space-y-6">
                            <div>
                                <h3 className="text-lg font-medium text-gray-900 mb-4">Wachtlijst</h3>
                                <p className="text-sm text-gray-500 mb-6">
                                    Sta deelnemers toe zich in te schrijven op een wachtlijst wanneer het event is uitverkocht.
                                </p>

                                <div className="flex items-start">
                                    <div className="flex items-center h-5">
                                        <input
                                            id="waitlist_enabled"
                                            type="checkbox"
                                            {...waitlistForm.register('enabled')}
                                            disabled={!canEditWaitlist || saving}
                                            className="focus:ring-indigo-500 h-4 w-4 text-indigo-600 border-gray-300 rounded disabled:opacity-50"
                                        />
                                    </div>
                                    <div className="ml-3 text-sm">
                                        <label htmlFor="waitlist_enabled" className="font-medium text-gray-700">Wachtlijst inschakelen</label>
                                        <p className="text-gray-500">Indien aangevinkt, kunnen gebruikers zich aanmelden voor de wachtlijst als er geen tickets meer beschikbaar zijn.</p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-between items-center">
                                <button type="button" onClick={() => handleReset('waitlist')} disabled={!canEditWaitlist || saving} className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50">
                                    Reset to defaults
                                </button>
                                {canEditWaitlist && (
                                    <button type="submit" disabled={saving} className="px-4 py-2 bg-indigo-600 text-white rounded-md disabled:opacity-50">
                                        {saving ? 'Saving...' : 'Save Waitlist Settings'}
                                    </button>
                                )}
                            </div>
                        </form>

                        <hr className="border-gray-200" />

                        {/* Interest List Section */}
                        <form onSubmit={interestListForm.handleSubmit(d => handleSave('interest_list', d))} className="space-y-6">
                            <div>
                                <h3 className="text-lg font-medium text-gray-900 mb-4">Interesselijst</h3>
                                <p className="text-sm text-gray-500 mb-6">
                                    Sta geïnteresseerden toe hun e-mailadres achter te laten voordat de inschrijvingen openen of nadat ze gesloten zijn.
                                </p>

                                <div className="flex items-start">
                                    <div className="flex items-center h-5">
                                        <input
                                            id="interest_enabled"
                                            type="checkbox"
                                            {...interestListForm.register('enabled')}
                                            disabled={!canEditInterestList || saving}
                                            className="focus:ring-indigo-500 h-4 w-4 text-indigo-600 border-gray-300 rounded disabled:opacity-50"
                                        />
                                    </div>
                                    <div className="ml-3 text-sm">
                                        <label htmlFor="interest_enabled" className="font-medium text-gray-700">Interesselijst inschakelen</label>
                                        <p className="text-gray-500">Indien aangevinkt, wordt een "Houd mij op de hoogte" optie getoond op de event pagina.</p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-between items-center">
                                <button type="button" onClick={() => handleReset('interest_list')} disabled={!canEditInterestList || saving} className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50">
                                    Reset to defaults
                                </button>
                                {canEditInterestList && (
                                    <button type="submit" disabled={saving} className="px-4 py-2 bg-indigo-600 text-white rounded-md disabled:opacity-50">
                                        {saving ? 'Saving...' : 'Save Interest Settings'}
                                    </button>
                                )}
                            </div>
                        </form>
                    </div>
                )}

                {/* --- TICKETS & PRIVACY TAB (NEW Sprint 6) --- */}
                {activeTab === 'tickets' && (
                    <div className="space-y-12">
                        {/* Ticket PDF Section */}
                        <form onSubmit={ticketPdfForm.handleSubmit(d => handleSave('ticket_pdf', d))} className="space-y-6">
                            <div>
                                <h3 className="text-lg font-medium text-gray-900 mb-4">Ticket PDF Instellingen</h3>
                                <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-6">
                                    <div className="sm:col-span-3">
                                        <label htmlFor="available_from" className="block text-sm font-medium text-gray-700">
                                            Tickets beschikbaar vanaf
                                        </label>
                                        <div className="mt-1">
                                            <input
                                                type="datetime-local"
                                                id="available_from"
                                                {...ticketPdfForm.register('available_from')}
                                                disabled={!canEditTicketPdf || saving}
                                                className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md disabled:bg-gray-100"
                                            />
                                        </div>
                                        <p className="mt-2 text-sm text-gray-500">
                                            Vanaf dit moment kunnen deelnemers hun ticket downloaden en zien ze de QR-code.
                                        </p>
                                    </div>

                                    <div className="sm:col-span-3">
                                        <label htmlFor="banner_image_id" className="block text-sm font-medium text-gray-700">
                                            Banner Image ID (UUID)
                                        </label>
                                        <div className="mt-1">
                                            <input
                                                type="text"
                                                id="banner_image_id"
                                                {...ticketPdfForm.register('banner_image_id')}
                                                disabled={!canEditTicketPdf || saving}
                                                className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md disabled:bg-gray-100 font-mono"
                                                placeholder="00000000-0000-0000-0000-000000000000"
                                            />
                                        </div>
                                        <p className="mt-2 text-sm text-gray-500">
                                            Optionele banner afbeelding bovenaan de PDF.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-between items-center">
                                <button type="button" onClick={() => handleReset('ticket_pdf')} disabled={!canEditTicketPdf || saving} className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50">
                                    Reset to defaults
                                </button>
                                {canEditTicketPdf && (
                                    <button type="submit" disabled={saving} className="px-4 py-2 bg-indigo-600 text-white rounded-md disabled:opacity-50">
                                        {saving ? 'Saving...' : 'Save PDF Settings'}
                                    </button>
                                )}
                            </div>
                        </form>

                        <hr className="border-gray-200" />

                        {/* Ticket Privacy Section */}
                        <form onSubmit={ticketPrivacyForm.handleSubmit(d => handleSave('ticket_privacy', d))} className="space-y-6">
                            <div>
                                <h3 className="text-lg font-medium text-gray-900 mb-4">Ticket Privacy</h3>
                                <p className="text-sm text-gray-500 mb-4">
                                    Selecteer welke persoonsgegevens zichtbaar mogen zijn op het ticket PDF.
                                </p>

                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                                    {[
                                        { key: 'name', label: 'Naam' },
                                        { key: 'email', label: 'E-mailadres' },
                                        { key: 'birthdate', label: 'Geboortedatum' },
                                        { key: 'gender', label: 'Geslacht' },
                                        { key: 'nationality', label: 'Nationaliteit' },
                                        { key: 'address', label: 'Adres' },
                                        { key: 'phone', label: 'Telefoonnummer' },
                                        { key: 'emergency_contact', label: 'Noodcontact' },
                                    ].map((field) => (
                                        <div key={field.key} className="relative flex items-start">
                                            <div className="flex items-center h-5">
                                                <input
                                                    id={`privacy_${field.key}`}
                                                    type="checkbox"
                                                    {...ticketPrivacyForm.register(`show.${field.key as keyof TicketPrivacySettings['show']}`)}
                                                    disabled={!canEditTicketPrivacy || saving}
                                                    className="focus:ring-indigo-500 h-4 w-4 text-indigo-600 border-gray-300 rounded disabled:opacity-50"
                                                />
                                            </div>
                                            <div className="ml-3 text-sm">
                                                <label htmlFor={`privacy_${field.key}`} className="font-medium text-gray-700">
                                                    {field.label}
                                                </label>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex justify-between items-center">
                                <button type="button" onClick={() => handleReset('ticket_privacy')} disabled={!canEditTicketPrivacy || saving} className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50">
                                    Reset to defaults
                                </button>
                                {canEditTicketPrivacy && (
                                    <button type="submit" disabled={saving} className="px-4 py-2 bg-indigo-600 text-white rounded-md disabled:opacity-50">
                                        {saving ? 'Saving...' : 'Save Privacy Settings'}
                                    </button>
                                )}
                            </div>
                        </form>
                    </div>
                )}

                {showDebug && <DebugPanel data={config} permissions={permissions} eventId={eventId} />}
            </div>
        </div >
    )
}
