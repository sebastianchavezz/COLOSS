# S1: Embeddable Widget - Sprint Plan

## Scope

### Frontend Components
1. **EmbedCheckout page** (`web/src/pages/embed/EmbedCheckout.tsx`)
   - Stripped checkout: no header, no nav, no footer
   - Guest checkout only (email field, no auth required)
   - Ticket selection + quantity controls
   - Mollie payment via popup window
   - Confirmation state inline
   - postMessage API for parent communication

2. **EmbedProvider context** (`web/src/contexts/EmbedContext.tsx`)
   - Detects if running inside iframe
   - Provides theme/config from URL params
   - Handles postMessage communication

3. **embed.js loader script** (`web/public/embed.js`)
   - Auto-resize iframe based on content height
   - Listen for postMessage events from iframe
   - Simple, zero-dependency, copy-paste ready

4. **EmbedSnippetGenerator** (`web/src/pages/events/EmbedSnippetGenerator.tsx`)
   - Organizer dashboard component
   - Generates `<iframe>` + `<script>` HTML
   - Preview of the embed
   - Copy-to-clipboard

### Route
- `/embed/:eventSlug` - Public embed route (no auth, no layout)

### Database
- Migration: add `embed_settings` domain to `event_settings` for domain whitelist

### Security
- Validate `sourceUrl` param
- Optional domain whitelist check
- CSP headers via meta tag for embed pages
- Mollie in popup window (banks block iframe payment)

## Files to Create/Modify
- CREATE: `web/src/pages/embed/EmbedCheckout.tsx`
- CREATE: `web/src/contexts/EmbedContext.tsx`
- CREATE: `web/public/embed.js`
- CREATE: `web/src/pages/events/EmbedSnippetGenerator.tsx`
- MODIFY: `web/src/App.tsx` (add embed route)
- CREATE: `supabase/migrations/20260209100000_f017_embed_settings.sql`
