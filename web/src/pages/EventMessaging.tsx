/**
 * EventMessaging Page (Organizer View)
 *
 * UPGRADED with real-time messaging best practices:
 * - Supabase Realtime subscriptions for instant updates
 * - Optimistic UI updates for immediate feedback
 * - Token caching (no refresh per API call)
 * - Connection status indicator
 *
 * Two-panel layout:
 * - Left: Thread list (participants, status, unread count)
 * - Right: Message thread with reply input
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { useOutletContext, useSearchParams, useNavigate } from 'react-router-dom'
import { MessageSquare, Wifi, WifiOff, RefreshCw, User } from 'lucide-react'
import { clsx } from 'clsx'
import type { AppEvent } from '../types/supabase'
import { useRealtimeMessages, useRealtimeThreads, type Message, type Thread } from '../hooks/useRealtimeMessages'
import { supabase } from '../lib/supabase'

type EventDetailContext = {
    event: AppEvent
    org: any
    refreshEvent: () => void
}

export function EventMessaging() {
    const { event, org } = useOutletContext<EventDetailContext>()
    const [searchParams, setSearchParams] = useSearchParams()
    const navigate = useNavigate()
    const [selectedThread, setSelectedThread] = useState<Thread | null>(null)

    // Handle thread URL parameter (from profile "Stuur bericht")
    const threadIdFromUrl = searchParams.get('thread')
    const [replyText, setReplyText] = useState('')
    const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'pending' | 'closed'>('all')
    const [sending, setSending] = useState(false)
    const [sendError, setSendError] = useState<string | null>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)

    // Real-time threads subscription
    const {
        threads,
        loading: threadsLoading,
        error: threadsError,
        refreshThreads,
        totalUnread,
        connectionStatus: threadsConnectionStatus,
    } = useRealtimeThreads({
        eventId: event?.id || '',
        enabled: !!event?.id,
    })

    // Real-time messages subscription (for selected thread)
    const {
        messages,
        loading: messagesLoading,
        loadingMore,
        error: messagesError,
        sendMessage,
        loadOlderMessages,
        connectionStatus: messagesConnectionStatus,
        pagination,
    } = useRealtimeMessages({
        threadId: selectedThread?.id || null,
        eventId: event?.id || '',
        enabled: !!selectedThread?.id,
    })

    // Auto-scroll messages to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    // Auto-select thread from URL parameter (from profile "Stuur bericht")
    useEffect(() => {
        if (threadIdFromUrl && threads.length > 0) {
            const thread = threads.find(t => t.id === threadIdFromUrl)
            if (thread) {
                handleSelectThread(thread)
                // Clear URL param after selecting (optional, keeps URL clean)
                setSearchParams({})
            }
        }
    }, [threadIdFromUrl, threads])

    // Auto-select first thread when loaded (only if no URL param)
    useEffect(() => {
        if (threads.length > 0 && !selectedThread && !threadIdFromUrl) {
            setSelectedThread(threads[0])
        }
    }, [threads, selectedThread, threadIdFromUrl])

    // Handle thread selection - mark as read when opened (best practice)
    const handleSelectThread = async (thread: Thread) => {
        setSelectedThread(thread)
        setReplyText('')
        setSendError(null)

        // Mark thread as read (optimistic UI update)
        if (thread.unread_count > 0) {
            // Optimistic: update local state immediately
            refreshThreads()

            // Call RPC to mark as read in database
            try {
                const { data: { user } } = await supabase.auth.getUser()
                if (user) {
                    await supabase.rpc('mark_chat_thread_read', {
                        _thread_id: thread.id,
                        _reader_user_id: user.id
                    })
                    // Refresh to sync with server state
                    refreshThreads()
                }
            } catch (err) {
                console.error('[EventMessaging] Failed to mark thread as read:', err)
            }
        }
    }

    // Send reply with optimistic update
    const handleSendReply = async () => {
        if (!selectedThread || !replyText.trim() || !event || sending) return

        setSending(true)
        setSendError(null)

        const result = await sendMessage(replyText.trim())

        if (result.success) {
            setReplyText('')
            // Refresh threads to update last_message_preview
            refreshThreads()
        } else {
            setSendError(result.error || 'Verzenden mislukt')
        }

        setSending(false)
    }

    // Update thread status
    const handleUpdateStatus = useCallback(async (threadId: string, newStatus: 'open' | 'pending' | 'closed') => {
        if (!event) return

        try {
            const { data: { session } } = await (await import('../lib/supabase')).supabase.auth.getSession()
            const token = session?.access_token

            const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
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

            // Update local state immediately (optimistic)
            if (selectedThread?.id === threadId) {
                setSelectedThread({ ...selectedThread, status: newStatus })
            }

            // Realtime will handle the full update
        } catch (err: any) {
            console.error('[EventMessaging] Error updating status:', err)
            setSendError(err.message || 'Fout bij bijwerken status')
        }
    }, [event, selectedThread])

    // Navigate to participant profile
    const handleOpenProfile = (participantId: string) => {
        navigate(`/org/${org.slug}/events/${event.slug}/participants?profile=${participantId}`)
    }

    // Filter threads
    const filteredThreads = statusFilter === 'all'
        ? threads
        : threads.filter(t => t.status === statusFilter)

    // Connection status indicator
    const isConnected = threadsConnectionStatus === 'connected' && messagesConnectionStatus === 'connected'

    if (!event) {
        return <div className="p-4 text-gray-500 dark:text-gray-400">Event laden...</div>
    }

    if (threadsLoading) {
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
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <MessageSquare className="h-6 w-6 text-indigo-600" />
                            Berichten
                            {/* Connection indicator */}
                            {isConnected ? (
                                <Wifi className="h-4 w-4 text-green-500" title="Real-time verbonden" />
                            ) : (
                                <WifiOff className="h-4 w-4 text-yellow-500" title="Geen real-time verbinding" />
                            )}
                        </h1>
                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                            Beantwoord vragen van deelnemers
                            {isConnected && <span className="ml-2 text-green-600 text-xs">(live)</span>}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={refreshThreads}
                            className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                            title="Vernieuwen"
                        >
                            <RefreshCw className="h-5 w-5" />
                        </button>
                        {totalUnread > 0 && (
                            <div className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 px-3 py-1 rounded-full text-sm font-medium">
                                {totalUnread} ongelezen
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {(threadsError || sendError) && (
                <div className="mb-4 bg-red-50 dark:bg-red-900/50 border-l-4 border-red-400 p-4 text-red-700 dark:text-red-200">
                    {threadsError || sendError}
                </div>
            )}

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 overflow-hidden h-[calc(100vh-300px)] flex">
                {/* Left Panel: Threads */}
                <div className="w-80 border-r border-gray-200 dark:border-gray-700 flex flex-col">
                    {/* Status Filter */}
                    <div className="p-4 border-b border-gray-200 dark:border-gray-700 space-y-2">
                        <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Filter op status</label>
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value as any)}
                            className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
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
                            <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
                                Geen threads gevonden
                            </div>
                        ) : (
                            filteredThreads.map((thread) => (
                                <button
                                    key={thread.id}
                                    onClick={() => handleSelectThread(thread)}
                                    className={clsx(
                                        'w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors group',
                                        selectedThread?.id === thread.id && 'bg-indigo-50 dark:bg-indigo-900/50 border-l-4 border-l-indigo-600'
                                    )}
                                >
                                    <div className="flex items-start justify-between mb-1">
                                        <div className="font-medium text-sm text-gray-900 dark:text-white flex-1 truncate flex items-center gap-1">
                                            {thread.participant_name}
                                            <span
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    handleOpenProfile(thread.participant_id)
                                                }}
                                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-opacity"
                                                title="Bekijk profiel"
                                            >
                                                <User className="h-3 w-3" />
                                            </span>
                                        </div>
                                        {thread.unread_count > 0 && (
                                            <span className="ml-2 inline-flex items-center justify-center bg-red-500 text-white rounded-full w-5 h-5 text-xs">
                                                {thread.unread_count}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                        {thread.participant_email}
                                    </p>
                                    <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 line-clamp-2">
                                        {thread.last_message_preview}
                                    </p>
                                    <div className="flex items-center justify-between mt-2">
                                        <span className={clsx(
                                            'text-xs font-medium px-2 py-1 rounded',
                                            thread.status === 'open' && 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
                                            thread.status === 'pending' && 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
                                            thread.status === 'closed' && 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
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
                            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                                <button
                                    onClick={() => handleOpenProfile(selectedThread.participant_id)}
                                    className="text-left hover:bg-gray-50 dark:hover:bg-gray-700 p-2 -m-2 rounded-lg transition-colors group"
                                    title="Bekijk profiel"
                                >
                                    <h2 className="font-medium text-gray-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 flex items-center gap-2">
                                        {selectedThread.participant_name}
                                        <User className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </h2>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">
                                        {selectedThread.participant_email}
                                    </p>
                                </button>
                                <div className="flex items-center gap-2">
                                    <select
                                        value={selectedThread.status}
                                        onChange={(e) => handleUpdateStatus(selectedThread.id, e.target.value as any)}
                                        className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                    >
                                        <option value="open">Open</option>
                                        <option value="pending">In afwachting</option>
                                        <option value="closed">Gesloten</option>
                                    </select>
                                </div>
                            </div>

                            {/* Messages */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 dark:bg-gray-900">
                                {messagesLoading ? (
                                    <div className="flex items-center justify-center h-32">
                                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                                    </div>
                                ) : messages.length === 0 ? (
                                    <div className="text-center text-gray-500 dark:text-gray-400 py-8">
                                        Geen berichten
                                    </div>
                                ) : (
                                    <>
                                    {/* Load older messages button */}
                                    {pagination.hasMoreBefore && (
                                        <div className="text-center py-2">
                                            <button
                                                onClick={loadOlderMessages}
                                                disabled={loadingMore}
                                                className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
                                            >
                                                {loadingMore ? 'Laden...' : `Oudere berichten laden (${pagination.totalCount - messages.length} meer)`}
                                            </button>
                                        </div>
                                    )}
                                    {messages.map((message) => (
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
                                                {/* Sender name */}
                                                <p className={clsx(
                                                    'text-xs font-medium mb-1',
                                                    message.sender_type === 'organizer'
                                                        ? 'text-indigo-600 dark:text-indigo-400'
                                                        : 'text-gray-700 dark:text-gray-300'
                                                )}>
                                                    {message.sender_type === 'organizer' ? 'Jij' : (selectedThread.participant_name || 'Deelnemer')}
                                                </p>
                                                <div className={clsx(
                                                    'inline-block px-4 py-2 rounded-lg',
                                                    message.sender_type === 'organizer'
                                                        ? 'bg-indigo-600 text-white'
                                                        : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm',
                                                    message._optimistic && 'opacity-70'
                                                )}>
                                                    <p className="text-sm">{message.content}</p>
                                                </div>
                                                <p className={clsx(
                                                    'text-xs text-gray-500 dark:text-gray-400 mt-1',
                                                    message.sender_type === 'organizer' && 'text-right'
                                                )}>
                                                    {message._optimistic ? (
                                                        <span className="text-yellow-600">Verzenden...</span>
                                                    ) : (
                                                        new Date(message.created_at).toLocaleTimeString('nl-NL', {
                                                            hour: '2-digit',
                                                            minute: '2-digit'
                                                        })
                                                    )}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                    </>
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Reply Input */}
                            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                                {messagesError && (
                                    <div className="mb-2 text-sm text-red-600 dark:text-red-400">
                                        {messagesError}
                                    </div>
                                )}
                                <div className="flex gap-2">
                                    <textarea
                                        value={replyText}
                                        onChange={(e) => setReplyText(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && e.ctrlKey && !sending && replyText.trim()) {
                                                handleSendReply()
                                            }
                                        }}
                                        placeholder="Typ je antwoord... (Ctrl+Enter om te verzenden)"
                                        rows={3}
                                        className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                    />
                                    <button
                                        onClick={handleSendReply}
                                        disabled={sending || !replyText.trim()}
                                        className={clsx(
                                            'px-4 py-2 rounded-md font-medium text-sm h-fit',
                                            sending || !replyText.trim()
                                                ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                                                : 'bg-indigo-600 text-white hover:bg-indigo-700'
                                        )}
                                    >
                                        {sending ? 'Verzenden...' : 'Verzenden'}
                                    </button>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">
                            Selecteer een thread om berichten te zien
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
