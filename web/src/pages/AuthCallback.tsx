import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { authHelpers } from '../lib/auth-helpers'
import { Loader2 } from 'lucide-react'

export default function AuthCallback() {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()

    useEffect(() => {
        const handleAuth = async () => {
            const { data: { session }, error } = await supabase.auth.getSession()

            if (error) {
                console.error('Auth callback error:', error)
                navigate('/login')
                return
            }

            // Check if this is a password recovery callback
            const type = searchParams.get('type')
            if (type === 'recovery') {
                navigate('/reset-password?type=recovery', { replace: true })
                return
            }

            const next = authHelpers.consumeReturnTo()

            if (session) {
                // Auto-link participant to user on successful auth
                try {
                    await supabase.rpc('link_current_user_to_participant')
                } catch (e) {
                    // Non-critical, ignore errors
                    console.log('Participant link attempt:', e)
                }

                navigate(next, { replace: true })
            } else {
                // If no session yet, wait for the onAuthStateChange in AuthContext to fire
                const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
                    if (event === 'SIGNED_IN' && session) {
                        // Auto-link participant
                        try {
                            await supabase.rpc('link_current_user_to_participant')
                        } catch (e) {
                            console.log('Participant link attempt:', e)
                        }

                        navigate(next, { replace: true })
                    }
                })

                return () => subscription.unsubscribe()
            }
        }

        handleAuth()
    }, [navigate, searchParams])

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-600 mx-auto" />
                <p className="mt-2 text-gray-600">Completing sign in...</p>
            </div>
        </div>
    )
}
