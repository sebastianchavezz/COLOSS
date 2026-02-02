import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { Mail, Lock, Loader2, ArrowRight, ArrowLeft } from 'lucide-react'

import { authHelpers } from '../lib/auth-helpers'

export default function Login() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [message, setMessage] = useState<{ type: 'error' | 'success', text: string } | null>(null)
    const [mode, setMode] = useState<'magic_link' | 'password'>('magic_link')

    const navigate = useNavigate()
    const location = useLocation()

    // Get return path from location state or default to dashboard
    const from = location.state?.from?.pathname || '/'

    const handleGoogleLogin = async () => {
        try {
            setLoading(true)
            authHelpers.saveReturnTo(from)
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: `${window.location.origin}/auth/callback`,
                },
            })
            if (error) throw error
        } catch (error: any) {
            setMessage({ type: 'error', text: error.message })
            setLoading(false)
        }
    }

    const handleMagicLinkLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        try {
            setLoading(true)
            authHelpers.saveReturnTo(from)
            const { error } = await supabase.auth.signInWithOtp({
                email,
                options: {
                    emailRedirectTo: `${window.location.origin}/auth/callback`,
                },
            })
            if (error) throw error
            setMessage({ type: 'success', text: 'Check your email for the login link!' })
        } catch (error: any) {
            setMessage({ type: 'error', text: error.message })
        } finally {
            setLoading(false)
        }
    }

    const handlePasswordLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        try {
            setLoading(true)
            const { error } = await supabase.auth.signInWithPassword({
                email,
                password,
            })
            if (error) throw error
            navigate(from, { replace: true })
        } catch (error: any) {
            setMessage({ type: 'error', text: error.message })
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
            {/* Back Button */}
            <div className="absolute top-4 left-4">
                <Link
                    to="/"
                    className="flex items-center gap-2 text-gray-600 hover:text-black text-sm font-medium"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Terug
                </Link>
            </div>

            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <Link to="/" className="block text-center text-2xl font-bold tracking-tight text-gray-900">
                    COLOSS
                </Link>
                <h2 className="mt-4 text-center text-3xl font-extrabold text-gray-900">
                    Inloggen
                </h2>
                <p className="mt-2 text-center text-sm text-gray-600">
                    Or{' '}
                    <Link to="/signup" className="font-medium text-indigo-600 hover:text-indigo-500">
                        create a new account
                    </Link>
                </p>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">

                    {/* Google Login */}
                    <div>
                        <button
                            onClick={handleGoogleLogin}
                            disabled={loading}
                            className="w-full flex justify-center items-center py-2.5 px-4 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                        >
                            <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
                                <path
                                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                    fill="#4285F4"
                                />
                                <path
                                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                    fill="#34A853"
                                />
                                <path
                                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                    fill="#FBBC05"
                                />
                                <path
                                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                    fill="#EA4335"
                                />
                            </svg>
                            Continue with Google
                        </button>
                    </div>

                    <div className="mt-6 relative">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-gray-300" />
                        </div>
                        <div className="relative flex justify-center text-sm">
                            <span className="px-2 bg-white text-gray-500">Or continue with email</span>
                        </div>
                    </div>

                    <div className="mt-6">
                        <form onSubmit={mode === 'magic_link' ? handleMagicLinkLogin : handlePasswordLogin} className="space-y-6">
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

                            {mode === 'password' && (
                                <div>
                                    <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                                        Password
                                    </label>
                                    <div className="mt-1 relative rounded-md shadow-sm">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                            <Lock className="h-5 w-5 text-gray-400" aria-hidden="true" />
                                        </div>
                                        <input
                                            id="password"
                                            name="password"
                                            type="password"
                                            autoComplete="current-password"
                                            required
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-10 sm:text-sm border-gray-300 rounded-md h-10 border px-3"
                                        />
                                    </div>
                                </div>
                            )}

                            {message && (
                                <div className={`rounded-md p-4 ${message.type === 'success' ? 'bg-green-50' : 'bg-red-50'}`}>
                                    <div className="flex">
                                        <div className="ml-3">
                                            <h3 className={`text-sm font-medium ${message.type === 'success' ? 'text-green-800' : 'text-red-800'}`}>
                                                {message.text}
                                            </h3>
                                        </div>
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
                                            {mode === 'magic_link' ? 'Send Magic Link' : 'Sign In'}
                                            <ArrowRight className="ml-2 h-5 w-5" />
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>

                        <div className="mt-4 text-center space-y-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setMode(mode === 'magic_link' ? 'password' : 'magic_link')
                                    setMessage(null)
                                }}
                                className="text-sm text-indigo-600 hover:text-indigo-500"
                            >
                                {mode === 'magic_link' ? 'Use password instead' : 'Use magic link instead'}
                            </button>
                            {mode === 'password' && (
                                <div>
                                    <Link
                                        to="/reset-password"
                                        className="text-sm text-gray-500 hover:text-gray-700"
                                    >
                                        Forgot your password?
                                    </Link>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
