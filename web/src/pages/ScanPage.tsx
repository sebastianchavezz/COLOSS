/**
 * ScanPage - F007 Ticket Scanning
 *
 * Manual token input voor ticket check-in.
 * Gebruikt de scan_ticket RPC (F007 S1).
 */

import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { QrCode, CheckCircle, XCircle, ArrowLeft, Loader2, AlertTriangle, Clock, BarChart3 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { clsx } from 'clsx'

interface ScanResult {
    result: string  // VALID, INVALID, ALREADY_USED, etc.
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
    total_scans: number
    valid_scans: number
    invalid_scans: number
    checked_in_tickets: number
    check_in_percentage: number
}

export function ScanPage() {
    const { eventSlug } = useParams<{ eventSlug: string }>()
    const [event, setEvent] = useState<{ id: string, name: string } | null>(null)
    const [loading, setLoading] = useState(true)
    const [tokenInput, setTokenInput] = useState('')
    const [scanResult, setScanResult] = useState<ScanResult | null>(null)
    const [processing, setProcessing] = useState(false)
    const [stats, setStats] = useState<ScanStats | null>(null)

    // Fetch event ID from slug
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
                loadStats(data.id)
            }
            setLoading(false)
        }
        fetchEvent()
    }, [eventSlug])

    // Load scan statistics
    async function loadStats(eventId: string) {
        const { data } = await supabase.rpc('get_scan_stats', {
            _event_id: eventId,
            _time_window_minutes: 60
        })

        if (data && !data.error) {
            setStats(data)
        }
    }

    const handleScan = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!tokenInput.trim() || !event) return

        setProcessing(true)
        setScanResult(null)

        try {
            // Call scan_ticket RPC
            const { data, error } = await supabase.rpc('scan_ticket', {
                _event_id: event.id,
                _token: tokenInput.trim(),
                _device_id: `web-${navigator.userAgent.slice(0, 20)}`,
                _ip_address: null,  // Server-side extraction would be better
                _user_agent: navigator.userAgent
            })

            if (error) {
                console.error('Scan error:', error)
                setScanResult({
                    result: 'ERROR',
                    message: error.message
                })
            } else if (data.error) {
                // RPC returned real error (UNAUTHORIZED, SCANNING_DISABLED, etc.)
                setScanResult({
                    result: 'ERROR',
                    message: data.error + (data.message ? ': ' + data.message : '')
                })
            } else if (data.result) {
                // Scan result (VALID, INVALID, ALREADY_USED, etc.)
                setScanResult(data)

                // Clear input on successful scan
                if (data.result === 'VALID') {
                    setTokenInput('')
                }

                // Reload stats
                loadStats(event.id)
            } else {
                // Unexpected response format
                console.error('Unexpected response:', data)
                setScanResult({
                    result: 'ERROR',
                    message: 'Unexpected response from server'
                })
            }

        } catch (err: any) {
            console.error('Scan exception:', err)
            setScanResult({
                result: 'ERROR',
                message: err.message || 'Unknown error'
            })
        } finally {
            setProcessing(false)
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
            </div>
        )
    }

    if (!event) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <p className="text-gray-500">Event not found</p>
                    <Link to="/" className="text-indigo-600 hover:underline mt-2 inline-block">
                        Go back
                    </Link>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-50 p-4">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
                    <div className="flex items-center justify-between mb-4">
                        <Link
                            to={`/org/demo/events/${eventSlug}`}
                            className="text-indigo-600 hover:text-indigo-800 flex items-center"
                        >
                            <ArrowLeft className="h-4 w-4 mr-1" />
                            Terug
                        </Link>
                        <h1 className="text-2xl font-bold text-gray-900">Ticket Scannen</h1>
                    </div>

                    <div>
                        <h2 className="text-lg font-medium text-gray-900">{event.name}</h2>
                        <p className="text-sm text-gray-500 mt-1">
                            Voer ticket token in (camera scan komt later)
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Left: Scan Form */}
                    <div className="md:col-span-2">
                        <div className="bg-white rounded-lg shadow-sm p-6">
                            <form onSubmit={handleScan} className="space-y-4">
                                <div>
                                    <label htmlFor="token" className="block text-sm font-medium text-gray-700 mb-2">
                                        Ticket Token
                                    </label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                            <QrCode className="h-5 w-5 text-gray-400" />
                                        </div>
                                        <input
                                            type="text"
                                            name="token"
                                            id="token"
                                            className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                            placeholder="Plak token hier..."
                                            value={tokenInput}
                                            onChange={(e) => setTokenInput(e.target.value)}
                                            disabled={processing}
                                            autoFocus
                                        />
                                    </div>
                                </div>

                                <button
                                    type="submit"
                                    disabled={processing || !tokenInput.trim()}
                                    className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {processing ? (
                                        <>
                                            <Loader2 className="animate-spin h-5 w-5 mr-2" />
                                            Scannen...
                                        </>
                                    ) : (
                                        <>
                                            <QrCode className="h-5 w-5 mr-2" />
                                            Scan Ticket
                                        </>
                                    )}
                                </button>
                            </form>

                            {/* Result Display */}
                            {scanResult && (
                                <div className="mt-6">
                                    <ScanResultCard result={scanResult} />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right: Stats */}
                    <div className="md:col-span-1">
                        <div className="bg-white rounded-lg shadow-sm p-6">
                            <div className="flex items-center mb-4">
                                <BarChart3 className="h-5 w-5 text-indigo-600 mr-2" />
                                <h3 className="text-sm font-medium text-gray-900">Statistieken</h3>
                            </div>

                            {stats ? (
                                <div className="space-y-3">
                                    <StatItem
                                        label="Ingecheckt"
                                        value={`${stats.checked_in_tickets} (${stats.check_in_percentage}%)`}
                                    />
                                    <StatItem label="Scans totaal" value={stats.total_scans} />
                                    <StatItem label="Geldig" value={stats.valid_scans} color="green" />
                                    <StatItem label="Ongeldig" value={stats.invalid_scans} color="red" />
                                </div>
                            ) : (
                                <p className="text-sm text-gray-500">Laden...</p>
                            )}

                            <button
                                onClick={() => event && loadStats(event.id)}
                                className="mt-4 w-full text-sm text-indigo-600 hover:text-indigo-800"
                            >
                                Ververs
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

// Result Card Component
function ScanResultCard({ result }: { result: ScanResult }) {
    const isSuccess = result.result === 'VALID'
    const isAlreadyUsed = result.result === 'ALREADY_USED'
    const isRateLimited = result.result === 'RATE_LIMIT_EXCEEDED'
    // isInvalidScan and isSystemError both fall through to the default red styling

    const bgColor = isSuccess
        ? 'bg-green-50 border-green-200'
        : isAlreadyUsed
        ? 'bg-yellow-50 border-yellow-200'
        : isRateLimited
        ? 'bg-orange-50 border-orange-200'
        : 'bg-red-50 border-red-200'

    const textColor = isSuccess
        ? 'text-green-800'
        : isAlreadyUsed
        ? 'text-yellow-800'
        : isRateLimited
        ? 'text-orange-800'
        : 'text-red-800'

    const Icon = isSuccess
        ? CheckCircle
        : isAlreadyUsed
        ? Clock
        : isRateLimited
        ? AlertTriangle
        : XCircle

    return (
        <div className={clsx('rounded-md p-4 border', bgColor)}>
            <div className="flex items-start">
                <div className="flex-shrink-0">
                    <Icon
                        className={clsx(
                            'h-6 w-6',
                            isSuccess
                                ? 'text-green-400'
                                : isAlreadyUsed
                                ? 'text-yellow-400'
                                : isRateLimited
                                ? 'text-orange-400'
                                : 'text-red-400'
                        )}
                    />
                </div>
                <div className="ml-3 flex-1">
                    <h3 className={clsx('text-lg font-medium', textColor)}>{getResultLabel(result.result)}</h3>

                    {result.message && <p className={clsx('text-sm mt-1', textColor)}>{result.message}</p>}

                    {result.ticket && (
                        <div className="mt-3 space-y-1">
                            <p className="text-sm font-medium text-gray-900">Ticket Details:</p>
                            <p className="text-sm text-gray-700">
                                <span className="font-medium">Type:</span> {result.ticket.type_name}
                            </p>
                            {result.ticket.participant_name && (
                                <p className="text-sm text-gray-700">
                                    <span className="font-medium">Deelnemer:</span> {result.ticket.participant_name}
                                </p>
                            )}
                            {result.ticket.participant_email && (
                                <p className="text-sm text-gray-700">
                                    <span className="font-medium">Email:</span> {result.ticket.participant_email}
                                </p>
                            )}
                            {result.ticket.checked_in_at && (
                                <p className="text-sm text-gray-700">
                                    <span className="font-medium">Tijd:</span>{' '}
                                    {new Date(result.ticket.checked_in_at).toLocaleString('nl-NL')}
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

// Stat Item Component
function StatItem({ label, value, color }: { label: string; value: string | number; color?: 'green' | 'red' }) {
    return (
        <div className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
            <span className="text-sm text-gray-600">{label}</span>
            <span
                className={clsx(
                    'text-sm font-medium',
                    color === 'green'
                        ? 'text-green-600'
                        : color === 'red'
                        ? 'text-red-600'
                        : 'text-gray-900'
                )}
            >
                {value}
            </span>
        </div>
    )
}

// Helper: Get user-friendly label for scan result
function getResultLabel(result: string): string {
    const labels: Record<string, string> = {
        VALID: '✅ Geldig - Ingecheckt',
        INVALID: '❌ Ongeldig Token',
        ALREADY_USED: '⏱️ Reeds Gescand',
        CANCELLED: '🚫 Geannuleerd',
        REFUNDED: '💰 Terugbetaald',
        NOT_IN_EVENT: '⚠️ Verkeerd Evenement',
        RATE_LIMIT_EXCEEDED: '⏸️ Te Veel Scans',
        ERROR: '❌ Fout',
    }
    return labels[result] || result
}
