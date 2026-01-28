import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Mail, Lock, Loader2, ArrowRight, CheckCircle } from 'lucide-react'

type Mode = 'request' | 'reset'

export default function ResetPassword() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [message, setMessage] = useState<{ type: 'error' | 'success', text: string } | null>(null)
    const [mode, setMode] = useState<Mode>('request')

    const navigate = useNavigate()
    const [searchParams] = useSearchParams()

    useEffect(() => {
        // Check if this is a recovery link
        const type = searchParams.get('type')
        if (type === 'recovery') {
            setMode('reset')
        }
    }, [searchParams])

    const handleRequestReset = async (e: React.FormEvent) => {
        e.preventDefault()

        try {
            setLoading(true)
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/reset-password?type=recovery`,
            })

            if (error) throw error

            setMessage({
                type: 'success',
                text: 'Check your email for the password reset link!'
            })
        } catch (error: any) {
            setMessage({ type: 'error', text: error.message })
        } finally {
            setLoading(false)
        }
    }

    const handleUpdatePassword = async (e: React.FormEvent) => {
        e.preventDefault()

        if (password !== confirmPassword) {
            setMessage({ type: 'error', text: 'Passwords do not match' })
            return
        }

        if (password.length < 6) {
            setMessage({ type: 'error', text: 'Password must be at least 6 characters' })
            return
        }

        try {
            setLoading(true)
            const { error } = await supabase.auth.updateUser({
                password: password
            })

            if (error) throw error

            setMessage({
                type: 'success',
                text: 'Password updated successfully! Redirecting to login...'
            })

            // Redirect to login after short delay
            setTimeout(() => {
                navigate('/login')
            }, 2000)
        } catch (error: any) {
            setMessage({ type: 'error', text: error.message })
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
                    {mode === 'request' ? 'Reset your password' : 'Set new password'}
                </h2>
                <p className="mt-2 text-center text-sm text-gray-600">
                    {mode === 'request' ? (
                        <>
                            Remember your password?{' '}
                            <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
                                Sign in
                            </Link>
                        </>
                    ) : (
                        'Enter your new password below'
                    )}
                </p>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">

                    {mode === 'request' ? (
                        <form onSubmit={handleRequestReset} className="space-y-6">
                            <div>
                                <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                                    Email address
                                </label>
                                <div className="mt-1 relative rounded-md shadow-sm">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <Mail className="h-5 w-5 text-gray-400" aria-hidden="true" />
                                    </div>
                                    <input
                                        id="email"
                                        name="email"
                                        type="email"
                                        autoComplete="email"
                                        required
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-10 sm:text-sm border-gray-300 rounded-md h-10 border px-3"
                                        placeholder="you@example.com"
                                    />
                                </div>
                            </div>

                            {message && (
                                <div className={`rounded-md p-4 ${message.type === 'success' ? 'bg-green-50' : 'bg-red-50'}`}>
                                    <div className="flex items-center">
                                        {message.type === 'success' && (
                                            <CheckCircle className="h-5 w-5 text-green-400 mr-2" />
                                        )}
                                        <h3 className={`text-sm font-medium ${message.type === 'success' ? 'text-green-800' : 'text-red-800'}`}>
                                            {message.text}
                                        </h3>
                                    </div>
                                </div>
                            )}

                            <div>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                                >
                                    {loading ? (
                                        <Loader2 className="animate-spin h-5 w-5" />
                                    ) : (
                                        <>
                                            Send Reset Link
                                            <ArrowRight className="ml-2 h-5 w-5" />
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    ) : (
                        <form onSubmit={handleUpdatePassword} className="space-y-6">
                            <div>
                                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                                    New password
                                </label>
                                <div className="mt-1 relative rounded-md shadow-sm">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <Lock className="h-5 w-5 text-gray-400" aria-hidden="true" />
                                    </div>
                                    <input
                                        id="password"
                                        name="password"
                                        type="password"
                                        autoComplete="new-password"
                                        required
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-10 sm:text-sm border-gray-300 rounded-md h-10 border px-3"
                                        placeholder="Min. 6 characters"
                                    />
                                </div>
                            </div>

                            <div>
                                <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
                                    Confirm new password
                                </label>
                                <div className="mt-1 relative rounded-md shadow-sm">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <Lock className="h-5 w-5 text-gray-400" aria-hidden="true" />
                                    </div>
                                    <input
                                        id="confirmPassword"
                                        name="confirmPassword"
                                        type="password"
                                        autoComplete="new-password"
                                        required
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-10 sm:text-sm border-gray-300 rounded-md h-10 border px-3"
                                    />
                                </div>
                            </div>

                            {message && (
                                <div className={`rounded-md p-4 ${message.type === 'success' ? 'bg-green-50' : 'bg-red-50'}`}>
                                    <div className="flex items-center">
                                        {message.type === 'success' && (
                                            <CheckCircle className="h-5 w-5 text-green-400 mr-2" />
                                        )}
                                        <h3 className={`text-sm font-medium ${message.type === 'success' ? 'text-green-800' : 'text-red-800'}`}>
                                            {message.text}
                                        </h3>
                                    </div>
                                </div>
                            )}

                            <div>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                                >
                                    {loading ? (
                                        <Loader2 className="animate-spin h-5 w-5" />
                                    ) : (
                                        <>
                                            Update Password
                                            <ArrowRight className="ml-2 h-5 w-5" />
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    )
}
