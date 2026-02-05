/**
 * Profiel - User profile page for sporters
 *
 * Shows:
 * - Participant profile (editable)
 * - Personal data form
 * - Email (read-only)
 * - Password change
 * - Account deletion
 */

import { useEffect, useState } from 'react'
import { User, Mail, Lock, Check, AlertCircle, MapPin, Phone, Calendar, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

interface ParticipantProfile {
    id: string
    email: string
    first_name: string
    last_name: string
    phone: string | null
    birth_date: string | null
    gender: 'M' | 'F' | 'X' | 'O' | null
    address: string | null
    city: string | null
    country: string | null
    created_at: string
    updated_at: string
}

export function Profiel() {
    const { user } = useAuth()
    const [loading, setLoading] = useState(true)
    const [updating, setUpdating] = useState(false)
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

    // Profile data
    const [profile, setProfile] = useState<ParticipantProfile | null>(null)
    const [profileError, setProfileError] = useState<string | null>(null)

    // Form state
    const [formData, setFormData] = useState({
        first_name: '',
        last_name: '',
        phone: '',
        birth_date: '',
        gender: '',
        address: '',
        city: '',
        country: 'NL',
    })

    // Password change form
    const [showPasswordForm, setShowPasswordForm] = useState(false)
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')

    // Load profile on mount
    useEffect(() => {
        loadProfile()
    }, [])

    async function loadProfile() {
        try {
            setLoading(true)
            setMessage(null)

            const { data, error } = await supabase.rpc('get_my_participant_profile')

            if (error) {
                setProfileError(error.message)
                return
            }

            if (data?.status === 'NO_PARTICIPANT') {
                setProfileError(data.message || 'Profiel niet gevonden')
                return
            }

            if (data?.status === 'OK' && data?.participant) {
                const p = data.participant
                setProfile(p)
                setFormData({
                    first_name: p.first_name || '',
                    last_name: p.last_name || '',
                    phone: p.phone || '',
                    birth_date: p.birth_date || '',
                    gender: p.gender || '',
                    address: p.address || '',
                    city: p.city || '',
                    country: p.country || 'NL',
                })
            }
        } catch (err) {
            setProfileError(err instanceof Error ? err.message : 'Fout bij laden profiel')
        } finally {
            setLoading(false)
        }
    }

    async function handleSaveProfile(e: React.FormEvent) {
        e.preventDefault()
        setMessage(null)

        // Validation
        if (!formData.first_name.trim()) {
            setMessage({ type: 'error', text: 'Voornaam is verplicht' })
            return
        }
        if (!formData.last_name.trim()) {
            setMessage({ type: 'error', text: 'Achternaam is verplicht' })
            return
        }

        setUpdating(true)

        try {
            const { data, error } = await supabase.rpc('update_my_participant_profile', {
                p_first_name: formData.first_name.trim(),
                p_last_name: formData.last_name.trim(),
                p_phone: formData.phone.trim() || null,
                p_birth_date: formData.birth_date || null,
                p_gender: formData.gender || null,
                p_address: formData.address.trim() || null,
                p_city: formData.city.trim() || null,
                p_country: formData.country.trim() || 'NL',
            })

            if (error) {
                setMessage({
                    type: 'error',
                    text: error.message || 'Fout bij opslaan profiel'
                })
                return
            }

            if (data?.status === 'OK' && data?.participant) {
                setProfile(data.participant)
                setMessage({ type: 'success', text: 'Profiel succesvol opgeslagen' })
            }
        } catch (err) {
            setMessage({
                type: 'error',
                text: err instanceof Error ? err.message : 'Onbekende fout'
            })
        } finally {
            setUpdating(false)
        }
    }

    async function handlePasswordChange(e: React.FormEvent) {
        e.preventDefault()
        setMessage(null)

        if (newPassword.length < 8) {
            setMessage({ type: 'error', text: 'Wachtwoord moet minimaal 8 tekens zijn' })
            return
        }

        if (newPassword !== confirmPassword) {
            setMessage({ type: 'error', text: 'Wachtwoorden komen niet overeen' })
            return
        }

        setUpdating(true)

        const { error } = await supabase.auth.updateUser({
            password: newPassword
        })

        if (error) {
            setMessage({ type: 'error', text: error.message })
        } else {
            setMessage({ type: 'success', text: 'Wachtwoord succesvol gewijzigd' })
            setNewPassword('')
            setConfirmPassword('')
            setShowPasswordForm(false)
        }

        setUpdating(false)
    }

    // Check if profile is incomplete
    const isProfileIncomplete = !formData.first_name.trim() || !formData.last_name.trim()

    return (
        <div className="space-y-6 max-w-2xl">
            <div>
                <h1 className="text-2xl font-bold text-gray-900">Profiel</h1>
                <p className="text-gray-600 mt-1">
                    Beheer je accountgegevens
                </p>
            </div>

            {/* Feedback Message */}
            {message && (
                <div className={`p-4 rounded-lg flex items-start gap-3 ${
                    message.type === 'success'
                        ? 'bg-green-50 text-green-800'
                        : 'bg-red-50 text-red-800'
                }`}>
                    {message.type === 'success'
                        ? <Check className="h-5 w-5 flex-shrink-0" />
                        : <AlertCircle className="h-5 w-5 flex-shrink-0" />
                    }
                    <span className="text-sm">{message.text}</span>
                </div>
            )}

            {/* Profile Incomplete Banner */}
            {!loading && isProfileIncomplete && (
                <div className="p-4 rounded-lg flex items-start gap-3 bg-yellow-50 text-yellow-800">
                    <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="font-medium">Maak je profiel compleet</p>
                        <p className="text-sm mt-1">Voer je voornaam en achternaam in om je profiel af te ronden.</p>
                    </div>
                </div>
            )}

            {/* Loading State */}
            {loading && (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 text-gray-400 animate-spin" />
                </div>
            )}

            {/* Profile Error */}
            {profileError && !loading && (
                <div className="p-4 rounded-lg flex items-start gap-3 bg-red-50 text-red-800">
                    <AlertCircle className="h-5 w-5 flex-shrink-0" />
                    <div>
                        <p className="font-medium">Fout bij laden profiel</p>
                        <p className="text-sm mt-1">{profileError}</p>
                    </div>
                </div>
            )}

            {/* Personal Data Form */}
            {!loading && !profileError && (
                <form onSubmit={handleSaveProfile} className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
                    <div className="p-4">
                        <h2 className="font-medium text-gray-900 flex items-center gap-2">
                            <User className="h-5 w-5 text-gray-600" />
                            Persoonlijke gegevens
                        </h2>
                    </div>

                    <div className="p-4 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Voornaam *
                                </label>
                                <input
                                    type="text"
                                    value={formData.first_name}
                                    onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-black"
                                    placeholder="Je voornaam"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Achternaam *
                                </label>
                                <input
                                    type="text"
                                    value={formData.last_name}
                                    onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-black"
                                    placeholder="Je achternaam"
                                    required
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                                <Phone className="h-4 w-4" />
                                Telefoon
                            </label>
                            <input
                                type="tel"
                                value={formData.phone}
                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-black"
                                placeholder="+31 6 12345678"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                                    <Calendar className="h-4 w-4" />
                                    Geboortedatum
                                </label>
                                <input
                                    type="date"
                                    value={formData.birth_date}
                                    onChange={(e) => setFormData({ ...formData, birth_date: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-black"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Geslacht
                                </label>
                                <select
                                    value={formData.gender}
                                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-black bg-white"
                                >
                                    <option value="">Niet opgegeven</option>
                                    <option value="M">Man</option>
                                    <option value="F">Vrouw</option>
                                    <option value="X">Non-binair</option>
                                    <option value="O">Anders</option>
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                                <MapPin className="h-4 w-4" />
                                Adres
                            </label>
                            <input
                                type="text"
                                value={formData.address}
                                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-black"
                                placeholder="Straat en huisnummer"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Stad
                                </label>
                                <input
                                    type="text"
                                    value={formData.city}
                                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-black"
                                    placeholder="Amsterdam"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Land
                                </label>
                                <input
                                    type="text"
                                    value={formData.country}
                                    onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-black"
                                    placeholder="NL"
                                    maxLength={2}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="p-4">
                        <button
                            type="submit"
                            disabled={updating}
                            className="w-full py-2 bg-black text-white rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50"
                        >
                            {updating ? 'Opslaan...' : 'Wijzigingen opslaan'}
                        </button>
                    </div>
                </form>
            )}

            {/* Account Info */}
            {!loading && !profileError && (
                <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
                    {/* Email */}
                    <div className="p-4 flex items-center gap-4">
                        <div className="p-2 bg-gray-100 rounded-lg">
                            <Mail className="h-5 w-5 text-gray-600" />
                        </div>
                        <div className="flex-1">
                            <p className="text-sm text-gray-500">E-mailadres</p>
                            <p className="font-medium text-gray-900">{user?.email}</p>
                        </div>
                    </div>

                    {/* User ID */}
                    <div className="p-4 flex items-center gap-4">
                        <div className="p-2 bg-gray-100 rounded-lg">
                            <User className="h-5 w-5 text-gray-600" />
                        </div>
                        <div className="flex-1">
                            <p className="text-sm text-gray-500">Account ID</p>
                            <p className="font-mono text-sm text-gray-600">{user?.id}</p>
                        </div>
                    </div>

                    {/* Created At */}
                    <div className="p-4 flex items-center gap-4">
                        <div className="p-2 bg-gray-100 rounded-lg">
                            <User className="h-5 w-5 text-gray-600" />
                        </div>
                        <div className="flex-1">
                            <p className="text-sm text-gray-500">Account aangemaakt</p>
                            <p className="text-gray-900">
                                {user?.created_at && new Date(user.created_at).toLocaleDateString('nl-NL', {
                                    day: 'numeric',
                                    month: 'long',
                                    year: 'numeric',
                                })}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Password Section */}
            {!loading && !profileError && (
                <div className="bg-white rounded-lg border border-gray-200">
                    <div className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="p-2 bg-gray-100 rounded-lg">
                                <Lock className="h-5 w-5 text-gray-600" />
                            </div>
                            <div>
                                <p className="font-medium text-gray-900">Wachtwoord</p>
                                <p className="text-sm text-gray-500">
                                    Wijzig je wachtwoord
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => setShowPasswordForm(!showPasswordForm)}
                            className="text-sm font-medium text-black hover:underline"
                        >
                            {showPasswordForm ? 'Annuleren' : 'Wijzigen'}
                        </button>
                    </div>

                    {showPasswordForm && (
                        <form onSubmit={handlePasswordChange} className="px-4 pb-4 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Nieuw wachtwoord
                                </label>
                                <input
                                    type="password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-black"
                                    placeholder="Minimaal 8 tekens"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Bevestig wachtwoord
                                </label>
                                <input
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-black"
                                    placeholder="Herhaal wachtwoord"
                                    required
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={updating}
                                className="w-full py-2 bg-black text-white rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50"
                            >
                                {updating ? 'Opslaan...' : 'Wachtwoord wijzigen'}
                            </button>
                        </form>
                    )}
                </div>
            )}

            {/* Danger Zone */}
            {!loading && !profileError && (
                <div className="bg-white rounded-lg border border-red-200">
                    <div className="p-4">
                        <h3 className="font-medium text-red-900">Gevarenzone</h3>
                        <p className="text-sm text-red-600 mt-1">
                            Onomkeerbare acties
                        </p>
                        <button
                            onClick={() => {
                                if (confirm('Weet je zeker dat je je account wilt verwijderen? Dit kan niet ongedaan worden gemaakt.')) {
                                    alert('Neem contact op met support om je account te verwijderen.')
                                }
                            }}
                            className="mt-4 px-4 py-2 border border-red-300 text-red-700 rounded-lg text-sm font-medium hover:bg-red-50"
                        >
                            Account verwijderen
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

export default Profiel
