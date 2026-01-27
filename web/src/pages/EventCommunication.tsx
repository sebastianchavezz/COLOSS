import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { supabase } from '../lib/supabase'
import { clsx } from 'clsx'
import type { AppEvent } from '../types/supabase'

type EventDetailContext = {
    event: AppEvent
    org: any
    refreshEvent: () => void
}

type CommunicationSettings = {
    reply_to_email?: string
    default_locale?: 'nl' | 'en' | 'fr'
    sender?: {
        default_from_name: string
        default_from_email: string
        default_reply_to: string | null
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

export function EventCommunication() {
    const { event } = useOutletContext<EventDetailContext>()

    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)

    const { register, handleSubmit, reset } = useForm<CommunicationSettings>()

    useEffect(() => {
        if (!event) return

        const fetchConfig = async () => {
            setLoading(true)
            const { data, error: fetchError } = await supabase
                .rpc('get_event_config', { _event_id: event.id })

            if (fetchError) {
                console.error('[EventCommunication] Error:', fetchError)
                setError(fetchError.message)
            } else if (data?.communication) {
                reset(data.communication)
            }
            setLoading(false)
        }

        fetchConfig()
    }, [event?.id, reset])

    const onSubmit = async (formData: CommunicationSettings) => {
        if (!event) return
        setSaving(true)
        setError(null)
        setSuccess(null)

        try {
            const { error: saveError } = await supabase
                .rpc('set_event_config', {
                    _event_id: event.id,
                    _domain: 'communication',
                    _patch: formData
                })

            if (saveError) throw saveError

            setSuccess('Communication settings opgeslagen!')
            setTimeout(() => setSuccess(null), 3000)
        } catch (err: any) {
            setError(err.message)
        } finally {
            setSaving(false)
        }
    }

    if (!event) return <div className="p-4">Event laden...</div>
    if (loading) return <div className="p-4">Settings laden...</div>

    return (
        <div className="max-w-4xl">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900">Email Communicatie</h1>
                <p className="mt-2 text-sm text-gray-600">
                    Configureer email verzending, bulk messaging en compliance instellingen voor dit evenement.
                </p>
            </div>

            {error && (
                <div className="mb-4 bg-red-50 border-l-4 border-red-400 p-4 text-red-700">
                    {error}
                </div>
            )}

            {success && (
                <div className="mb-4 bg-green-50 border-l-4 border-green-400 p-4 text-green-700">
                    {success}
                </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="bg-white shadow sm:rounded-lg">
                <div className="p-6 space-y-8">
                    {/* Email Sender Settings */}
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">📧 Email Afzender</h3>
                        <p className="text-sm text-gray-500 mb-4">Configureer wie er als afzender verschijnt in uitgaande emails.</p>
                        <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-6">
                            <div className="sm:col-span-3">
                                <label className="block text-sm font-medium text-gray-700">Afzender Naam</label>
                                <input
                                    type="text"
                                    {...register('sender.default_from_name')}
                                    disabled={saving}
                                    placeholder="Bijv: COLOSS Events"
                                    className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                />
                            </div>
                            <div className="sm:col-span-3">
                                <label className="block text-sm font-medium text-gray-700">Afzender Email</label>
                                <input
                                    type="email"
                                    {...register('sender.default_from_email')}
                                    disabled={saving}
                                    placeholder="noreply@jouwdomein.nl"
                                    className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                />
                            </div>
                            <div className="sm:col-span-6">
                                <label className="block text-sm font-medium text-gray-700">Reply-To Email</label>
                                <input
                                    type="email"
                                    {...register('sender.default_reply_to')}
                                    disabled={saving}
                                    placeholder="support@jouwdomein.nl (optioneel)"
                                    className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                />
                                <p className="mt-1 text-sm text-gray-500">Email adres waar antwoorden naartoe gaan.</p>
                            </div>
                        </div>
                    </div>

                    <hr className="border-gray-200" />

                    {/* Bulk Email Settings */}
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">📨 Bulk Messaging</h3>
                        <p className="text-sm text-gray-500 mb-4">Instellingen voor massa-email campagnes naar deelnemers.</p>
                        <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-6">
                            <div className="sm:col-span-2">
                                <label className="block text-sm font-medium text-gray-700">Batch Grootte</label>
                                <input
                                    type="number"
                                    {...register('bulk.batch_size', { valueAsNumber: true })}
                                    disabled={saving}
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
                                    {...register('bulk.delay_between_batches_ms', { valueAsNumber: true })}
                                    disabled={saving}
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
                                    {...register('bulk.max_recipients_per_campaign', { valueAsNumber: true })}
                                    disabled={saving}
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

                    {/* Compliance Settings */}
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">✅ Compliance & Spam Preventie</h3>
                        <p className="text-sm text-gray-500 mb-4">GDPR en anti-spam instellingen.</p>
                        <div className="space-y-4">
                            <div className="flex items-start">
                                <div className="flex items-center h-5">
                                    <input
                                        id="unsubscribe_enabled"
                                        type="checkbox"
                                        {...register('compliance.unsubscribe_enabled')}
                                        disabled={saving}
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
                                        {...register('compliance.bounce_threshold', { valueAsNumber: true })}
                                        disabled={saving}
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
                                        {...register('compliance.complaint_threshold', { valueAsNumber: true })}
                                        disabled={saving}
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

                    {/* Rate Limits */}
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">⏱️ Rate Limits</h3>
                        <p className="text-sm text-gray-500 mb-4">Maximum aantal emails per tijdseenheid.</p>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Emails per Minuut</label>
                                <input
                                    type="number"
                                    {...register('rate_limits.emails_per_minute', { valueAsNumber: true })}
                                    disabled={saving}
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
                                    {...register('rate_limits.emails_per_hour', { valueAsNumber: true })}
                                    disabled={saving}
                                    min="1"
                                    max="50000"
                                    placeholder="5000"
                                    className="mt-1 block w-full border-gray-300 rounded-md disabled:bg-gray-100"
                                />
                            </div>
                        </div>
                    </div>

                    <hr className="border-gray-200" />

                    {/* Retry Configuration */}
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">🔄 Retry Configuratie</h3>
                        <p className="text-sm text-gray-500 mb-4">Hoe vaak gefaalde emails opnieuw proberen.</p>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Max Pogingen</label>
                                <input
                                    type="number"
                                    {...register('retry.max_attempts', { valueAsNumber: true })}
                                    disabled={saving}
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
                                    {...register('retry.initial_delay_ms', { valueAsNumber: true })}
                                    disabled={saving}
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
                                    {...register('retry.backoff_multiplier', { valueAsNumber: true })}
                                    disabled={saving}
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
                </div>

                {/* Save Button */}
                <div className="bg-gray-50 px-6 py-4 flex justify-end rounded-b-lg">
                    <button
                        type="submit"
                        disabled={saving}
                        className={clsx(
                            "px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500",
                            saving ? "bg-indigo-400 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-700"
                        )}
                    >
                        {saving ? 'Opslaan...' : 'Instellingen Opslaan'}
                    </button>
                </div>
            </form>
        </div>
    )
}
