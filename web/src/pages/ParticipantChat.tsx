/**
 * ParticipantChat Page
 *
 * Public chat interface for participants to contact organizer.
 * Route: /e/:eventSlug/chat
 *
 * Features:
 * - Resolve eventSlug to event_id
 * - Display chat thread with organizer
 * - Create thread automatically on first message
 * - Display messages chronologically
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { MessageSquare, ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

interface Message {
    id: string
    thread_id: string
    sender_type: 'participant' | 'organizer'
    sender_name: string
    content: string
    created_at: string
}

export function ParticipantChat() {
    const { eventSlug } = useParams<{ eventSlug: string }>()
    const navigate = useNavigate()
    const { user, session, loading: authLoading } = useAuth()
    const [eventId, setEventId] = useState<string | null>(null)
    const [threadId, setThreadId] = useState<string | null>(null)
    const [messages, setMessages] = useState<Message[]>([])
    const [loading, setLoading] = useState(true)
    const [messageSending, setMessageSending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [messageText, setMessageText] = useState('')
    const messagesEndRef = useRef<HTMLDivElement>(null)

    // Auth redirect - MUST be before any conditional returns
    useEffect(() => {
        if (!authLoading && !user) {
            const returnUrl = `/e/${eventSlug}/chat`
            navigate(`/login?returnUrl=${encodeURIComponent(returnUrl)}`)
        }
    }, [authLoading, user, eventSlug, navigate])

    // Resolve eventSlug to event_id
    useEffect(() => {
        if (!eventSlug || !user) return

        const resolveEvent = async () => {
            try {
                const { data, error: queryError } = await supabase
                    .from('events')
                    .select('id')
                    .eq('slug', eventSlug)
                    .maybeSingle()

                if (queryError) {
                    throw queryError
                }

                if (!data) {
                    setError('Event niet gevonden')
                    setLoading(false)
                    return
                }

                setEventId(data.id)
            } catch (err: any) {
                console.error('[ParticipantChat] Error resolving event:', err)
                setError('Fout bij laden event')
                setLoading(false)
            }
        }

        resolveEvent()
    }, [eventSlug, user])

    // Fetch or create thread
    useEffect(() => {
        if (!eventId) return

        const getOrCreateThread = async () => {
            try {
                // Check if thread exists (get-thread-messages will return threadId)
                // For now, we don't know the threadId, so we'll wait for first message
                // to trigger thread creation
                setLoading(false)
            } catch (err: any) {
                console.error('[ParticipantChat] Error:', err)
                setError('Fout bij laden chat')
                setLoading(false)
            }
        }

        getOrCreateThread()
    }, [eventId])

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    // Fetch messages for thread
    const fetchMessages = useCallback(async (tid: string) => {
        try {
            const token = session?.access_token
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
            }
            if (token) {
                headers['Authorization'] = `Bearer ${token}`
            }

            const response = await fetch(
                `${SUPABASE_URL}/functions/v1/get-thread-messages?thread_id=${tid}`,
                {
                    method: 'GET',
                    headers,
                }
            )

            if (!response.ok) {
                throw new Error(`Failed to fetch messages: ${response.statusText}`)
            }

            const data = await response.json()
            setMessages(data.messages || [])
        } catch (err: any) {
            console.error('[ParticipantChat] Error fetching messages:', err)
            setError(err.message || 'Fout bij laden berichten')
        }
    }, [session])

    // Send message
    const handleSendMessage = async () => {
        if (!messageText.trim() || !eventId) return

        setMessageSending(true)
        setError(null)

        try {
            // Refresh session to get fresh token (prevents "Invalid JWT" errors)
            const { data: refreshedSession } = await supabase.auth.refreshSession()
            const token = refreshedSession?.session?.access_token || session?.access_token

            console.log('[ParticipantChat] Token obtained:', token ? 'yes (length: ' + token.length + ')' : 'no')

            if (!token) {
                console.log('[ParticipantChat] No token, redirecting to login')
                // Redirect to login
                const returnUrl = `/e/${eventSlug}/chat`
                navigate(`/login?returnUrl=${encodeURIComponent(returnUrl)}`)
                return
            }

            console.log('[ParticipantChat] Sending message to event:', eventId)

            const response = await fetch(
                `${SUPABASE_URL}/functions/v1/send-message`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        event_id: eventId,
                        thread_id: threadId,
                        content: messageText.trim(),
                    }),
                }
            )

            if (!response.ok) {
                const errorBody = await response.text()
                console.error('[ParticipantChat] Response error:', response.status, errorBody)
                throw new Error(`Failed to send message: ${response.status} - ${errorBody}`)
            }

            const data = await response.json()

            // If this is the first message, we now have a threadId
            if (!threadId && data.thread_id) {
                setThreadId(data.thread_id)
            }

            setMessageText('')

            // Fetch updated messages
            if (threadId || data.thread_id) {
                await fetchMessages(threadId || data.thread_id)
            }
        } catch (err: any) {
            console.error('[ParticipantChat] Error sending message:', err)
            setError(err.message || 'Fout bij verzenden bericht')
        } finally {
            setMessageSending(false)
        }
    }

    // Show loading while checking auth or loading data
    if (authLoading || loading || !user) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
        )
    }

    if (error && eventId === null) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center max-w-md">
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">Oops!</h2>
                    <p className="text-gray-600 mb-6">{error}</p>
                    <Link
                        to="/"
                        className="inline-block px-6 py-3 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 font-medium"
                    >
                        Terug naar startpagina
                    </Link>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <div className="bg-white border-b border-gray-200">
                <div className="max-w-2xl mx-auto px-4 h-16 flex items-center justify-between">
                    <Link to={`/events/${eventSlug}`} className="text-gray-500 hover:text-gray-700">
                        <ArrowLeft className="h-5 w-5" />
                    </Link>
                    <h1 className="text-lg font-medium text-gray-900 flex items-center gap-2">
                        <MessageSquare className="h-5 w-5 text-indigo-600" />
                        Contact Organisatie
                    </h1>
                    <div className="w-5" />
                </div>
            </div>

            {/* Chat Container */}
            <div className="max-w-2xl mx-auto h-[calc(100vh-120px)] flex flex-col">
                {error && (
                    <div className="mx-4 mt-4 bg-red-50 border-l-4 border-red-400 p-4 text-red-700 text-sm rounded">
                        {error}
                    </div>
                )}

                {!threadId && messages.length === 0 ? (
                    /* No thread yet */
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center">
                            <MessageSquare className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                            <h2 className="text-lg font-medium text-gray-900 mb-2">
                                Start een gesprek
                            </h2>
                            <p className="text-gray-600 max-w-sm">
                                Stel je vragen aan de organisatie. We beantwoorden je zo snel mogelijk.
                            </p>
                        </div>
                    </div>
                ) : (
                    /* Messages list */
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {messages.map((message) => (
                            <div
                                key={message.id}
                                className={clsx(
                                    'flex gap-3',
                                    message.sender_type === 'participant' && 'flex-row-reverse'
                                )}
                            >
                                <div className={clsx(
                                    'flex-1 max-w-xs',
                                    message.sender_type === 'participant' && 'text-right'
                                )}>
                                    <p className={clsx(
                                        'text-xs font-medium mb-1',
                                        message.sender_type === 'participant' ? 'text-gray-600' : 'text-indigo-600'
                                    )}>
                                        {message.sender_name}
                                    </p>
                                    <div className={clsx(
                                        'inline-block px-4 py-2 rounded-lg',
                                        message.sender_type === 'participant'
                                            ? 'bg-indigo-600 text-white'
                                            : 'bg-gray-100 text-gray-900'
                                    )}>
                                        <p className="text-sm">{message.content}</p>
                                    </div>
                                    <p className={clsx(
                                        'text-xs text-gray-500 mt-1',
                                        message.sender_type === 'participant' && 'text-right'
                                    )}>
                                        {new Date(message.created_at).toLocaleTimeString('nl-NL', {
                                            hour: '2-digit',
                                            minute: '2-digit'
                                        })}
                                    </p>
                                </div>
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>
                )}

                {/* Message Input */}
                <div className="border-t border-gray-200 bg-white p-4">
                    <div className="flex gap-2">
                        <textarea
                            value={messageText}
                            onChange={(e) => setMessageText(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && e.ctrlKey && !messageSending && messageText.trim()) {
                                    handleSendMessage()
                                }
                            }}
                            placeholder="Typ je bericht... (Ctrl+Enter om te verzenden)"
                            rows={3}
                            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <button
                            onClick={handleSendMessage}
                            disabled={messageSending || !messageText.trim()}
                            className={clsx(
                                'px-4 py-2 rounded-lg font-medium text-sm h-fit',
                                messageSending || !messageText.trim()
                                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                    : 'bg-indigo-600 text-white hover:bg-indigo-700'
                            )}
                        >
                            {messageSending ? 'Verzenden...' : 'Verzenden'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

// Helper function - move to utils
function clsx(...classes: (string | undefined | false)[]): string {
    return classes.filter(Boolean).join(' ')
}
