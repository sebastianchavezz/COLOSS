/**
 * EmbedContext
 *
 * Provides embed-mode state to components rendered inside the /embed route.
 * Detects iframe context, reads URL params, and handles postMessage communication
 * with the parent window.
 *
 * Security:
 * - sourceUrl is sanitized (only http/https, stripped to origin+path)
 * - accentColor is validated (only hex colors)
 * - Incoming postMessages are validated for coloss: prefix and known types
 * - postToParent targets the sourceUrl origin when available (not wildcard)
 */

import { createContext, useContext, useEffect, useRef, useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'

interface EmbedContextType {
  /** Whether we're running inside an iframe */
  isEmbed: boolean
  /** The URL of the page embedding us (for analytics) */
  sourceUrl: string | null
  /** Accent color override */
  accentColor: string
  /** Send a message to the parent window */
  postToParent: (message: EmbedMessage) => void
  /** Notify parent of content height change */
  notifyResize: () => void
}

type EmbedMessage =
  | { type: 'coloss:resize'; height: number }
  | { type: 'coloss:checkout-complete'; orderId: string; totalAmount: number }
  | { type: 'coloss:error'; message: string }
  | { type: 'coloss:ready' }

/** Known incoming message types from parent */
const ALLOWED_INCOMING_TYPES = new Set(['coloss:theme'])

const EmbedContextInner = createContext<EmbedContextType | undefined>(undefined)

/** Check if we're inside an iframe */
function detectIframe(): boolean {
  try {
    return window.self !== window.top
  } catch {
    // Cross-origin restriction means we're definitely in an iframe
    return true
  }
}

/** Sanitize sourceUrl - only allow http(s) URLs, return origin + pathname */
function sanitizeSourceUrl(raw: string | null): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.origin + url.pathname
    }
  } catch {
    // Invalid URL
  }
  return null
}

/** Extract just the origin from a sanitized sourceUrl */
function extractOrigin(sanitizedUrl: string | null): string | null {
  if (!sanitizedUrl) return null
  try {
    return new URL(sanitizedUrl).origin
  } catch {
    return null
  }
}

/** Validate hex color - strict regex, only 3 or 6 hex digits */
function sanitizeAccentColor(raw: string | null): string {
  if (!raw) return '#4f46e5' // default indigo-600
  // Accept 3 or 6 digit hex only
  if (/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw)) {
    return raw.startsWith('#') ? raw : `#${raw}`
  }
  return '#4f46e5'
}

interface EmbedProviderProps {
  children: ReactNode
  sourceUrl?: string | null
  accent?: string | null
}

export function EmbedProvider({ children, sourceUrl, accent }: EmbedProviderProps) {
  const isEmbed = detectIframe()
  const resizeObserverRef = useRef<ResizeObserver | null>(null)

  const safeSourceUrl = useMemo(() => sanitizeSourceUrl(sourceUrl ?? null), [sourceUrl])
  const parentOrigin = useMemo(() => extractOrigin(safeSourceUrl), [safeSourceUrl])
  const accentColor = useMemo(() => sanitizeAccentColor(accent ?? null), [accent])

  // Post message to parent with origin restriction when possible
  const postToParent = useCallback((message: EmbedMessage) => {
    if (!isEmbed) return
    try {
      // Use specific origin when we know the sourceUrl, otherwise use '*'
      // '*' is acceptable here because all messages we send are non-sensitive
      // (resize height, completion status). No auth tokens or PII is sent.
      const targetOrigin = parentOrigin || '*'
      window.parent.postMessage(message, targetOrigin)
    } catch {
      // Silently fail if parent is unreachable
    }
  }, [isEmbed, parentOrigin])

  const notifyResize = useCallback(() => {
    if (!isEmbed) return
    const height = document.documentElement.scrollHeight
    postToParent({ type: 'coloss:resize', height })
  }, [isEmbed, postToParent])

  // Auto-resize on content changes
  useEffect(() => {
    if (!isEmbed) return

    // Notify ready
    postToParent({ type: 'coloss:ready' })

    // Observe body size changes for auto-resize
    const observer = new ResizeObserver(() => {
      notifyResize()
    })
    resizeObserverRef.current = observer
    observer.observe(document.body)

    // Initial resize
    notifyResize()

    return () => {
      observer.disconnect()
      resizeObserverRef.current = null
    }
  }, [isEmbed, postToParent, notifyResize])

  // Listen for messages from parent with origin validation
  useEffect(() => {
    if (!isEmbed) return

    function handleMessage(event: MessageEvent) {
      // Validate origin: only accept messages from the known parent origin
      if (parentOrigin && event.origin !== parentOrigin) return

      const data = event.data
      if (!data || typeof data !== 'object') return
      if (typeof data.type !== 'string') return

      // Only process known coloss: message types
      if (!ALLOWED_INCOMING_TYPES.has(data.type)) return

      // Handle theme override from parent
      if (data.type === 'coloss:theme') {
        const validatedAccent = sanitizeAccentColor(data.accent)
        console.log('[Embed] Theme override from parent:', validatedAccent)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [isEmbed, parentOrigin])

  return (
    <EmbedContextInner.Provider value={{
      isEmbed,
      sourceUrl: safeSourceUrl,
      accentColor,
      postToParent,
      notifyResize,
    }}>
      {children}
    </EmbedContextInner.Provider>
  )
}

export function useEmbed(): EmbedContextType {
  const ctx = useContext(EmbedContextInner)
  if (!ctx) {
    throw new Error('useEmbed must be used within an EmbedProvider')
  }
  return ctx
}
