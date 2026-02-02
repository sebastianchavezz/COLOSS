/**
 * MijnBerichten - Chat interface for sporters/participants
 *
 * Two-panel layout (same as OrganizerOS):
 * - Left: Thread list (events)
 * - Right: Message thread with reply input
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { MessageSquare } from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

interface Thread {
    id: string
    status: 'open' | 'pending' | 'closed'
    last_message_at: string | null
    created_at: string
    event_id: string
    event_name: string
    event_slug: string
    event_start_time: string
    last_message_preview?: string
}

interface Message {
    id: string
    thread_id: string
    sender_type: 'participant' | 'organizer'
    sender_name: string
    content: string
    created_at: string
}

export function MijnBerichten() {
    const { user } = useAuth()
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
        if (!user) return
        fetchThreads()
    }, [user?.id])

    // Auto-scroll messages to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    // Fetch threads list
    const fetchThreads = useCallback(async () => {
        if (!user) return
        setLoading(true)
        setError(null)

        try {
            // First get participant ID for this user
            const { data: participant } = await supabase
                .from('participants')
                .select('id')
                .eq('user_id', user.id)
                .maybeSingle()

            if (!participant) {
                setLoading(false)
                return
            }

            // Fetch threads with event info
            const { data: threadsData, error: threadsError } = await supabase
                .from('chat_threads')
                .select(`
                    id,
                    status,
                    last_message_at,
                    created_at,
                    event_id,
                    events:event_id(name, slug, start_time)
                `)
                .eq('participant_id', participant.id)
                .order('last_message_at', { ascending: false, nullsFirst: false })

            if (threadsError) throw threadsError

            // Transform data
            const transformedThreads: Thread[] = (threadsData || [])
                .filter((t: any) => t.events)
                .map((t: any) => ({
                    id: t.id,
                    status: t.status,
                    last_message_at: t.last_message_at,
                    created_at: t.created_at,
                    event_id: t.event_id,
                    event_name: t.events.name,
                    event_slug: t.events.slug,
                    event_start_time: t.events.start_time,
                }))

            // Fetch last message for each thread
            if (transformedThreads.length > 0) {
                const threadIds = transformedThreads.map(t => t.id)
                const { data: messagesData } = await supabase
                    .from('chat_messages')
                    .select('thread_id, content')
                    .in('thread_id', threadIds)
                    .order('created_at', { ascending: false })

                if (messagesData) {
                    const messageMap = new Map<string, string>()
                    for (const msg of messagesData) {
                        if (!messageMap.has(msg.thread_id)) {
                            messageMap.set(msg.thread_id, msg.content)
                        }
                    }
                    transformedThreads.forEach(t => {
                        t.last_message_preview = messageMap.get(t.id) || ''
                    })
                }
            }

            setThreads(transformedThreads)

            // Auto-select first thread
            if (transformedThreads.length > 0 && !selectedThread) {
                setSelectedThread(transformedThreads[0])
                fetchMessages(transformedThreads[0].id)
            }
        } catch (err: any) {
            console.error('[MijnBerichten] Error fetching threads:', err)
            setError(err.message || 'Fout bij laden gesprekken')
        } finally {
            setLoading(false)
        }
    }, [user?.id, selectedThread])

    // Fetch messages for selected thread
    const fetchMessages = useCallback(async (threadId: string) => {
        setThreadLoading(true)
        setError(null)

        try {
            const { data, error: msgError } = await supabase
                .from('chat_messages')
                .select('id, thread_id, sender_type, content, created_at')
                .eq('thread_id', threadId)
                .order('created_at', { ascending: true })

            if (msgError) throw msgError

            setMessages((data || []).map(m => ({
                ...m,
                sender_name: m.sender_type === 'participant' ? 'Jij' : 'Organisator'
            })))
        } catch (err: any) {
            console.error('[MijnBerichten] Error fetching messages:', err)
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
        if (!selectedThread || !replyText.trim()) return

        setSending(true)
        setError(null)

        try {
            const { data: refreshedSession } = await supabase.auth.refreshSession()
            const token = refreshedSession?.session?.access_token

            if (!token) {
                throw new Error('Niet ingelogd')
            }

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
                        event_id: selectedThread.event_id,
                        content: replyText.trim(),
                    }),
                }
            )

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}))
                throw new Error(errorData.error || 'Verzenden mislukt')
            }

            setReplyText('')
            await fetchMessages(selectedThread.id)
            await fetchThreads()
        } catch (err: any) {
            console.error('[MijnBerichten] Error sending message:', err)
            setError(err.message || 'Fout bij verzenden bericht')
        } finally {
            setSending(false)
        }
    }

    // Filter threads
    const filteredThreads = statusFilter === 'all'
        ? threads
        : threads.filter(t => t.status === statusFilter)

    if (loading) {
        return (
            <div className="flex items-center justify-center h-96">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black"></div>
            </div>
        )
    }

    return (
        <div className="max-w-6xl">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                    <MessageSquare className="h-6 w-6" />
                    Mijn Berichten
                </h1>
                <p className="mt-1 text-sm text-gray-600">
                    Gesprekken met organisatoren
                </p>
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
                                Geen gesprekken gevonden
                            </div>
                        ) : (
                            filteredThreads.map((thread) => (
                                <button
                                    key={thread.id}
                                    onClick={() => handleSelectThread(thread)}
                                    className={clsx(
                                        'w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors',
                                        selectedThread?.id === thread.id && 'bg-gray-100 border-l-4 border-l-black'
                                    )}
                                >
                                    <div className="flex items-start justify-between mb-1">
                                        <div className="font-medium text-sm text-gray-900 flex-1 truncate">
                                            {thread.event_name}
                                        </div>
                                    </div>
                                    <p className="text-xs text-gray-500">
                                        {new Date(thread.event_start_time).toLocaleDateString('nl-NL', {
                                            weekday: 'short',
                                            day: 'numeric',
                                            month: 'short'
                                        })}
                                    </p>
                                    {thread.last_message_preview && (
                                        <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                                            {thread.last_message_preview}
                                        </p>
                                    )}
                                    <div className="flex items-center justify-between mt-2">
                                        <span className={clsx(
                                            'text-xs font-medium px-2 py-0.5 rounded',
                                            thread.status === 'open' && 'bg-blue-100 text-blue-800',
                                            thread.status === 'pending' && 'bg-yellow-100 text-yellow-800',
                                            thread.status === 'closed' && 'bg-gray-100 text-gray-800'
                                        )}>
                                            {thread.status === 'open' && 'Open'}
                                            {thread.status === 'pending' && 'In afwachting'}
                                            {thread.status === 'closed' && 'Gesloten'}
                                        </span>
                                        {thread.last_message_at && (
                                            <span className="text-xs text-gray-400">
                                                {new Date(thread.last_message_at).toLocaleDateString('nl-NL', {
                                                    month: 'short',
                                                    day: 'numeric'
                                                })}
                                            </span>
                                        )}
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
                            <div className="p-4 border-b border-gray-200">
                                <h2 className="font-medium text-gray-900">
                                    {selectedThread.event_name}
                                </h2>
                                <p className="text-sm text-gray-500">
                                    {new Date(selectedThread.event_start_time).toLocaleDateString('nl-NL', {
                                        weekday: 'long',
                                        day: 'numeric',
                                        month: 'long',
                                        year: 'numeric'
                                    })}
                                </p>
                            </div>

                            {/* Messages */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                                {threadLoading ? (
                                    <div className="flex items-center justify-center h-32">
                                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-black"></div>
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
                                                message.sender_type === 'participant' && 'flex-row-reverse'
                                            )}
                                        >
                                            <div className={clsx(
                                                'flex-1 max-w-xs',
                                                message.sender_type === 'participant' && 'text-right'
                                            )}>
                                                <div className={clsx(
                                                    'inline-block px-4 py-2 rounded-lg',
                                                    message.sender_type === 'participant'
                                                        ? 'bg-black text-white'
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
                                    ))
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Reply Input */}
                            {selectedThread.status !== 'closed' ? (
                                <div className="p-4 border-t border-gray-200">
                                    <div className="flex gap-2">
                                        <textarea
                                            value={replyText}
                                            onChange={(e) => setReplyText(e.target.value)}
                                            placeholder="Typ je bericht..."
                                            rows={3}
                                            className="flex-1 px-3 py-2 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-black"
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && !e.shiftKey) {
                                                    e.preventDefault()
                                                    handleSendReply()
                                                }
                                            }}
                                        />
                                        <button
                                            onClick={handleSendReply}
                                            disabled={sending || !replyText.trim()}
                                            className={clsx(
                                                'px-4 py-2 rounded-md font-medium text-sm h-fit',
                                                sending || !replyText.trim()
                                                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                                    : 'bg-black text-white hover:bg-gray-800'
                                            )}
                                        >
                                            {sending ? 'Verzenden...' : 'Verzenden'}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="p-4 border-t border-gray-200 bg-gray-50 text-center text-sm text-gray-500">
                                    Dit gesprek is gesloten
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-gray-500">
                            Selecteer een gesprek om berichten te zien
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default MijnBerichten
