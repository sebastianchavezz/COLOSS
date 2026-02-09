/**
 * EmbedSnippetGenerator
 *
 * Organizer dashboard component to generate the embed snippet for their event.
 * Shows a preview iframe and copy-paste HTML code.
 */

import { useState, useMemo } from 'react'
import { Copy, Check, Code, Eye, EyeOff } from 'lucide-react'

interface EmbedSnippetGeneratorProps {
  eventSlug: string
  eventName: string
}

export function EmbedSnippetGenerator({ eventSlug, eventName }: EmbedSnippetGeneratorProps) {
  const [accentColor, setAccentColor] = useState('#4f46e5')
  const [copied, setCopied] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  // Build the embed URL relative to the current origin
  const baseUrl = window.location.origin
  const embedUrl = useMemo(() => {
    const url = new URL(`${baseUrl}/embed/${eventSlug}`)
    if (accentColor !== '#4f46e5') {
      url.searchParams.set('accent', accentColor.replace('#', ''))
    }
    return url.toString()
  }, [baseUrl, eventSlug, accentColor])

  // The HTML snippet for the organizer
  const snippet = useMemo(() => {
    // The sourceUrl placeholder will be replaced by the organizer, or the script detects it
    const iframeSrc = embedUrl + (embedUrl.includes('?') ? '&' : '?') + 'sourceUrl=${WEBSITE_URL}'
    return `<!-- COLOSS Ticket Widget: ${eventName} -->
<iframe
  src="${iframeSrc}"
  style="width:100%;border:none;min-height:500px"
  allow="payment"
  loading="lazy"
  title="Tickets - ${eventName}"
></iframe>
<script src="${baseUrl}/embed.js" defer></script>`
  }, [embedUrl, eventName, baseUrl])

  // Simplified snippet (without sourceUrl placeholder for easy testing)
  const simpleSnippet = useMemo(() => {
    return `<!-- COLOSS Ticket Widget: ${eventName} -->
<iframe
  src="${embedUrl}"
  style="width:100%;border:none;min-height:500px"
  allow="payment"
  loading="lazy"
  title="Tickets - ${eventName}"
></iframe>
<script src="${baseUrl}/embed.js" defer></script>`
  }, [embedUrl, eventName, baseUrl])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(simpleSnippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: select text
      const textarea = document.createElement('textarea')
      textarea.value = simpleSnippet
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Code className="h-5 w-5 text-gray-400" />
            <h3 className="text-base font-semibold text-gray-900">Embed Widget</h3>
          </div>
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
          >
            {showPreview ? (
              <><EyeOff className="h-4 w-4" /> Verberg preview</>
            ) : (
              <><Eye className="h-4 w-4" /> Toon preview</>
            )}
          </button>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Plaats deze code op je website om tickets direct te verkopen.
        </p>
      </div>

      <div className="px-6 py-4 space-y-4">
        {/* Color picker */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Accent kleur
          </label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value)}
              className="h-8 w-8 rounded border border-gray-300 cursor-pointer"
            />
            <input
              type="text"
              value={accentColor}
              onChange={(e) => {
                if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) {
                  setAccentColor(e.target.value)
                }
              }}
              className="px-2 py-1 border border-gray-300 rounded text-sm font-mono w-24"
            />
            <span className="text-xs text-gray-400">Wordt gebruikt voor knoppen en prijzen</span>
          </div>
        </div>

        {/* Code snippet */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-700">
              HTML Code
            </label>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700"
            >
              {copied ? (
                <><Check className="h-4 w-4" /> Gekopieerd!</>
              ) : (
                <><Copy className="h-4 w-4" /> Kopieer code</>
              )}
            </button>
          </div>
          <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto text-xs leading-relaxed">
            <code>{simpleSnippet}</code>
          </pre>
        </div>

        {/* Preview */}
        {showPreview && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Preview
            </label>
            <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
              <iframe
                src={embedUrl}
                style={{ width: '100%', border: 'none', minHeight: '500px' }}
                title={`Preview - ${eventName}`}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
