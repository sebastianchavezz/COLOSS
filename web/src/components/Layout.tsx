import React, { useEffect, useState, useRef, useCallback } from 'react'
import { Link, useParams, useLocation, Outlet } from 'react-router-dom'
import { Calendar, Settings, Users, CreditCard, LayoutDashboard } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Organization } from '../types/supabase'
import {
    SidebarProvider,
    Sidebar,
    SidebarHeader,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarItem,
    SidebarToggle,
    SidebarMobileTrigger,
    useSidebar
} from './ui/sidebar'

/**
 * Layout State Machine:
 * - 'loading': Initial state, checking auth and fetching org
 * - 'needsLogin': User not authenticated
 * - 'needsBootstrap': Org not found, user can create it
 * - 'ready': Org found, show main UI
 * - 'error': Something went wrong
 */
type LayoutState = 'loading' | 'needsLogin' | 'needsBootstrap' | 'ready' | 'error'

function SidebarLogo() {
    const { isCollapsed } = useSidebar()
    const { orgSlug } = useParams<{ orgSlug: string }>()

    return (
        <Link to={`/org/${orgSlug}`} className="flex items-center">
            {isCollapsed ? (
                <div className="h-8 w-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">
                    C
                </div>
            ) : (
                <img src="/coloss-logo.png" alt="COLOSS" className="h-8 w-auto" />
            )}
        </Link>
    )
}

function OrgSidebar({ orgSlug }: { orgSlug: string }) {
    const navItems = [
        { name: 'Dashboard', href: `/org/${orgSlug}`, icon: LayoutDashboard, end: true },
        { name: 'Events', href: `/org/${orgSlug}/events`, icon: Calendar },
        { name: 'Team', href: `/org/${orgSlug}/team`, icon: Users },
        { name: 'Finance', href: `/org/${orgSlug}/finance`, icon: CreditCard },
        { name: 'Settings', href: `/org/${orgSlug}/settings`, icon: Settings },
    ]

    return (
        <Sidebar>
            <SidebarHeader className="justify-between">
                <SidebarLogo />
                <SidebarToggle />
            </SidebarHeader>

            <SidebarContent>
                <SidebarGroup>
                    {navItems.map((item) => (
                        <SidebarItem
                            key={item.name}
                            icon={item.icon}
                            label={item.name}
                            href={item.href}
                            end={item.end}
                        />
                    ))}
                </SidebarGroup>
            </SidebarContent>

            <SidebarFooter>
                <div className="flex items-center justify-center">
                    <div className="h-8 w-8 rounded-full bg-neutral-800 flex items-center justify-center">
                        <Users className="h-4 w-4 text-neutral-400" />
                    </div>
                </div>
            </SidebarFooter>
        </Sidebar>
    )
}

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
     */
    useEffect(() => {
        const currentRequestId = ++fetchRequestId.current
        let cancelled = false
        const startTime = performance.now()

        console.log(`[${currentRequestId}] Init sequence started`, {
            orgSlug,
            currentState: state
        })

        const transitionTo = (newState: LayoutState, msg?: string) => {
            if (loadingTimeout.current) {
                clearTimeout(loadingTimeout.current)
                loadingTimeout.current = null
            }
            const duration = Math.round(performance.now() - startTime)
            console.log(`[${currentRequestId}] → Transition to ${newState} (${duration}ms)`, msg || '')
            setState(newState)
        }

        if (state === 'loading') {
            loadingTimeout.current = setTimeout(() => {
                if (!cancelled && state === 'loading') {
                    console.error(`[${currentRequestId}] ⚠️  DIAGNOSTIC TIMEOUT after 30s`)
                    transitionTo('error')
                    setErrorMessage('Timeout: initialize() hung. Check console for details.')
                }
            }, 30000)
        }

        async function initialize() {
            try {
                const { data: { session }, error: authError } = await supabase.auth.getSession()

                if (cancelled || currentRequestId !== fetchRequestId.current) return

                if (authError) {
                    transitionTo('error')
                    setErrorMessage(`Auth error: ${authError.message}`)
                    return
                }

                if (!session || !session.access_token) {
                    transitionTo('needsLogin')
                    return
                }

                if (!orgSlug) {
                    transitionTo('error')
                    setErrorMessage('Geen organisatie slug in URL')
                    return
                }

                const { data, error } = await supabase
                    .from('orgs')
                    .select('*')
                    .eq('slug', orgSlug)
                    .maybeSingle()

                if (cancelled || currentRequestId !== fetchRequestId.current) return

                if (error) {
                    transitionTo('error')
                    setErrorMessage(`Database error: ${error.message}`)
                    return
                }

                if (data) {
                    setOrg(data)
                    transitionTo('ready')
                } else {
                    transitionTo('needsBootstrap')
                }

            } catch (err: any) {
                if (cancelled || currentRequestId !== fetchRequestId.current) return
                transitionTo('error')
                setErrorMessage(err.message ?? 'Onbekende fout')
            }
        }

        initialize()

        return () => {
            cancelled = true
            if (loadingTimeout.current) {
                clearTimeout(loadingTimeout.current)
                loadingTimeout.current = null
            }
        }
    }, [orgSlug])

    const handleBootstrap = useCallback(async () => {
        if (bootstrapInProgress.current) return

        bootstrapInProgress.current = true
        setState('loading')
        setErrorMessage(null)

        try {
            const { data: { session } } = await supabase.auth.getSession()

            if (!session || !session.access_token) {
                setState('needsLogin')
                setErrorMessage('Sessie verlopen of ongeldig. Log opnieuw in.')
                return
            }

            const { data: { user }, error: userError } = await supabase.auth.getUser()

            if (userError || !user) {
                setState('needsLogin')
                setErrorMessage('Token verificatie mislukt. Log opnieuw in.')
                return
            }

            const { data, error: fnError } = await supabase.functions.invoke('bootstrap-org', {
                body: { slug: orgSlug ?? 'demo', name: 'Demo Organisatie' }
            })

            if (fnError) throw new Error(fnError.message ?? 'Function invoke failed')
            if (data?.error) throw new Error(data.error)

            if (data?.org) {
                setOrg(data.org)
                setState('ready')
            } else {
                throw new Error('Geen org data ontvangen')
            }

        } catch (err: any) {
            setState('error')
            setErrorMessage(`Fout: ${err.message}`)
        } finally {
            bootstrapInProgress.current = false
        }
    }, [orgSlug])

    // ========================================
    // RENDER BASED ON STATE
    // ========================================

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
        return <div className="p-8 text-red-600">Inconsistent state: ready but no org</div>
    }

    // Check if we're on an event detail page
    const eventDetailMatch = location.pathname.match(/^\/org\/[^/]+\/events\/([^/]+)/)
    const isEventDetailPage = eventDetailMatch && eventDetailMatch[1] !== 'new'

    // If on event detail page, render without main sidebar (EventDetail has its own)
    if (isEventDetailPage) {
        return (
            <div className="min-h-screen bg-gray-50">
                {children}
                <Outlet context={{ org }} />
            </div>
        )
    }

    return (
        <SidebarProvider>
            <div className="min-h-screen bg-gray-50 flex">
                <SidebarMobileTrigger />
                <OrgSidebar orgSlug={orgSlug!} />

                {/* Main Content */}
                <div className="flex-1 flex flex-col min-w-0">
                    <header className="h-16 bg-white border-b border-gray-200 px-8 flex items-center justify-between flex-shrink-0">
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
        </SidebarProvider>
    )
}
