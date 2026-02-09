/**
 * EventEmbed Tab
 *
 * Organizer view for embedding the ticket widget on external websites.
 * Wraps the EmbedSnippetGenerator component.
 */

import { useOutletContext } from 'react-router-dom'
import type { AppEvent } from '../../types/supabase'
import { EmbedSnippetGenerator } from './EmbedSnippetGenerator'

export function EventEmbed() {
  const { event } = useOutletContext<{ event: AppEvent }>()

  if (!event) return null

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900">Embed Widget</h3>
        <p className="text-sm text-gray-500">
          Verkoop tickets direct op je eigen website met een embed widget.
        </p>
      </div>

      <EmbedSnippetGenerator
        eventSlug={event.slug}
        eventName={event.name}
      />
    </div>
  )
}
