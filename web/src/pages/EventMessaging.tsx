/**
 * EventMessaging Page (Organizer View)
 *
 * Two-panel layout:
 * - Left: Thread list (participants, status, unread count)
 * - Right: Message thread with reply input
 *
 * Threads are fetched from get-threads Edge Function.
 * Messages are fetched from get-thread-messages.
 * Replies are sent via send-message.
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { MessageSquare } from 'lucide-react'
import { clsx } from 'clsx'
import type { AppEvent } from '../types/supabase'

type EventDetailContext = {
    event: AppEvent
    org: any
    refreshEvent: () => void
}

interface Thread {
    id: string
    participant_id: string
    participant_name: string
    participant_email: string
    status: 'open' | 'pending' | 'closed'
    last_message_at: string
    last_message_preview: string
    unread_count: number
}

interface Message {
    id: string
    thread_id: string
    sender_type: 'participant' | 'organizer'
    sender_name: string
    content: string
    created_at: string
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

export function EventMessaging() {
    const { event } = useOutletContext<EventDetailContext>()
    const [threads, setThreads] = useState<Thread[]>([])
    const [selectedThread, setSelectedThread] = useState<Thread | null>(null)
    const [messages, setMessages] = useState<Message[]>([])
    const [loading, setLoading] = useState(true)
    const [threadLoading, setThreadLoading] = useState(false)
    const [sending, setSending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [replyText, setReplyText] = useState('')
    const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'pending' | 'closed'>('all')
    const messagesEndRef = useRef<HTMLDivElement>(null)

    // Fetch threads on mount
    useEffect(() => {
        if (!event) return
        fetchThreads()
    }, [event?.id])

    // Auto-scroll messages to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    // Fetch threads list
    const fetchThreads = useCallback(async () => {
        if (!event) return
        setLoading(true)
        setError(null)

        try {
            const { data: { session } } = await (await import('../lib/supabase')).supabase.auth.getSession()
            const token = session?.access_token

            const response = await fetch(
                `${SUPABASE_URL}/functions/v1/get-threads?event_id=${event.id}`,
                {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                }
            )

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}))
                const errorMsg = errorData.details || errorData.error || `Failed to fetch threads: ${response.statusText}`
                throw new Error(errorMsg)
            }

            const data = await response.json()
            const threadsList = data.threads || []
            setThreads(threadsList)

            // Auto-select first thread
            if (threadsList.length > 0 && !selectedThread) {
                setSelectedThread(threadsList[0])
                fetchMessages(threadsList[0].id)
            }
        } catch (err: any) {
            console.error('[EventMessaging] Error fetching threads:', err)
            setError(err.message || 'Fout bij laden threads')
        } finally {
            setLoading(false)
        }
    }, [event?.id, selectedThread])

    // Fetch messages for selected thread
    const fetchMessages = useCallback(async (threadId: string) => {
        setThreadLoading(true)
        setError(null)

        try {
            const { data: { session } } = await (await import('../lib/supabase')).supabase.auth.getSession()
            const token = session?.access_token

            const response = await fetch(
                `${SUPABASE_URL}/functions/v1/get-thread-messages?thread_id=${threadId}`,
                {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                }
            )

            if (!response.ok) {
                throw new Error(`Failed to fetch messages: ${response.statusText}`)
            }

            const data = await response.json()
            setMessages(data.messages || [])
        } catch (err: any) {
            console.error('[EventMessaging] Error fetching messages:', err)
            setError(err.message || 'Fout bij laden berichten')
        } finally {
            setThreadLoading(false)
        }
    }, [])

    // Handle thread selection
    const handleSelectThread = (thread: Thread) => {
        setSelectedThread(thread)
        setReplyText('')
        fetchMessages(thread.id)
    }

    // Send reply
    const handleSendReply = async () => {
        if (!selectedThread || !replyText.trim() || !event) return

        setSending(true)
        setError(null)

        try {
            const { data: { session } } = await (await import('../lib/supabase')).supabase.auth.getSession()
            const token = session?.access_token

            const response = await fetch(
                `${SUPABASE_URL}/functions/v1/send-message`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        thread_id: selectedThread.id,
                        event_id: event.id,
                        content: replyText.trim(),
                    }),
                }
            )

            if (!response.ok) {
                throw new Error(`Failed to send message: ${response.statusText}`)
            }

            setReplyText('')
            await fetchMessages(selectedThread.id)
            await fetchThreads()
        } catch (err: any) {
            console.error('[EventMessaging] Error sending message:', err)
            setError(err.message || 'Fout bij verzenden bericht')
        } finally {
            setSending(false)
        }
    }

    // Update thread status
    const handleUpdateStatus = async (threadId: string, newStatus: 'open' | 'pending' | 'closed') => {
        if (!event) return

        try {
            const { data: { session } } = await (await import('../lib/supabase')).supabase.auth.getSession()
            const token = session?.access_token

            const response = await fetch(
                `${SUPABASE_URL}/functions/v1/update-thread-status`,
                {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        thread_id: threadId,
                        status: newStatus,
                    }),
                }
            )

            if (!response.ok) {
                throw new Error(`Failed to update status: ${response.statusText}`)
            }

            await fetchThreads()
            if (selectedThread?.id === threadId) {
                const updated = threads.find(t => t.id === threadId)
                if (updated) setSelectedThread(updated)
            }
        } catch (err: any) {
            console.error('[EventMessaging] Error updating status:', err)
            setError(err.message || 'Fout bij bijwerken status')
        }
    }

    // Filter threads
    const filteredThreads = statusFilter === 'all'
        ? threads
        : threads.filter(t => t.status === statusFilter)

    const totalUnread = threads.reduce((sum, t) => sum + t.unread_count, 0)

    if (!event) {
        return <div className="p-4 text-gray-500">Event laden...</div>
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-96">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
        )
    }

    return (
        <div className="max-w-6xl">
            <div className="mb-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <MessageSquare className="h-6 w-6 text-indigo-600" />
                            Berichten
                        </h1>
                        <p className="mt-1 text-sm text-gray-600">
                            Beantwoord vragen van deelnemers
                        </p>
                    </div>
                    {totalUnread > 0 && (
                        <div className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-sm font-medium">
                            {totalUnread} ongelezen
                        </div>
                    )}
                </div>
            </div>

            {error && (
                <div className="mb-4 bg-red-50 border-l-4 border-red-400 p-4 text-red-700">
                    {error}
                </div>
            )}

            <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden h-[calc(100vh-300px)] flex">
                {/* Left Panel: Threads */}
                <div className="w-80 border-r border-gray-200 flex flex-col">
                    {/* Status Filter */}
                    <div className="p-4 border-b border-gray-200 space-y-2">
                        <label className="text-xs font-medium text-gray-700">Filter op status</label>
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value as any)}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                        >
                            <option value="all">Alle statussen</option>
                            <option value="open">Open</option>
                            <option value="pending">In afwachting</option>
                            <option value="closed">Gesloten</option>
                        </select>
                    </div>

                    {/* Threads List */}
                    <div className="flex-1 overflow-y-auto">
                        {filteredThreads.length === 0 ? (
                            <div className="p-4 text-center text-gray-500 text-sm">
                                Geen threads gevonden
                            </div>
                        ) : (
                            filteredThreads.map((thread) => (
                                <button
                                    key={thread.id}
                                    onClick={() => handleSelectThread(thread)}
                                    className={clsx(
                                        'w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors',
                                        selectedThread?.id === thread.id && 'bg-indigo-50 border-l-4 border-l-indigo-600'
                                    )}
                                >
                                    <div className="flex items-start justify-between mb-1">
                                        <div className="font-medium text-sm text-gray-900 flex-1 truncate">
                                            {thread.participant_name}
                                        </div>
                                        {thread.unread_count > 0 && (
                                            <span className="ml-2 inline-block bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center">
                                                {thread.unread_count}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-gray-500 truncate">
                                        {thread.participant_email}
                                    </p>
                                    <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                                        {thread.last_message_preview}
                                    </p>
                                    <div className="flex items-center justify-between mt-2">
                                        <span className={clsx(
                                            'text-xs font-medium px-2 py-1 rounded',
                                            thread.status === 'open' && 'bg-blue-100 text-blue-800',
                                            thread.status === 'pending' && 'bg-yellow-100 text-yellow-800',
                                            thread.status === 'closed' && 'bg-gray-100 text-gray-800'
                                        )}>
                                            {thread.status === 'open' && 'Open'}
                                            {thread.status === 'pending' && 'In afwachting'}
                                            {thread.status === 'closed' && 'Gesloten'}
                                        </span>
                                        <span className="text-xs text-gray-400">
                                            {new Date(thread.last_message_at).toLocaleDateString('nl-NL', {
                                                month: 'short',
                                                day: 'numeric'
                                            })}
                                        </span>
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>

                {/* Right Panel: Messages */}
                <div className="flex-1 flex flex-col">
                    {selectedThread ? (
                        <>
                            {/* Thread Header */}
                            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                                <div>
                                    <h2 className="font-medium text-gray-900">
                                        {selectedThread.participant_name}
                                    </h2>
                                    <p className="text-sm text-gray-500">
                                        {selectedThread.participant_email}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <select
                                        value={selectedThread.status}
                                        onChange={(e) => handleUpdateStatus(selectedThread.id, e.target.value as any)}
                                        className="px-2 py-1 text-sm border border-gray-300 rounded"
                                    >
                                        <option value="open">Open</option>
                                        <option value="pending">In afwachting</option>
                                        <option value="closed">Gesloten</option>
                                    </select>
                                </div>
                            </div>

                            {/* Messages */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                                {threadLoading ? (
                                    <div className="flex items-center justify-center h-32">
                                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                                    </div>
                                ) : messages.length === 0 ? (
                                    <div className="text-center text-gray-500 py-8">
                                        Geen berichten
                                    </div>
                                ) : (
                                    messages.map((message) => (
                                        <div
                                            key={message.id}
                                            className={clsx(
                                                'flex gap-3',
                                                message.sender_type === 'organizer' && 'flex-row-reverse'
                                            )}
                                        >
                                            <div className={clsx(
                                                'flex-1 max-w-xs',
                                                message.sender_type === 'organizer' && 'text-right'
                                            )}>
                                                <div className={clsx(
                                                    'inline-block px-4 py-2 rounded-lg',
                                                    message.sender_type === 'organizer'
                                                        ? 'bg-indigo-600 text-white'
                                                        : 'bg-gray-100 text-gray-900'
                                                )}>
                                                    <p className="text-sm">{message.content}</p>
                                                </div>
                                                <p className={clsx(
                                                    'text-xs text-gray-500 mt-1',
                                                    message.sender_type === 'organizer' && 'text-right'
                                                )}>
                                                    {new Date(message.created_at).toLocaleTimeString('nl-NL', {
                                                        hour: '2-digit',
                                                        minute: '2-digit'
                                                    })}
                                                </p>
                                            </div>
                                        </div>
                                    ))
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Reply Input */}
                            <div className="p-4 border-t border-gray-200">
                                <div className="flex gap-2">
                                    <textarea
                                        value={replyText}
                                        onChange={(e) => setReplyText(e.target.value)}
                                        placeholder="Typ je antwoord..."
                                        rows={3}
                                        className="flex-1 px-3 py-2 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                    <button
                                        onClick={handleSendReply}
                                        disabled={sending || !replyText.trim()}
                                        className={clsx(
                                            'px-4 py-2 rounded-md font-medium text-sm h-fit',
                                            sending || !replyText.trim()
                                                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                                : 'bg-indigo-600 text-white hover:bg-indigo-700'
                                        )}
                                    >
                                        {sending ? 'Verzenden...' : 'Verzenden'}
                                    </button>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-gray-500">
                            Selecteer een thread om berichten te zien
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
