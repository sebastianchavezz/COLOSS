/**
 * Scanner Setup Page
 *
 * Displays QR code for mobile scanner access and real-time statistics.
 * Part of event sidebar navigation.
 */

import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { QrCode, Copy, Check, RefreshCw, Users, Scan, AlertCircle, Wifi } from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'
import type { AppEvent, Organization } from '../../types/supabase'

type EventDetailContext = {
    event: AppEvent
    org: Organization
    refreshEvent: () => void
}

interface ScanStats {
    total_scans: number
    valid_scans: number
    invalid_scans: number
    checked_in_tickets: number
    total_tickets: number
    check_in_percentage: number
}

export function Scanner() {
    const context = useOutletContext<EventDetailContext | undefined>()
    const event = context?.event

    const [stats, setStats] = useState<ScanStats | null>(null)
    const [copied, setCopied] = useState(false)
    const [loading, setLoading] = useState(true)
    const [useNetworkUrl, setUseNetworkUrl] = useState(() => {
        // Default to network mode if on localhost
        return window.location.hostname === 'localhost'
    })
    const [networkHost, setNetworkHost] = useState(() => {
        // Load saved network host from localStorage
        return localStorage.getItem('coloss_network_host') || '192.168.129.5:5173'
    })

    // Save network host to localStorage when it changes
    useEffect(() => {
        localStorage.setItem('coloss_network_host', networkHost)
    }, [networkHost])

    // Build scanner URL - use network IP when in network mode
    const isLocalhost = window.location.hostname === 'localhost'
    const protocol = window.location.protocol // http: or https:
    const baseUrl = useNetworkUrl && isLocalhost
        ? `${protocol}//${networkHost}`
        : window.location.origin
    const scannerUrl = event
        ? `${baseUrl}/scan/m/${event.slug}`
        : ''

    // Fetch stats
    const fetchStats = useCallback(async () => {
        if (!event) return

        const { data } = await supabase.rpc('get_scan_stats', {
            _event_id: event.id,
            _time_window_minutes: 60,
        })

        if (data && !data.error) {
            setStats(data)
        }
        setLoading(false)
    }, [event])

    // Initial load and polling
    useEffect(() => {
        fetchStats()
        const interval = setInterval(fetchStats, 10000) // Poll every 10 seconds
        return () => clearInterval(interval)
    }, [fetchStats])

    // Copy URL handler
    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(scannerUrl)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch (err) {
            console.error('Copy failed:', err)
        }
    }

    if (!event) {
        return (
            <div className="p-4 text-gray-500">
                Event laden...
            </div>
        )
    }

    return (
        <div className="max-w-4xl">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900">Scanner Setup</h1>
                <p className="mt-1 text-sm text-gray-500">
                    Gebruik je eigen telefoon als ticket scanner
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* QR Code Section */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <div className="flex items-center mb-4">
                        <QrCode className="h-5 w-5 text-indigo-600 mr-2" />
                        <h2 className="text-lg font-medium text-gray-900">
                            Mobile Scanner
                        </h2>
                    </div>

                    <div className="flex justify-center mb-6">
                        <div className="bg-white p-4 rounded-lg border-2 border-gray-100">
                            <QRCodeSVG
                                value={scannerUrl}
                                size={200}
                                level="M"
                                includeMargin={false}
                            />
                        </div>
                    </div>

                    <div className="space-y-4">
                        {/* Network mode toggle (only shown on localhost) */}
                        {isLocalhost && (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center">
                                        <Wifi className="h-4 w-4 text-amber-600 mr-2" />
                                        <span className="text-sm font-medium text-amber-900">
                                            Netwerk Modus
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => setUseNetworkUrl(!useNetworkUrl)}
                                        className={clsx(
                                            'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                                            useNetworkUrl ? 'bg-amber-500' : 'bg-gray-300'
                                        )}
                                    >
                                        <span
                                            className={clsx(
                                                'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                                                useNetworkUrl ? 'translate-x-6' : 'translate-x-1'
                                            )}
                                        />
                                    </button>
                                </div>
                                {useNetworkUrl && (
                                    <div>
                                        <label className="block text-xs text-amber-700 mb-1">
                                            Netwerk IP:poort
                                        </label>
                                        <input
                                            type="text"
                                            value={networkHost}
                                            onChange={(e) => setNetworkHost(e.target.value)}
                                            placeholder="192.168.1.100:5173"
                                            className="w-full px-2 py-1 text-sm border border-amber-300 rounded bg-white focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
                                        />
                                    </div>
                                )}
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Scanner URL
                            </label>
                            <div className="flex">
                                <input
                                    type="text"
                                    readOnly
                                    value={scannerUrl}
                                    className="flex-1 block w-full rounded-l-md border-gray-300 bg-gray-50 text-sm text-gray-600 focus:ring-0 focus:border-gray-300"
                                />
                                <button
                                    onClick={handleCopy}
                                    className={clsx(
                                        'px-4 py-2 border border-l-0 rounded-r-md text-sm font-medium transition-colors',
                                        copied
                                            ? 'bg-green-50 border-green-300 text-green-700'
                                            : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                                    )}
                                >
                                    {copied ? (
                                        <Check className="h-4 w-4" />
                                    ) : (
                                        <Copy className="h-4 w-4" />
                                    )}
                                </button>
                            </div>
                        </div>

                        <div className="bg-blue-50 rounded-lg p-4">
                            <h3 className="text-sm font-medium text-blue-900 mb-2">
                                Instructies
                            </h3>
                            <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
                                <li>Open de camera app op je telefoon</li>
                                <li>Scan de QR code hierboven</li>
                                <li>Log in indien nodig</li>
                                <li>Begin met tickets scannen!</li>
                            </ol>
                        </div>
                    </div>
                </div>

                {/* Stats Section */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center">
                            <Scan className="h-5 w-5 text-indigo-600 mr-2" />
                            <h2 className="text-lg font-medium text-gray-900">
                                Statistieken
                            </h2>
                        </div>
                        <button
                            onClick={fetchStats}
                            className="text-gray-400 hover:text-gray-600"
                            title="Ververs statistieken"
                        >
                            <RefreshCw className={clsx('h-4 w-4', loading && 'animate-spin')} />
                        </button>
                    </div>

                    {stats ? (
                        <div className="space-y-4">
                            {/* Progress bar */}
                            <div>
                                <div className="flex justify-between text-sm mb-1">
                                    <span className="text-gray-600">Ingecheckt</span>
                                    <span className="font-medium text-gray-900">
                                        {stats.checked_in_tickets} / {stats.total_tickets}
                                    </span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-3">
                                    <div
                                        className="bg-indigo-600 h-3 rounded-full transition-all duration-500"
                                        style={{ width: `${stats.check_in_percentage}%` }}
                                    />
                                </div>
                                <p className="text-xs text-gray-500 mt-1">
                                    {stats.check_in_percentage}% van alle tickets
                                </p>
                            </div>

                            {/* Stats grid */}
                            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-100">
                                <StatCard
                                    icon={<Scan className="h-4 w-4" />}
                                    label="Scans (afgelopen uur)"
                                    value={stats.total_scans}
                                />
                                <StatCard
                                    icon={<Check className="h-4 w-4 text-green-600" />}
                                    label="Geldig"
                                    value={stats.valid_scans}
                                    color="green"
                                />
                                <StatCard
                                    icon={<AlertCircle className="h-4 w-4 text-red-600" />}
                                    label="Ongeldig"
                                    value={stats.invalid_scans}
                                    color="red"
                                />
                                <StatCard
                                    icon={<Users className="h-4 w-4 text-indigo-600" />}
                                    label="Totaal tickets"
                                    value={stats.total_tickets}
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-8 text-gray-500">
                            <Scan className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <p>Statistieken laden...</p>
                        </div>
                    )}

                    <p className="text-xs text-gray-400 mt-4 text-center">
                        Automatisch vernieuwd elke 10 seconden
                    </p>
                </div>
            </div>
        </div>
    )
}

function StatCard({
    icon,
    label,
    value,
    color,
}: {
    icon: React.ReactNode
    label: string
    value: number
    color?: 'green' | 'red'
}) {
    return (
        <div className="bg-gray-50 rounded-lg p-3">
            <div className="flex items-center text-gray-500 mb-1">
                {icon}
                <span className="ml-1 text-xs">{label}</span>
            </div>
            <p
                className={clsx(
                    'text-2xl font-semibold',
                    color === 'green' && 'text-green-600',
                    color === 'red' && 'text-red-600',
                    !color && 'text-gray-900'
                )}
            >
                {value}
            </p>
        </div>
    )
}
