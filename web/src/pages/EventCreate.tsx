/**
 * EventCreate Page
 * 
 * Formulier voor het aanmaken van een nieuw event.
 * Features:
 * - Formulier met naam, datum, locatie
 * - Client-side validatie (required velden)
 * - Na submit: navigeer naar event detail pagina
 */

import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Calendar, MapPin, Loader2 } from 'lucide-react'
import { useOrgSafe } from '../hooks/useOrg'
import { createEvent } from '../data/events'

export function EventCreate() {
    const context = useOrgSafe()
    const org = context?.org
    const navigate = useNavigate()

    // Form state
    const [name, setName] = useState('')
    const [startTime, setStartTime] = useState('')
    const [locationName, setLocationName] = useState('')
    const [description, setDescription] = useState('')

    // UI state
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Guard: org nog niet geladen
    if (!org) {
        return <div className="p-4 text-gray-500">Organisatie laden...</div>
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        // Client-side validatie
        if (!name.trim()) {
            setError('Naam is verplicht')
            return
        }
        if (!startTime) {
            setError('Startdatum is verplicht')
            return
        }

        setLoading(true)
        setError(null)

        console.log('[EventCreate] Creating event:', { name, startTime, locationName })

        const { data, error: createError } = await createEvent(org.id, {
            name: name.trim(),
            start_time: new Date(startTime).toISOString(),
            location_name: locationName.trim() || null,
            description: description.trim() || null,
        })

        if (createError) {
            console.error('[EventCreate] Error:', createError)
            setError(createError.message)
            setLoading(false)
            return
        }

        console.log('[EventCreate] Success, navigating to:', data?.slug)

        // Navigeer naar de nieuwe event detail pagina
        navigate(`/org/${org.slug}/events/${data?.slug}`)
    }

    return (
        <div className="max-w-2xl mx-auto">
            {/* Header */}
            <div className="mb-8">
                <Link
                    to={`/org/${org.slug}/events`}
                    className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
                >
                    <ArrowLeft className="mr-1 h-4 w-4" />
                    Terug naar evenementen
                </Link>
                <h1 className="text-2xl font-bold text-gray-900">Nieuw Evenement</h1>
                <p className="mt-1 text-sm text-gray-500">
                    Vul de basisgegevens in om een nieuw evenement aan te maken.
                </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-6">
                <div className="bg-white shadow sm:rounded-lg">
                    <div className="px-4 py-5 sm:p-6 space-y-6">
                        {/* Naam */}
                        <div>
                            <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                                Naam <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                id="name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Bijv. Marathonloop 2026"
                                required
                                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            />
                        </div>

                        {/* Start Datum/Tijd */}
                        <div>
                            <label htmlFor="startTime" className="block text-sm font-medium text-gray-700">
                                <Calendar className="inline mr-1 h-4 w-4" />
                                Startdatum & tijd <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="datetime-local"
                                id="startTime"
                                value={startTime}
                                onChange={(e) => setStartTime(e.target.value)}
                                required
                                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            />
                        </div>

                        {/* Locatie */}
                        <div>
                            <label htmlFor="locationName" className="block text-sm font-medium text-gray-700">
                                <MapPin className="inline mr-1 h-4 w-4" />
                                Locatie
                            </label>
                            <input
                                type="text"
                                id="locationName"
                                value={locationName}
                                onChange={(e) => setLocationName(e.target.value)}
                                placeholder="Bijv. Olympisch Stadion, Amsterdam"
                                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            />
                            <p className="mt-1 text-sm text-gray-500">
                                Optioneel. Je kunt dit later nog aanpassen.
                            </p>
                        </div>

                        {/* Beschrijving */}
                        <div>
                            <label htmlFor="description" className="block text-sm font-medium text-gray-700">
                                Beschrijving
                            </label>
                            <textarea
                                id="description"
                                rows={3}
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Een korte beschrijving van het evenement..."
                                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            />
                        </div>
                    </div>
                </div>

                {/* Error message */}
                {error && (
                    <div className="bg-red-50 border border-red-200 rounded-md p-4">
                        <p className="text-sm text-red-800">{error}</p>
                    </div>
                )}

                {/* Actions */}
                <div className="flex justify-end space-x-3">
                    <Link
                        to={`/org/${org.slug}/events`}
                        className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                    >
                        Annuleren
                    </Link>
                    <button
                        type="submit"
                        disabled={loading}
                        className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4" />
                                Aanmaken...
                            </>
                        ) : (
                            'Evenement aanmaken'
                        )}
                    </button>
                </div>
            </form>
        </div>
    )
}
