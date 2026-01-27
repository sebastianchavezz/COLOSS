import React, { useEffect, useState, useRef, useCallback } from 'react'
import { Link, useParams, useLocation, Outlet } from 'react-router-dom'
import { Calendar, Settings, Users, CreditCard, LayoutDashboard } from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../lib/supabase'
import type { Organization } from '../types/supabase'

/**
 * Layout State Machine:
 * - 'loading': Initial state, checking auth and fetching org
 * - 'needsLogin': User not authenticated
 * - 'needsBootstrap': Org not found, user can create it
 * - 'ready': Org found, show main UI
 * - 'error': Something went wrong
 */
type LayoutState = 'loading' | 'needsLogin' | 'needsBootstrap' | 'ready' | 'error'

export function Layout({ children }: { children?: React.ReactNode }) {
    const { orgSlug } = useParams<{ orgSlug: string }>()
    const location = useLocation()

    // State
    const [org, setOrg] = useState<Organization | null>(null)
    const [state, setState] = useState<LayoutState>('loading')
    const [errorMessage, setErrorMessage] = useState<string | null>(null)

    // Guards
    const fetchRequestId = useRef(0)
    const bootstrapInProgress = useRef(false)
    const loadingTimeout = useRef<number | null>(null)

    /**
     * Single effect that handles entire initialization flow:
     * 1. Check auth
     * 2. Fetch org
     * 3. Transition to appropriate state
     * 
     * IMPORTANT: Timeout is only diagnostic. It clears automatically on ANY state transition.
     */
    useEffect(() => {
        const currentRequestId = ++fetchRequestId.current
        let cancelled = false
        const startTime = performance.now()

        console.log(`[${currentRequestId}] Init sequence started`, {
            orgSlug,
            currentState: state
        })

        // Helper: Clear timeout and log transition
        const transitionTo = (newState: LayoutState, msg?: string) => {
            if (loadingTimeout.current) {
                clearTimeout(loadingTimeout.current)
                loadingTimeout.current = null
            }
            const duration = Math.round(performance.now() - startTime)
            console.log(`[${currentRequestId}] → Transition to ${newState} (${duration}ms)`, msg || '')
            setState(newState)
        }

        // Set a diagnostic timeout (should NEVER fire if logic is correct)
        // Only start if we're actually in loading state
        if (state === 'loading') {
            loadingTimeout.current = setTimeout(() => {
                if (!cancelled && state === 'loading') {
                    console.error(`[${currentRequestId}] ⚠️  DIAGNOSTIC TIMEOUT after 30s`, {
                        orgSlug,
                        currentState: state,
                        requestId: currentRequestId,
                        latestRequestId: fetchRequestId.current,
                        message: 'This should never happen if state transitions are working correctly'
                    })
                    transitionTo('error')
                    setErrorMessage('Timeout: initialize() hung. Check console for details.')
                }
            }, 30000)
        }

        async function initialize() {
            try {
                // =====================
                // STEP 1: CHECK AUTH - STRICT REQUIREMENT
                // =====================
                const authStart = performance.now()
                console.log(`[${currentRequestId}] Step 1: Checking auth...`)

                const { data: { session }, error: authError } = await supabase.auth.getSession()
                const authDuration = Math.round(performance.now() - authStart)

                if (authDuration > 2000) {
                    console.warn(`[${currentRequestId}] ⚠️  Auth check slow: ${authDuration}ms`)
                }

                console.log(`[${currentRequestId}] Auth result (${authDuration}ms):`, {
                    hasSession: !!session,
                    userId: session?.user?.id,
                    hasAccessToken: !!session?.access_token,
                    tokenStart: session?.access_token?.slice(0, 20),
                    error: authError?.message
                })

                // Guard: Check if this request is stale
                if (cancelled || currentRequestId !== fetchRequestId.current) {
                    console.log(`[${currentRequestId}] Cancelled or stale, aborting`)
                    return
                }

                if (authError) {
                    console.error(`[${currentRequestId}] Auth error:`, authError)
                    transitionTo('error')
                    setErrorMessage(`Auth error: ${authError.message}`)
                    return
                }

                // STRICT: No session = no access to org features
                if (!session || !session.access_token) {
                    console.log(`[${currentRequestId}] ❌ No valid session, MUST login`)
                    transitionTo('needsLogin')
                    return
                }

                console.log(`[${currentRequestId}] ✅ Valid session found`)

                // =====================
                // STEP 2: VALIDATE SLUG
                // =====================
                if (!orgSlug) {
                    console.error(`[${currentRequestId}] No orgSlug in URL`)
                    transitionTo('error')
                    setErrorMessage('Geen organisatie slug in URL')
                    return
                }

                // =====================
                // STEP 3: FETCH ORG (auth required)
                // =====================
                const fetchStart = performance.now()
                console.log(`[${currentRequestId}] Step 2: Fetching org "${orgSlug}" (authenticated)...`)

                const { data, error, status } = await supabase
                    .from('orgs')
                    .select('*')
                    .eq('slug', orgSlug)
                    .maybeSingle()

                const fetchDuration = Math.round(performance.now() - fetchStart)

                if (fetchDuration > 2000) {
                    console.warn(`[${currentRequestId}] ⚠️  Org fetch slow: ${fetchDuration}ms`, {
                        status,
                        error: error?.code
                    })
                }

                console.log(`[${currentRequestId}] Org fetch result (${fetchDuration}ms):`, {
                    hasData: !!data,
                    error: error?.message,
                    code: error?.code,
                    status,
                    data: data ? { id: data.id, name: data.name } : null
                })

                // Guard: Check if this request is stale
                if (cancelled || currentRequestId !== fetchRequestId.current) {
                    console.log(`[${currentRequestId}] Cancelled or stale after fetch, aborting`)
                    return
                }

                // Handle fetch error
                if (error) {
                    console.error(`[${currentRequestId}] Fetch error:`, error)
                    transitionTo('error')
                    setErrorMessage(`Database error: ${error.message}`)
                    return
                }

                // =====================
                // STEP 4: TRANSITION (session guaranteed at this point)
                // =====================
                if (data) {
                    console.log(`[${currentRequestId}] ✅ Org found: "${data.name}"`)
                    setOrg(data)
                    transitionTo('ready')
                } else {
                    console.log(`[${currentRequestId}] ℹ️  Org "${orgSlug}" not found, can bootstrap`)
                    transitionTo('needsBootstrap')
                }

            } catch (err: any) {
                // Guard: Only process if not cancelled/stale
                if (cancelled || currentRequestId !== fetchRequestId.current) {
                    console.log(`[${currentRequestId}] Exception in cancelled request, ignoring`)
                    return
                }

                console.error(`[${currentRequestId}] Unexpected error in init:`, err)
                transitionTo('error')
                setErrorMessage(err.message ?? 'Onbekende fout')
            }
        }

        initialize()

        return () => {
            console.log(`[${currentRequestId}] Cleanup`)
            cancelled = true
            if (loadingTimeout.current) {
                clearTimeout(loadingTimeout.current)
                loadingTimeout.current = null
            }
        }
    }, [orgSlug]) // Only re-run when orgSlug changes

    /**
     * Bootstrap handler - creates org via Edge Function.
     */
    const handleBootstrap = useCallback(async () => {
        if (bootstrapInProgress.current) {
            console.log('[Layout] Bootstrap already in progress')
            return
        }

        bootstrapInProgress.current = true
        setState('loading')
        setErrorMessage(null)

        try {
            // STRICT: Verify we have a valid auth session BEFORE invoking
            const { data: { session } } = await supabase.auth.getSession()

            console.log('[Layout] 🔍 Bootstrap session check:', {
                hasSession: !!session,
                userId: session?.user?.id,
                hasAccessToken: !!session?.access_token,
                tokenStart: session?.access_token?.slice(0, 20) + '...',
            })

            // HARD GUARD: No token = cannot invoke function
            if (!session || !session.access_token) {
                console.error('[Layout] ❌ GUARD: No access token, cannot invoke function')
                setState('needsLogin')
                setErrorMessage('Sessie verlopen of ongeldig. Log opnieuw in.')
                return
            }

            console.log('[Layout] ✅ Access token verified, proceeding with invoke')

            // ============================================================
            // DEBUG: Verify token + project match before invoke
            // ============================================================
            const token = session.access_token
            console.log('[Layout] 🔐 Token debug:', {
                tokenLength: token.length,
                tokenStart: token.slice(0, 30),
                tokenEnd: token.slice(-10),
                projectUrl: import.meta.env.VITE_SUPABASE_URL,
            })

            // Cross-check: does getUser work with this token?
            const { data: { user }, error: userError } = await supabase.auth.getUser()
            console.log('[Layout] 👤 getUser verification:', {
                userId: user?.id,
                email: user?.email,
                error: userError?.message,
            })

            if (userError || !user) {
                console.error('[Layout] ❌ getUser failed, token may be invalid')
                setState('needsLogin')
                setErrorMessage('Token verificatie mislukt. Log opnieuw in.')
                return
            }

            const payload = { slug: orgSlug ?? 'demo', name: 'Demo Organisatie' }
            console.log('[Layout] 🚀 Invoking bootstrap-org:', {
                ...payload,
                targetUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bootstrap-org`,
            })

            const { data, error: fnError } = await supabase.functions.invoke('bootstrap-org', {
                body: payload
            })

            console.log('[Layout] 📥 Bootstrap response:', { data, fnError })

            if (fnError) {
                throw new Error(fnError.message ?? 'Function invoke failed')
            }

            if (data?.error) {
                throw new Error(data.error)
            }

            if (data?.org) {
                console.log('[Layout] ✅ Org bootstrapped:', data.org)
                setOrg(data.org)
                setState('ready')
            } else {
                throw new Error('Geen org data ontvangen')
            }

        } catch (err: any) {
            console.error('[Layout] ❌ Bootstrap error:', err)
            setState('error')
            setErrorMessage(`Fout: ${err.message}`)
        } finally {
            bootstrapInProgress.current = false
        }
    }, [orgSlug])

    // ========================================
    // RENDER BASED ON STATE
    // ========================================

    console.log('[Layout] Rendering state:', state)

    if (state === 'loading') {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
                    <p className="text-gray-600">Laden...</p>
                </div>
            </div>
        )
    }

    if (state === 'needsLogin') {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center max-w-md">
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">Login vereist</h2>
                    <p className="text-gray-600 mb-6">Je moet ingelogd zijn om verder te gaan.</p>
                    <Link
                        to="/login"
                        className="inline-block px-6 py-3 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 font-medium"
                    >
                        Inloggen
                    </Link>
                </div>
            </div>
        )
    }

    if (state === 'error') {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center max-w-md">
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">Er ging iets mis</h2>
                    <p className="text-gray-600 mb-6">{errorMessage}</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-6 py-3 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 font-medium"
                    >
                        Probeer opnieuw
                    </button>
                </div>
            </div>
        )
    }

    if (state === 'needsBootstrap') {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <h2 className="text-2xl font-bold text-gray-900 mb-2 flex items-center justify-center gap-2">
                        Welkom bij <span className="text-indigo-600 font-bold">COLOSS</span>
                    </h2>
                    <p className="text-gray-600 mb-6">
                        De organisatie '{orgSlug}' bestaat nog niet.
                    </p>
                    <button
                        onClick={handleBootstrap}
                        disabled={bootstrapInProgress.current}
                        className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Maak '{orgSlug}' aan &amp; start
                    </button>
                </div>
            </div>
        )
    }

    // state === 'ready'
    if (!org) {
        console.error('[Layout] State is ready but org is null!')
        return <div className="p-8 text-red-600">Inconsistent state: ready but no org</div>
    }

    const navItems = [
        { name: 'Dashboard', href: `/org/${orgSlug}`, icon: LayoutDashboard },
        { name: 'Events', href: `/org/${orgSlug}/events`, icon: Calendar },
        { name: 'Team', href: `/org/${orgSlug}/team`, icon: Users },
        { name: 'Finance', href: `/org/${orgSlug}/finance`, icon: CreditCard },
        { name: 'Settings', href: `/org/${orgSlug}/settings`, icon: Settings },
    ]

    return (
        <div className="min-h-screen bg-gray-50 flex">
            {/* Sidebar */}
            <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
                <div className="h-16 flex items-center px-6 border-b border-gray-200">
                    <div className="text-2xl font-bold text-indigo-600">COLOSS</div>
                </div>
                <nav className="flex-1 p-4 space-y-1">
                    {navItems.map((item) => {
                        const isActive = location.pathname === item.href || location.pathname.startsWith(item.href + '/')
                        return (
                            <Link
                                key={item.name}
                                to={item.href}
                                className={clsx(
                                    'flex items-center px-4 py-2 text-sm font-medium rounded-md transition-colors',
                                    isActive
                                        ? 'bg-indigo-50 text-indigo-700'
                                        : 'text-gray-700 hover:bg-gray-100'
                                )}
                            >
                                <item.icon className="mr-3 h-5 w-5" />
                                {item.name}
                            </Link>
                        )
                    })}
                </nav>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col">
                <header className="h-16 bg-white border-b border-gray-200 px-8 flex items-center justify-between">
                    <h1 className="text-lg font-medium text-gray-900">{org.name}</h1>
                    <div className="flex items-center space-x-4">
                        <div className="h-8 w-8 rounded-full bg-gray-200" />
                    </div>
                </header>
                <main className="flex-1 p-8 overflow-auto">
                    {children}
                    <Outlet context={{ org }} />
                </main>
            </div>
        </div>
    )
}
