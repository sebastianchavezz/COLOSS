import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { authHelpers } from '../lib/auth-helpers'
import { Loader2 } from 'lucide-react'

export default function AuthCallback() {
    const navigate = useNavigate()

    useEffect(() => {
        // The AuthContext and supabase client handle the session restoration.
        // We just need to wait a brief moment or check session status and redirect.

        const handleAuth = async () => {
            const { data: { session }, error } = await supabase.auth.getSession()

            if (error) {
                console.error('Auth callback error:', error)
                navigate('/login')
                return
            }

            const next = authHelpers.consumeReturnTo()

            if (session) {
                navigate(next, { replace: true })
            } else {
                // If no session yet, wait for the onAuthStateChange in AuthContext to fire
                // or just redirect to login if it takes too long.
                // But usually getSession() is sufficient if the client handled the URL.

                // For PKCE, the exchange happens automatically.
                // We can listen for the SIGNED_IN event.
                const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
                    if (event === 'SIGNED_IN' && session) {
                        navigate(next, { replace: true })
                    }
                })

                return () => subscription.unsubscribe()
            }
        }

        handleAuth()
    }, [navigate])

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-600 mx-auto" />
                <p className="mt-2 text-gray-600">Completing sign in...</p>
            </div>
        </div>
    )
}
