/**
 * PublicFaq Page
 *
 * Public FAQ page for end users.
 * Route: /e/:eventSlug/faq
 *
 * Features:
 * - Resolve eventSlug to event_id
 * - Display FAQ items by category
 * - Search functionality
 * - Expandable accordion items
 */

import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ChevronDown, Search, ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

interface FaqItem {
    id: string
    title: string
    content: string
    category: string
    sort_order: number
}

export function PublicFaq() {
    const { eventSlug } = useParams<{ eventSlug: string }>()
    const [eventId, setEventId] = useState<string | null>(null)
    const [eventName, setEventName] = useState<string>('')
    const [faqItems, setFaqItems] = useState<FaqItem[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
    const [expandedId, setExpandedId] = useState<string | null>(null)

    // Resolve eventSlug to event_id
    useEffect(() => {
        if (!eventSlug) return

        const resolveEvent = async () => {
            try {
                const { data, error: queryError } = await supabase
                    .from('events')
                    .select('id, name')
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
                setEventName(data.name || '')
                await fetchFaqs(data.id)
            } catch (err: any) {
                console.error('[PublicFaq] Error resolving event:', err)
                setError('Fout bij laden event')
                setLoading(false)
            }
        }

        resolveEvent()
    }, [eventSlug])

    // Fetch FAQ items
    const fetchFaqs = useCallback(async (eid: string) => {
        try {
            const response = await fetch(
                `${SUPABASE_URL}/functions/v1/get-faqs?event_id=${eid}`,
                {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                }
            )

            if (!response.ok) {
                throw new Error(`Failed to fetch FAQs: ${response.statusText}`)
            }

            const data = await response.json()
            setFaqItems(data.faqs || [])
        } catch (err: any) {
            console.error('[PublicFaq] Error fetching FAQs:', err)
            setError(err.message || 'Fout bij laden FAQ')
        } finally {
            setLoading(false)
        }
    }, [])

    // Get unique categories
    const categories = Array.from(new Set(faqItems.map(item => item.category)))

    // Filter FAQ items
    const filteredItems = faqItems.filter(item => {
        const matchesSearch = searchQuery === '' ||
            item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.content.toLowerCase().includes(searchQuery.toLowerCase())

        const matchesCategory = selectedCategory === null || item.category === selectedCategory

        return matchesSearch && matchesCategory
    })

    if (loading) {
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
                <div className="max-w-3xl mx-auto px-4 py-8 flex items-center gap-4">
                    <Link to="/" className="text-gray-500 hover:text-gray-700">
                        <ArrowLeft className="h-5 w-5" />
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">
                            Veelgestelde Vragen
                        </h1>
                        <p className="mt-1 text-gray-600">
                            {eventName}
                        </p>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-3xl mx-auto px-4 py-8">
                {error && (
                    <div className="mb-6 bg-red-50 border-l-4 border-red-400 p-4 text-red-700 rounded">
                        {error}
                    </div>
                )}

                {/* Search */}
                <div className="mb-8">
                    <div className="relative">
                        <Search className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Zoeken in FAQ..."
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                </div>

                {/* Category Chips */}
                {categories.length > 0 && (
                    <div className="mb-8">
                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={() => setSelectedCategory(null)}
                                className={clsx(
                                    'px-4 py-2 rounded-full text-sm font-medium transition-colors',
                                    selectedCategory === null
                                        ? 'bg-indigo-600 text-white'
                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                )}
                            >
                                Alle
                            </button>
                            {categories.map((cat) => (
                                <button
                                    key={cat}
                                    onClick={() => setSelectedCategory(cat)}
                                    className={clsx(
                                        'px-4 py-2 rounded-full text-sm font-medium transition-colors',
                                        selectedCategory === cat
                                            ? 'bg-indigo-600 text-white'
                                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                    )}
                                >
                                    {cat}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* FAQ Items */}
                <div className="space-y-4">
                    {filteredItems.length === 0 ? (
                        <div className="text-center py-12">
                            <p className="text-gray-500 text-lg">
                                Geen vragen gevonden
                            </p>
                        </div>
                    ) : (
                        filteredItems.map((item) => (
                            <div
                                key={item.id}
                                className="bg-white rounded-lg border border-gray-200 overflow-hidden"
                            >
                                <button
                                    onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                                    className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                                >
                                    <div className="text-left flex-1">
                                        <h3 className="font-medium text-gray-900">
                                            {item.title}
                                        </h3>
                                        {item.category && (
                                            <p className="text-sm text-gray-500 mt-1">
                                                {item.category}
                                            </p>
                                        )}
                                    </div>
                                    <ChevronDown
                                        className={clsx(
                                            'h-5 w-5 text-gray-400 flex-shrink-0 ml-4 transition-transform',
                                            expandedId === item.id && 'transform rotate-180'
                                        )}
                                    />
                                </button>

                                {expandedId === item.id && (
                                    <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
                                        <div className="text-gray-700 text-sm whitespace-pre-wrap">
                                            {item.content}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>

                {/* Contact CTA */}
                {faqItems.length > 0 && (
                    <div className="mt-12 bg-indigo-50 rounded-lg border border-indigo-200 p-6 text-center">
                        <h3 className="font-medium text-gray-900 mb-2">
                            Vind je antwoord niet?
                        </h3>
                        <p className="text-gray-600 mb-4">
                            Neem contact op met de organisatie.
                        </p>
                        <Link
                            to={`/e/${eventSlug}/chat`}
                            className="inline-block px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 font-medium text-sm"
                        >
                            Start een gesprek
                        </Link>
                    </div>
                )}
            </div>
        </div>
    )
}

// Helper function
function clsx(...classes: (string | undefined | false)[]): string {
    return classes.filter(Boolean).join(' ')
}
