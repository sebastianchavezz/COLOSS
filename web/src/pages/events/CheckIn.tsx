import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { ResultCard } from '../../components/ResultCard'

interface CheckInResult {
    success: boolean
    reason: string
    message?: string
    ticket_instance_id?: string
    checked_in_at?: string
    owner_user_id?: string
}

interface RecentCheckIn {
    id: string
    qr_code: string
    checked_in_at: string
    order_email: string
    ticket_type_name: string
}

interface CheckInStats {
    checked_in: number
    not_checked_in: number
    total: number
}

export default function CheckIn() {
    const { eventId } = useParams<{ eventId: string }>()
    const [qrCode, setQrCode] = useState('')
    const [loading, setLoading] = useState(false)
    const [result, setResult] = useState<CheckInResult | null>(null)
    const [recentCheckIns, setRecentCheckIns] = useState<RecentCheckIn[]>([])
    const [stats, setStats] = useState<CheckInStats>({ checked_in: 0, not_checked_in: 0, total: 0 })
    const [role, setRole] = useState<string | null>(null)
    const [roleLoading, setRoleLoading] = useState(true)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (eventId) {
            checkRole()
            fetchRecentCheckIns()
            fetchStats()
        }
    }, [eventId])

    const checkRole = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            // First get event's org_id
            const { data: event } = await supabase
                .from('events')
                .select('org_id')
                .eq('id', eventId)
                .single()

            if (event) {
                const { data: member } = await supabase
                    .from('org_members')
                    .select('role')
                    .eq('org_id', event.org_id)
                    .eq('user_id', user.id)
                    .single()

                setRole(member?.role || null)
            }
        } catch (error) {
            console.error('Error checking role:', error)
        } finally {
            setRoleLoading(false)
        }
    }

    const fetchStats = async () => {
        if (!eventId) return

        // We can do this with a few counts
        // This is a rough implementation, ideally we'd have a dedicated RPC or view for stats if performance matters
        const { count: checkedInCount } = await supabase
            .from('ticket_instances')
            .select('id', { count: 'exact', head: true })
            .eq('event_id', eventId)
            .not('checked_in_at', 'is', null)

        const { count: totalCount } = await supabase
            .from('ticket_instances')
            .select('id', { count: 'exact', head: true })
            .eq('event_id', eventId)
            .is('deleted_at', null)

        if (checkedInCount !== null && totalCount !== null) {
            setStats({
                checked_in: checkedInCount,
                not_checked_in: totalCount - checkedInCount,
                total: totalCount
            })
        }
    }

    const fetchRecentCheckIns = async () => {
        if (!eventId) return

        const { data } = await supabase
            .from('ticket_instances_with_payment')
            .select(`
        id,
        qr_code,
        checked_in_at,
        order_email,
        ticket_type_name
      `)
            .eq('event_id', eventId)
            .not('checked_in_at', 'is', null)
            .order('checked_in_at', { ascending: false })
            .limit(10)

        if (data) {
            setRecentCheckIns(data as any)
        }
    }

    const handleCheckIn = async () => {
        if (!qrCode.trim() || !eventId) return

        setLoading(true)
        setResult(null)

        try {
            const { data, error } = await supabase.rpc('check_in_ticket', {
                _event_id: eventId,
                _qr_code: qrCode.trim()
            })

            if (error) {
                setResult({
                    success: false,
                    reason: 'error',
                    message: error.message
                })
            } else {
                const res = data as CheckInResult
                setResult(res)

                if (res.success) {
                    setQrCode('') // Clear input on success
                    fetchRecentCheckIns()
                    fetchStats()
                    // Keep focus
                    inputRef.current?.focus()
                }
            }
        } catch (err) {
            setResult({
                success: false,
                reason: 'error',
                message: 'Network error'
            })
        } finally {
            setLoading(false)
        }
    }

    if (roleLoading) {
        return <div className="p-6">Loading permissions...</div>
    }

    if (role === 'finance') {
        return (
            <div className="p-6 max-w-4xl mx-auto">
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-4 rounded-lg">
                    <h3 className="font-bold">Access Restricted</h3>
                    <p>Finance role does not have permission to perform check-ins.</p>
                </div>
            </div>
        )
    }

    return (
        <div className="max-w-4xl mx-auto p-6">
            <h1 className="text-3xl font-bold mb-6 text-gray-900">Event Check-in</h1>

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-4 mb-8">
                <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 text-center">
                    <div className="text-2xl font-bold text-green-600">{stats.checked_in}</div>
                    <div className="text-sm text-gray-500">Checked In</div>
                </div>
                <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 text-center">
                    <div className="text-2xl font-bold text-gray-600">{stats.not_checked_in}</div>
                    <div className="text-sm text-gray-500">Remaining</div>
                </div>
                <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 text-center">
                    <div className="text-2xl font-bold text-blue-600">{stats.total}</div>
                    <div className="text-sm text-gray-500">Total Tickets</div>
                </div>
            </div>

            {/* Scanner Input */}
            <div className="bg-white rounded-lg shadow-md p-6 mb-8 border border-gray-200">
                <div className="mb-4">
                    <label htmlFor="qr-input" className="block text-sm font-medium text-gray-700 mb-2">
                        Scan QR Code
                    </label>
                    <input
                        id="qr-input"
                        ref={inputRef}
                        type="text"
                        value={qrCode}
                        onChange={(e) => setQrCode(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleCheckIn()}
                        placeholder="Click here and scan..."
                        className="w-full px-4 py-3 text-lg border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                        autoFocus
                        autoComplete="off"
                    />
                </div>

                <button
                    onClick={handleCheckIn}
                    disabled={loading || !qrCode.trim()}
                    className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    {loading ? 'Processing...' : 'Check In'}
                </button>

                <ResultCard result={result} />
            </div>

            {/* Recent Check-ins List */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                    <h2 className="text-lg font-semibold text-gray-900">Recent Check-ins</h2>
                </div>

                {recentCheckIns.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">
                        No tickets checked in yet today.
                    </div>
                ) : (
                    <ul className="divide-y divide-gray-200">
                        {recentCheckIns.map((checkIn) => (
                            <li key={checkIn.id} className="px-6 py-4 hover:bg-gray-50 transition-colors">
                                <div className="flex justify-between items-center">
                                    <div>
                                        <div className="font-medium text-gray-900">
                                            {checkIn.order_email || 'Unknown User'}
                                        </div>
                                        <div className="text-sm text-gray-500">
                                            {checkIn.ticket_type_name || 'Unknown Ticket'} • <span className="font-mono text-xs">{checkIn.qr_code}</span>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-sm font-medium text-green-600">Checked In</div>
                                        <div className="text-xs text-gray-500">
                                            {new Date(checkIn.checked_in_at).toLocaleTimeString()}
                                        </div>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    )
}
