/**
 * MobileScanner Page
 *
 * Mobile-optimized camera scanner for ticket check-in.
 * Features:
 * - Fullscreen camera view
 * - Visual scan feedback (green/red/yellow)
 * - Haptic feedback
 * - Manual token input fallback
 * - Real-time stats
 */

import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
    ArrowLeft,
    Camera,
    CameraOff,
    RefreshCw,
    Loader2,
    CheckCircle,
    XCircle,
    Clock,
    Keyboard,
    AlertTriangle,
} from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useQrScanner } from '../hooks/useQrScanner'
import { getDeviceId } from '../lib/device-id'

interface ScanResult {
    result: string
    message?: string
    ticket?: {
        id: string
        type_name: string
        participant_name: string | null
        participant_email: string | null
        checked_in_at: string
    }
}

interface ScanStats {
    checked_in_tickets: number
    total_tickets: number
    check_in_percentage: number
}

export function MobileScanner() {
    const { eventSlug } = useParams<{ eventSlug: string }>()
    const navigate = useNavigate()
    const { user, loading: authLoading } = useAuth()

    const [event, setEvent] = useState<{ id: string; name: string } | null>(null)
    const [loading, setLoading] = useState(true)
    const [processing, setProcessing] = useState(false)
    const [scanResult, setScanResult] = useState<ScanResult | null>(null)
    const [showResult, setShowResult] = useState(false)
    const [stats, setStats] = useState<ScanStats | null>(null)
    const [manualMode, setManualMode] = useState(false)
    const [manualToken, setManualToken] = useState('')

    // QR Scanner hook
    const {
        isScanning,
        error: scannerError,
        cameras,
        cameraId,
        start: startScanner,
        stop: stopScanner,
        switchCamera,
    } = useQrScanner('qr-reader', {
        onScan: handleScan,
        onError: (err) => console.error('Scanner error:', err),
        debounceMs: 2000,
    })

    // Auth check - redirect to login if not authenticated
    useEffect(() => {
        if (!authLoading && !user) {
            const returnUrl = `/scan/m/${eventSlug}`
            navigate(`/login?returnUrl=${encodeURIComponent(returnUrl)}`)
        }
    }, [user, authLoading, navigate, eventSlug])

    // Fetch event data
    useEffect(() => {
        async function fetchEvent() {
            if (!eventSlug) return

            const { data } = await supabase
                .from('events')
                .select('id, name')
                .eq('slug', eventSlug)
                .single()

            if (data) {
                setEvent(data)
                fetchStats(data.id)
            }
            setLoading(false)
        }

        if (user) {
            fetchEvent()
        }
    }, [eventSlug, user])

    // Fetch stats
    const fetchStats = useCallback(async (eventId: string) => {
        const { data } = await supabase.rpc('get_scan_stats', {
            _event_id: eventId,
            _time_window_minutes: 60,
        })

        if (data && !data.error) {
            setStats({
                checked_in_tickets: data.checked_in_tickets,
                total_tickets: data.total_tickets,
                check_in_percentage: data.check_in_percentage,
            })
        }
    }, [])

    // Handle scan
    async function handleScan(token: string) {
        if (!event || processing) return

        setProcessing(true)
        setScanResult(null)
        setShowResult(false)

        try {
            const { data, error } = await supabase.rpc('scan_ticket', {
                _event_id: event.id,
                _token: token,
                _device_id: getDeviceId(),
                _ip_address: null,
                _user_agent: navigator.userAgent,
            })

            if (error) {
                setScanResult({ result: 'ERROR', message: error.message })
            } else if (data.error) {
                setScanResult({
                    result: 'ERROR',
                    message: data.error + (data.message ? ': ' + data.message : ''),
                })
            } else {
                setScanResult(data)
                // Refresh stats on successful scan
                if (data.result === 'VALID') {
                    fetchStats(event.id)
                }
            }

            setShowResult(true)

            // Haptic feedback
            triggerHaptic(data?.result || 'ERROR')

            // Auto-hide result after 3 seconds
            setTimeout(() => setShowResult(false), 3000)
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Onbekende fout'
            setScanResult({ result: 'ERROR', message })
            setShowResult(true)
            setTimeout(() => setShowResult(false), 3000)
        } finally {
            setProcessing(false)
            setManualToken('')
        }
    }

    // Haptic feedback
    function triggerHaptic(result: string) {
        if ('vibrate' in navigator) {
            switch (result) {
                case 'VALID':
                    navigator.vibrate([100, 50, 100]) // Double short buzz
                    break
                case 'ALREADY_USED':
                    navigator.vibrate([200, 100, 200]) // Double medium buzz
                    break
                default:
                    navigator.vibrate(400) // Long buzz for errors
            }
        }
    }

    // Handle manual submit
    function handleManualSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (manualToken.trim()) {
            handleScan(manualToken.trim())
        }
    }

    // Start camera when event is loaded
    useEffect(() => {
        if (event && !manualMode && cameras.length > 0) {
            startScanner()
        }
        return () => {
            stopScanner()
        }
    }, [event, manualMode, cameras.length])

    // Loading states
    if (authLoading || loading) {
        return (
            <div className="min-h-screen bg-gray-900 flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-white" />
            </div>
        )
    }

    if (!event) {
        return (
            <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
                <div className="text-center">
                    <XCircle className="h-12 w-12 text-red-400 mx-auto mb-3" />
                    <p className="text-white mb-4">Event niet gevonden</p>
                    <Link to="/" className="text-indigo-400 hover:underline">
                        Terug naar home
                    </Link>
                </div>
            </div>
        )
    }

    // Get result styling
    const getResultStyle = () => {
        if (!scanResult) return {}
        switch (scanResult.result) {
            case 'VALID':
                return {
                    bg: 'bg-green-500/90',
                    icon: <CheckCircle className="h-12 w-12" />,
                    title: 'Geldig',
                }
            case 'ALREADY_USED':
                return {
                    bg: 'bg-yellow-500/90',
                    icon: <Clock className="h-12 w-12" />,
                    title: 'Reeds gescand',
                }
            case 'RATE_LIMIT_EXCEEDED':
                return {
                    bg: 'bg-orange-500/90',
                    icon: <AlertTriangle className="h-12 w-12" />,
                    title: 'Te snel',
                }
            default:
                return {
                    bg: 'bg-red-500/90',
                    icon: <XCircle className="h-12 w-12" />,
                    title: 'Ongeldig',
                }
        }
    }

    const resultStyle = getResultStyle()

    return (
        <div className="min-h-screen bg-gray-900 flex flex-col">
            {/* Header */}
            <header className="bg-gray-800 px-4 py-3 flex items-center justify-between">
                <button
                    onClick={() => navigate(-1)}
                    className="text-white p-1 -ml-1"
                >
                    <ArrowLeft className="h-6 w-6" />
                </button>
                <h1 className="text-white font-medium truncate px-4">
                    {event.name}
                </h1>
                <button
                    onClick={() => setManualMode(!manualMode)}
                    className={clsx(
                        'p-2 rounded-lg transition-colors',
                        manualMode
                            ? 'bg-indigo-600 text-white'
                            : 'text-gray-400 hover:text-white'
                    )}
                    title={manualMode ? 'Camera scannen' : 'Handmatig invoeren'}
                >
                    {manualMode ? <Camera className="h-5 w-5" /> : <Keyboard className="h-5 w-5" />}
                </button>
            </header>

            {/* Main Content */}
            <main className="flex-1 relative">
                {manualMode ? (
                    /* Manual Token Input */
                    <div className="p-4 h-full flex flex-col justify-center">
                        <form onSubmit={handleManualSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm text-gray-400 mb-2">
                                    Ticket Token
                                </label>
                                <input
                                    type="text"
                                    value={manualToken}
                                    onChange={(e) => setManualToken(e.target.value)}
                                    placeholder="Voer token in..."
                                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                    autoFocus
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={processing || !manualToken.trim()}
                                className="w-full py-3 bg-indigo-600 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                            >
                                {processing ? (
                                    <Loader2 className="h-5 w-5 animate-spin" />
                                ) : (
                                    'Scan Ticket'
                                )}
                            </button>
                        </form>
                    </div>
                ) : (
                    /* Camera View */
                    <div className="h-full flex flex-col">
                        {/* Camera preview */}
                        <div className="flex-1 relative bg-black">
                            <div
                                id="qr-reader"
                                className="w-full h-full"
                                style={{ minHeight: '300px' }}
                            />

                            {/* Scanner error */}
                            {scannerError && (
                                <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 p-4">
                                    <div className="text-center">
                                        <CameraOff className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                                        <p className="text-white mb-4">{scannerError}</p>
                                        <button
                                            onClick={() => setManualMode(true)}
                                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg"
                                        >
                                            Handmatig invoeren
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Processing overlay */}
                            {processing && (
                                <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50">
                                    <Loader2 className="h-12 w-12 animate-spin text-white" />
                                </div>
                            )}

                            {/* Result overlay */}
                            {showResult && scanResult && (
                                <div
                                    className={clsx(
                                        'absolute inset-0 flex flex-col items-center justify-center text-white p-4 transition-opacity duration-300',
                                        resultStyle.bg
                                    )}
                                >
                                    {resultStyle.icon}
                                    <h2 className="text-2xl font-bold mt-3">
                                        {resultStyle.title}
                                    </h2>
                                    {scanResult.ticket && (
                                        <div className="mt-3 text-center">
                                            <p className="text-lg">
                                                {scanResult.ticket.participant_name || 'Onbekend'}
                                            </p>
                                            <p className="text-sm opacity-80">
                                                {scanResult.ticket.type_name}
                                            </p>
                                            {scanResult.ticket.checked_in_at && (
                                                <p className="text-sm opacity-60 mt-1">
                                                    {new Date(
                                                        scanResult.ticket.checked_in_at
                                                    ).toLocaleTimeString('nl-NL', {
                                                        hour: '2-digit',
                                                        minute: '2-digit',
                                                    })}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                    {scanResult.message && (
                                        <p className="text-sm mt-2 opacity-80">
                                            {scanResult.message}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Camera controls */}
                        {cameras.length > 1 && !scannerError && (
                            <div className="bg-gray-800 px-4 py-3">
                                <button
                                    onClick={() => {
                                        const currentIdx = cameras.findIndex(
                                            (c) => c.id === cameraId
                                        )
                                        const nextIdx = (currentIdx + 1) % cameras.length
                                        switchCamera(cameras[nextIdx].id)
                                    }}
                                    className="w-full py-2 text-gray-300 hover:text-white flex items-center justify-center"
                                >
                                    <RefreshCw className="h-4 w-4 mr-2" />
                                    Wissel camera
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </main>

            {/* Stats Footer */}
            {stats && (
                <footer className="bg-gray-800 px-4 py-3 flex items-center justify-between">
                    <div className="text-gray-400 text-sm">Ingecheckt</div>
                    <div className="text-white font-medium">
                        {stats.checked_in_tickets} / {stats.total_tickets}
                        <span className="text-gray-400 text-sm ml-2">
                            ({stats.check_in_percentage}%)
                        </span>
                    </div>
                </footer>
            )}
        </div>
    )
}
