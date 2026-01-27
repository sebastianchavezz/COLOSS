import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { supabase } from '../lib/supabase'
import { clsx } from 'clsx'
import { Settings as AdvancedSettings } from './events/Settings'
import type { AppEvent } from '../types/supabase'

type EventDetailContext = {
    event: AppEvent
    org: any
    refreshEvent: () => void
}

type FormData = {
    name: string
    start_time: string
    end_time: string
    location_name: string
    description: string
}

export function EventSettings() {
    const { event } = useOutletContext<EventDetailContext>()

    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>()

    useEffect(() => {
        if (event) {
            const toLocalISO = (dateStr: string) => {
                if (!dateStr) return ''
                return new Date(dateStr).toISOString().slice(0, 16)
            }

            reset({
                name: event.name,
                start_time: toLocalISO(event.start_time),
                end_time: event.end_time ? toLocalISO(event.end_time) : '',
                location_name: event.location_name || '',
                description: event.description || '',
            })
        }
    }, [event, reset])

    const onSubmit = async (data: FormData) => {
        if (!event) return
        setSaving(true)
        setError(null)

        try {
            const { error: eventError } = await supabase
                .from('events')
                .update({
                    name: data.name,
                    start_time: new Date(data.start_time).toISOString(),
                    end_time: data.end_time ? new Date(data.end_time).toISOString() : null,
                    location_name: data.location_name,
                    description: data.description,
                })
                .eq('id', event.id)

            if (eventError) throw eventError
            alert('Algemene instellingen opgeslagen')
        } catch (err: any) {
            setError(err.message)
        } finally {
            setSaving(false)
        }
    }

    if (!event) return <div>Laden...</div>

    return (
        <div className="space-y-8">
            {/* General Settings Section */}
            <div className="max-w-3xl bg-white shadow sm:rounded-lg p-6">
                <h2 className="text-lg font-medium text-gray-900 mb-4">Algemene Instellingen</h2>

                {error && (
                    <div className="mb-4 bg-red-50 border-l-4 border-red-400 p-4 text-red-700">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                    <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-6">

                        {/* Name */}
                        <div className="sm:col-span-4">
                            <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                                Naam evenement *
                            </label>
                            <div className="mt-1">
                                <input
                                    type="text"
                                    id="name"
                                    {...register('name', { required: 'Naam is verplicht' })}
                                    className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md"
                                />
                                {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>}
                            </div>
                        </div>

                        {/* Dates */}
                        <div className="sm:col-span-3">
                            <label htmlFor="start_time" className="block text-sm font-medium text-gray-700">
                                Startdatum & tijd *
                            </label>
                            <div className="mt-1">
                                <input
                                    type="datetime-local"
                                    id="start_time"
                                    {...register('start_time', { required: 'Starttijd is verplicht' })}
                                    className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md"
                                />
                            </div>
                        </div>

                        <div className="sm:col-span-3">
                            <label htmlFor="end_time" className="block text-sm font-medium text-gray-700">
                                Einddatum & tijd
                            </label>
                            <div className="mt-1">
                                <input
                                    type="datetime-local"
                                    id="end_time"
                                    {...register('end_time')}
                                    className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md"
                                />
                            </div>
                        </div>

                        {/* Location */}
                        <div className="sm:col-span-6">
                            <label htmlFor="location_name" className="block text-sm font-medium text-gray-700">
                                Locatie
                            </label>
                            <div className="mt-1">
                                <input
                                    type="text"
                                    id="location_name"
                                    {...register('location_name')}
                                    className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md"
                                    placeholder="Bijv. Sportpark De Dreef"
                                />
                            </div>
                        </div>

                        {/* Description */}
                        <div className="sm:col-span-6">
                            <label htmlFor="description" className="block text-sm font-medium text-gray-700">
                                Omschrijving
                            </label>
                            <div className="mt-1">
                                <textarea
                                    id="description"
                                    rows={3}
                                    {...register('description')}
                                    className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md"
                                />
                            </div>
                        </div>

                    </div>

                    <div className="flex justify-end">
                        <button
                            type="submit"
                            disabled={saving}
                            className={clsx(
                                "ml-3 inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500",
                                saving ? "bg-indigo-400" : "bg-indigo-600 hover:bg-indigo-700"
                            )}
                        >
                            {saving ? 'Opslaan...' : 'Opslaan'}
                        </button>
                    </div>
                </form>
            </div>

            {/* Advanced Settings (Payments, Transfers, Communication) */}
            <div className="max-w-4xl">
                <h2 className="text-lg font-medium text-gray-900 mb-4">Configuratie</h2>
                <AdvancedSettings eventId={event.id} />
            </div>
        </div>
    )
}
