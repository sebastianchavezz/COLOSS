import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { authHelpers } from '@/lib/auth-helpers'
import { Loader2 } from 'lucide-react'

export function AuthCallback() {
    const navigate = useNavigate()

    useEffect(() => {
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
        <div className="h-full flex items-center justify-center bg-white">
            <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin text-[#0047FF] mx-auto" />
                <p className="mt-2 text-gray-600">Completing sign in...</p>
            </div>
        </div>
    )
}
