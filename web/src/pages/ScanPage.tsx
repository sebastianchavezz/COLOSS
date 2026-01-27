import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { QrCode, CheckCircle, XCircle, ArrowLeft, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { clsx } from 'clsx'

export function ScanPage() {
    const { eventSlug } = useParams<{ eventSlug: string }>()
    const [event, setEvent] = useState<{ id: string, name: string } | null>(null)
    const [loading, setLoading] = useState(true)
    const [tokenInput, setTokenInput] = useState('')
    const [scanResult, setScanResult] = useState<{
        success: boolean
        message: string
        ticket?: {
            id: string
            type: string
            checked_in_at: string
        }
        error?: string
    } | null>(null)
    const [processing, setProcessing] = useState(false)

    // Fetch event ID from slug
    useEffect(() => {
        async function fetchEvent() {
            if (!eventSlug) return

            const { data, error } = await supabase
                .from('events')
                .select('id, name')
                .eq('slug', eventSlug)
                .single()

            if (data) {
                setEvent(data)
            }
            setLoading(false)
        }
        fetchEvent()
    }, [eventSlug])

    const handleCheckIn = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!tokenInput.trim() || !event) return

        setProcessing(true)
        setScanResult(null)

        try {
            const { data, error } = await supabase.functions.invoke('check-in-ticket', {
                body: {
                    raw_token: tokenInput.trim(),
                    event_id: event.id
                }
            })

            if (error) throw error

            if (data.error) {
                setScanResult({
                    success: false,
                    message: data.error,
                    error: data.details || data.code
                })
            } else {
                setScanResult({
                    success: true,
                    message: data.message,
                    ticket: data.ticket
                })
                setTokenInput('') // Clear input on success
            }

        } catch (err: any) {
            setScanResult({
                success: false,
                message: 'Check-in failed',
                error: err.message
            })
        } finally {
            setProcessing(false)
        }
    }

    if (loading) return <div className="p-8 text-center">Loading...</div>
    if (!event) return <div className="p-8 text-center">Event not found</div>

    return (
        <div className="min-h-screen bg-gray-100 p-4">
            <div className="max-w-md mx-auto bg-white rounded-xl shadow-md overflow-hidden md:max-w-2xl">
                <div className="p-8">
                    <div className="flex items-center justify-between mb-6">
                        <Link to={`/org/demo/events/${eventSlug}/participants`} className="text-indigo-600 hover:text-indigo-800 flex items-center">
                            <ArrowLeft className="h-4 w-4 mr-1" />
                            Back
                        </Link>
                        <h1 className="text-xl font-bold text-gray-900">Scan Ticket</h1>
                    </div>

                    <div className="mb-6">
                        <h2 className="text-lg font-medium text-gray-900">{event.name}</h2>
                        <p className="text-sm text-gray-500">Enter ticket token manually (camera scan coming soon)</p>
                    </div>

                    <form onSubmit={handleCheckIn} className="mb-8">
                        <div className="mb-4">
                            <label htmlFor="token" className="block text-sm font-medium text-gray-700">Ticket Token</label>
                            <div className="mt-1 relative rounded-md shadow-sm">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <QrCode className="h-5 w-5 text-gray-400" />
                                </div>
                                <input
                                    type="text"
                                    name="token"
                                    id="token"
                                    className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-10 sm:text-sm border-gray-300 rounded-md p-2 border"
                                    placeholder="Paste token here..."
                                    value={tokenInput}
                                    onChange={(e) => setTokenInput(e.target.value)}
                                    disabled={processing}
                                />
                            </div>
                        </div>
                        <button
                            type="submit"
                            disabled={processing || !tokenInput}
                            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                        >
                            {processing ? <Loader2 className="animate-spin h-5 w-5" /> : 'Check In'}
                        </button>
                    </form>

                    {/* Result Display */}
                    {scanResult && (
                        <div className={clsx(
                            "rounded-md p-4",
                            scanResult.success ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"
                        )}>
                            <div className="flex">
                                <div className="flex-shrink-0">
                                    {scanResult.success ? (
                                        <CheckCircle className="h-5 w-5 text-green-400" />
                                    ) : (
                                        <XCircle className="h-5 w-5 text-red-400" />
                                    )}
                                </div>
                                <div className="ml-3">
                                    <h3 className={clsx(
                                        "text-sm font-medium",
                                        scanResult.success ? "text-green-800" : "text-red-800"
                                    )}>
                                        {scanResult.message}
                                    </h3>
                                    {scanResult.ticket && (
                                        <div className="mt-2 text-sm text-green-700">
                                            <p>Type: {scanResult.ticket.type}</p>
                                            <p>Time: {new Date(scanResult.ticket.checked_in_at).toLocaleTimeString()}</p>
                                        </div>
                                    )}
                                    {scanResult.error && (
                                        <div className="mt-2 text-sm text-red-700">
                                            <p>{scanResult.error}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
