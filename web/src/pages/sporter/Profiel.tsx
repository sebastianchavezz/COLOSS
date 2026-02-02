/**
 * Profiel - User profile page for sporters
 *
 * Shows:
 * - Basic user info
 * - Email
 * - Password change
 */

import { useState } from 'react'
import { User, Mail, Lock, Check, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

export function Profiel() {
    const { user } = useAuth()
    const [updating, setUpdating] = useState(false)
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

    // Password change form
    const [showPasswordForm, setShowPasswordForm] = useState(false)
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')

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

            {/* Account Info */}
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

            {/* Password Section */}
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

            {/* Danger Zone */}
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
        </div>
    )
}

export default Profiel
