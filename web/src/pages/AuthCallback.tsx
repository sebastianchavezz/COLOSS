import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { authHelpers } from '../lib/auth-helpers'
import { Loader2 } from 'lucide-react'
import { Session } from '@supabase/supabase-js'

/**
 * Extract first_name and last_name from Supabase session metadata.
 * Handles multiple OAuth provider formats:
 * - Email signup: user_metadata.first_name + user_metadata.last_name
 * - Google OAuth: user_metadata.full_name or user_metadata.name (split on space)
 */
function getNameFromSession(session: Session): { firstName: string | null; lastName: string | null } {
    const metadata = session?.user?.user_metadata || {}

    // Try direct first_name/last_name fields (email signup)
    if (metadata.first_name || metadata.last_name) {
        return {
            firstName: metadata.first_name || null,
            lastName: metadata.last_name || null,
        }
    }

    // Try full_name (Google OAuth)
    if (metadata.full_name) {
        const [firstName, ...lastNameParts] = metadata.full_name.split(' ')
        return {
            firstName: firstName || null,
            lastName: lastNameParts.length > 0 ? lastNameParts.join(' ') : null,
        }
    }

    // Try name field (alternative Google format)
    if (metadata.name) {
        const [firstName, ...lastNameParts] = metadata.name.split(' ')
        return {
            firstName: firstName || null,
            lastName: lastNameParts.length > 0 ? lastNameParts.join(' ') : null,
        }
    }

    return { firstName: null, lastName: null }
}

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
                // Auto-link or create participant for the authenticated user
                try {
                    const { firstName, lastName } = getNameFromSession(session)
                    await supabase.rpc('create_or_link_participant', {
                        p_first_name: firstName,
                        p_last_name: lastName,
                    })
                } catch (e) {
                    // Non-critical, ignore errors
                    console.log('Participant link attempt:', e)
                }

                navigate(next, { replace: true })
            } else {
                // If no session yet, wait for the onAuthStateChange in AuthContext to fire
                const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
                    if (event === 'SIGNED_IN' && session) {
                        // Auto-link or create participant
                        try {
                            const { firstName, lastName } = getNameFromSession(session)
                            await supabase.rpc('create_or_link_participant', {
                                p_first_name: firstName,
                                p_last_name: lastName,
                            })
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
