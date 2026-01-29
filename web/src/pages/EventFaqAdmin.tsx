/**
 * EventFaqAdmin Page (Organizer FAQ Management)
 *
 * CRUD interface for FAQ items.
 * Route: /org/:orgSlug/events/:eventSlug/faq
 *
 * Features:
 * - List all FAQ items (draft + published)
 * - Create new FAQ item
 * - Edit FAQ item inline or via modal
 * - Delete FAQ item
 * - Toggle publish status
 * - Sort order management
 */

import { useEffect, useState, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Plus, Edit2, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../lib/supabase'
import type { AppEvent } from '../types/supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

type EventDetailContext = {
    event: AppEvent
    org: any
    refreshEvent: () => void
}

interface FaqItem {
    id: string
    title: string
    content: string
    category: string
    status: 'draft' | 'published'
    sort_order: number
    created_at: string
    updated_at: string
}

interface FormData {
    title: string
    content: string
    category: string
    status: 'draft' | 'published'
    sort_order: number
}

const initialFormData: FormData = {
    title: '',
    content: '',
    category: '',
    status: 'draft',
    sort_order: 0,
}

export function EventFaqAdmin() {
    const { event } = useOutletContext<EventDetailContext>()

    const [faqItems, setFaqItems] = useState<FaqItem[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)
    const [showForm, setShowForm] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [formData, setFormData] = useState<FormData>(initialFormData)
    const [submitting, setSubmitting] = useState(false)

    // Fetch FAQ items
    useEffect(() => {
        if (!event) return
        fetchFaqItems()
    }, [event?.id])

    const fetchFaqItems = useCallback(async () => {
        if (!event) return
        setLoading(true)
        setError(null)

        try {
            const { data, error: queryError } = await supabase
                .from('faq_items')
                .select('*')
                .eq('event_id', event.id)
                .order('sort_order', { ascending: true })

            if (queryError) {
                throw queryError
            }

            setFaqItems(data || [])
        } catch (err: any) {
            console.error('[EventFaqAdmin] Error fetching FAQs:', err)
            setError(err.message || 'Fout bij laden FAQ items')
        } finally {
            setLoading(false)
        }
    }, [event?.id])

    // Handle create/update
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!formData.title.trim() || !formData.content.trim()) {
            setError('Titel en inhoud zijn verplicht')
            return
        }

        if (!event) return

        setSubmitting(true)
        setError(null)

        try {
            const { data: { session } } = await supabase.auth.getSession()
            const token = session?.access_token

            const endpoint = editingId ? 'PUT' : 'POST'
            const url = `${SUPABASE_URL}/functions/v1/faq-crud`

            const response = await fetch(url, {
                method: endpoint,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    id: editingId || undefined,
                    event_id: event.id,
                    ...formData,
                }),
            })

            if (!response.ok) {
                throw new Error(`Failed to save FAQ: ${response.statusText}`)
            }

            setSuccess(editingId ? 'FAQ item bijgewerkt!' : 'FAQ item aangemaakt!')
            setTimeout(() => setSuccess(null), 3000)

            setFormData(initialFormData)
            setEditingId(null)
            setShowForm(false)
            await fetchFaqItems()
        } catch (err: any) {
            console.error('[EventFaqAdmin] Error saving FAQ:', err)
            setError(err.message || 'Fout bij opslaan FAQ item')
        } finally {
            setSubmitting(false)
        }
    }

    // Handle delete
    const handleDelete = async (id: string) => {
        if (!window.confirm('Weet je zeker dat je dit FAQ item wilt verwijderen?')) return

        if (!event) return

        setError(null)

        try {
            const { data: { session } } = await supabase.auth.getSession()
            const token = session?.access_token

            const response = await fetch(
                `${SUPABASE_URL}/functions/v1/faq-crud`,
                {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        id,
                        event_id: event.id,
                    }),
                }
            )

            if (!response.ok) {
                throw new Error(`Failed to delete FAQ: ${response.statusText}`)
            }

            setSuccess('FAQ item verwijderd!')
            setTimeout(() => setSuccess(null), 3000)
            await fetchFaqItems()
        } catch (err: any) {
            console.error('[EventFaqAdmin] Error deleting FAQ:', err)
            setError(err.message || 'Fout bij verwijderen FAQ item')
        }
    }

    // Handle edit
    const handleEdit = (item: FaqItem) => {
        setEditingId(item.id)
        setFormData({
            title: item.title,
            content: item.content,
            category: item.category,
            status: item.status,
            sort_order: item.sort_order,
        })
        setShowForm(true)
    }

    // Handle sort order change
    const handleChangeSort = async (id: string, newOrder: number) => {
        const updatedItems = faqItems.map(item =>
            item.id === id ? { ...item, sort_order: newOrder } : item
        )
        setFaqItems(updatedItems)

        // Persist to DB
        try {
            const { data: { session } } = await supabase.auth.getSession()
            const token = session?.access_token

            const item = faqItems.find(i => i.id === id)
            if (!item) return

            await fetch(
                `${SUPABASE_URL}/functions/v1/faq-crud`,
                {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        id,
                        event_id: event?.id,
                        title: item.title,
                        content: item.content,
                        category: item.category,
                        status: item.status,
                        sort_order: newOrder,
                    }),
                }
            )
        } catch (err: any) {
            console.error('[EventFaqAdmin] Error updating sort order:', err)
            // Revert on error
            fetchFaqItems()
        }
    }

    if (!event) {
        return <div className="p-4 text-gray-500">Event laden...</div>
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
        )
    }

    return (
        <div className="max-w-6xl">
            <div className="mb-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Veelgestelde Vragen</h1>
                        <p className="mt-1 text-sm text-gray-600">
                            Beheer FAQ items voor dit evenement
                        </p>
                    </div>
                    <button
                        onClick={() => {
                            setEditingId(null)
                            setFormData(initialFormData)
                            setShowForm(!showForm)
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 font-medium"
                    >
                        <Plus className="h-4 w-4" />
                        Nieuwe FAQ
                    </button>
                </div>
            </div>

            {error && (
                <div className="mb-4 bg-red-50 border-l-4 border-red-400 p-4 text-red-700 rounded">
                    {error}
                </div>
            )}

            {success && (
                <div className="mb-4 bg-green-50 border-l-4 border-green-400 p-4 text-green-700 rounded">
                    {success}
                </div>
            )}

            {/* Create/Edit Form */}
            {showForm && (
                <div className="mb-8 bg-white rounded-lg shadow-md border border-gray-200 p-6">
                    <h2 className="text-lg font-medium text-gray-900 mb-4">
                        {editingId ? 'FAQ item bewerken' : 'Nieuwe FAQ item'}
                    </h2>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Titel
                            </label>
                            <input
                                type="text"
                                value={formData.title}
                                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                placeholder="Bijv: Hoe kan ik mijn kaartje terugbetaald krijgen?"
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                disabled={submitting}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Inhoud
                            </label>
                            <textarea
                                value={formData.content}
                                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                                placeholder="Voer het antwoord in..."
                                rows={5}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                                disabled={submitting}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Categorie
                                </label>
                                <input
                                    type="text"
                                    value={formData.category}
                                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                    placeholder="Bijv: Betaling, Terugbetaling"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    disabled={submitting}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Status
                                </label>
                                <select
                                    value={formData.status}
                                    onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    disabled={submitting}
                                >
                                    <option value="draft">Concept</option>
                                    <option value="published">Gepubliceerd</option>
                                </select>
                            </div>
                        </div>

                        <div className="flex gap-2 justify-end">
                            <button
                                type="button"
                                onClick={() => {
                                    setShowForm(false)
                                    setEditingId(null)
                                    setFormData(initialFormData)
                                }}
                                disabled={submitting}
                                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 font-medium disabled:opacity-50"
                            >
                                Annuleren
                            </button>
                            <button
                                type="submit"
                                disabled={submitting}
                                className={clsx(
                                    'px-4 py-2 rounded-md font-medium text-white',
                                    submitting ? 'bg-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'
                                )}
                            >
                                {submitting ? 'Opslaan...' : 'Opslaan'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* FAQ Items Table */}
            <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
                {faqItems.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">
                        Nog geen FAQ items. Maak er een aan!
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-gray-200 bg-gray-50">
                                    <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">
                                        Titel
                                    </th>
                                    <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">
                                        Categorie
                                    </th>
                                    <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">
                                        Status
                                    </th>
                                    <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">
                                        Sorteren
                                    </th>
                                    <th className="px-6 py-3 text-right text-sm font-medium text-gray-700">
                                        Acties
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {faqItems.map((item) => (
                                    <tr
                                        key={item.id}
                                        className="border-b border-gray-200 hover:bg-gray-50"
                                    >
                                        <td className="px-6 py-4">
                                            <div>
                                                <p className="font-medium text-gray-900 truncate">
                                                    {item.title}
                                                </p>
                                                <p className="text-xs text-gray-500 truncate">
                                                    {item.content.substring(0, 50)}...
                                                </p>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-600">
                                            {item.category || '-'}
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={clsx(
                                                'text-xs font-medium px-2 py-1 rounded',
                                                item.status === 'published'
                                                    ? 'bg-green-100 text-green-800'
                                                    : 'bg-gray-100 text-gray-800'
                                            )}>
                                                {item.status === 'published' ? 'Gepubliceerd' : 'Concept'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => handleChangeSort(item.id, Math.max(0, item.sort_order - 1))}
                                                    className="p-1 text-gray-400 hover:text-gray-600"
                                                    title="Omhoog"
                                                >
                                                    <ChevronUp className="h-4 w-4" />
                                                </button>
                                                <span className="text-xs text-gray-500 w-8 text-center">
                                                    {item.sort_order}
                                                </span>
                                                <button
                                                    onClick={() => handleChangeSort(item.id, item.sort_order + 1)}
                                                    className="p-1 text-gray-400 hover:text-gray-600"
                                                    title="Omlaag"
                                                >
                                                    <ChevronDown className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <button
                                                onClick={() => handleEdit(item)}
                                                className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-medium text-sm mr-4"
                                            >
                                                <Edit2 className="h-4 w-4" />
                                                Bewerk
                                            </button>
                                            <button
                                                onClick={() => handleDelete(item.id)}
                                                className="inline-flex items-center gap-1 text-red-600 hover:text-red-700 font-medium text-sm"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                                Verwijder
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}
