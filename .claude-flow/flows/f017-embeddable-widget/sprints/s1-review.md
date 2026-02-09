# Code Review: F017 Embeddable Widget - Sprint 1

## Summary
Solid implementation of iframe-based embeddable widget with good security awareness. The code demonstrates understanding of postMessage communication, XSS prevention, and iframe auto-resize patterns. However, there are several critical security issues and code quality concerns that must be addressed before production.

## Verdict
- [ ] APPROVED - Ready for testing
- [ ] APPROVED WITH COMMENTS - Minor issues, can proceed
- [x] CHANGES REQUESTED - Must fix before testing
- [ ] REJECTED - Major issues, needs redesign

---

## Critical Issues (Must Fix)

### Issue 1: postMessage Origin Validation Missing
**File**: `/Users/sebastianchavez/Desktop/COLOSS/web/src/contexts/EmbedContext.tsx:83`
**Severity**: Critical
**Category**: Security

**Problem**:
The `postToParent` function posts messages with wildcard origin (`'*'`), which allows ANY parent window to receive these messages. While the messages don't contain sensitive data, this is a security anti-pattern. More critically, the incoming message handler at line 120-133 does NOT validate `event.origin`, meaning any page could send fake messages to the embed.

```typescript
postToParent: (message: EmbedMessage) => {
  if (!isEmbed) return
  try {
    window.parent.postMessage(message, '*')  // SECURITY: Wildcard origin
  } catch {
    // Silently fail if parent is unreachable
  }
}
```

And at line 120:
```typescript
function handleMessage(event: MessageEvent) {
  const data = event.data
  if (!data || typeof data !== 'object') return
  
  // Handle theme override from parent
  if (data.type === 'coloss:theme' && data.accent) {
    // NO ORIGIN VALIDATION!
    console.log('[Embed] Theme override from parent:', data.accent)
  }
}
```

**Suggested Fix**:
1. Store allowed parent origins from `sourceUrl` param
2. Validate `event.origin` before processing messages
3. Use specific origin in `postMessage` when known

```typescript
// In EmbedProvider
const allowedOrigin = useMemo(() => {
  if (!safeSourceUrl) return '*'
  try {
    return new URL(safeSourceUrl).origin
  } catch {
    return '*'
  }
}, [safeSourceUrl])

const postToParent = useCallback((message: EmbedMessage) => {
  if (!isEmbed) return
  try {
    // Use specific origin if known, otherwise fallback to wildcard
    const targetOrigin = allowedOrigin || '*'
    window.parent.postMessage(message, targetOrigin)
  } catch {
    // Silently fail if parent is unreachable
  }
}, [isEmbed, allowedOrigin])

// In handleMessage
function handleMessage(event: MessageEvent) {
  // CRITICAL: Validate origin
  if (allowedOrigin !== '*' && event.origin !== allowedOrigin) {
    console.warn('[Embed] Blocked message from unauthorized origin:', event.origin)
    return
  }
  
  const data = event.data
  if (!data || typeof data !== 'object') return
  
  // ... rest of handler
}
```

---

### Issue 2: No CSP frame-ancestors Implementation
**File**: Multiple files (missing HTTP headers)
**Severity**: Critical
**Category**: Security

**Problem**:
The migration file comments mention CSP `frame-ancestors` but there is no actual implementation. Without `frame-ancestors`, any website can embed the widget, even if the event has domain restrictions configured in `embed_settings`. The domain whitelist in the database is useless without server-side enforcement.

**Suggested Fix**:
Add CSP headers to the embed route. This requires either:

**Option A: Static CSP (allow all)**
In Vite config or hosting provider (Vercel/Netlify):
```http
Content-Security-Policy: frame-ancestors *;
```

**Option B: Dynamic CSP based on event settings**
Create an Edge Function to serve the embed page with dynamic CSP:
```typescript
// supabase/functions/embed-page/index.ts
Deno.serve(async (req) => {
  const url = new URL(req.url)
  const eventSlug = url.pathname.split('/')[2]
  
  // Fetch event embed settings
  const { data: settings } = await supabase
    .from('event_settings')
    .select('value')
    .eq('domain', 'embed')
    .eq('key', 'allowed_domains')
    .maybeSingle()
  
  const allowedDomains = settings?.value || []
  const frameAncestors = allowedDomains.length > 0
    ? allowedDomains.join(' ')
    : '*'
  
  // Serve HTML with CSP header
  return new Response(embedHtml, {
    headers: {
      'Content-Type': 'text/html',
      'Content-Security-Policy': `frame-ancestors ${frameAncestors}`,
    }
  })
})
```

**Recommendation**: Start with Option A (allow all) for MVP, implement Option B later for paid feature (domain whitelisting).

---

### Issue 3: Accent Color XSS via Style Injection
**File**: `/Users/sebastianchavez/Desktop/COLOSS/web/src/pages/embed/EmbedCheckout.tsx:347, 388, 455, 520, 616`
**Severity**: Critical
**Category**: Security - XSS

**Problem**:
The `accentColor` is sanitized in `EmbedContext.sanitizeAccentColor()`, but it's injected directly into `style` attributes without additional validation. While the regex `/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/` is good, there's still a theoretical XSS risk if the sanitization is bypassed or modified in the future.

Current pattern:
```typescript
<button style={{ backgroundColor: accentColor }}>
```

**Suggested Fix**:
No immediate fix needed since the regex is solid, but add defense-in-depth:

1. Add CSS variable approach (safer):
```typescript
// In EmbedProvider, set CSS custom property
useEffect(() => {
  document.documentElement.style.setProperty('--embed-accent', accentColor)
}, [accentColor])

// In components
<button style={{ backgroundColor: 'var(--embed-accent)' }}>
```

2. Or double-sanitize at component level:
```typescript
const safeAccent = useMemo(() => {
  return /^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : '#4f46e5'
}, [accentColor])
```

---

### Issue 4: Polling Memory Leak Risk
**File**: `/Users/sebastianchavez/Desktop/COLOSS/web/src/pages/embed/EmbedCheckout.tsx:192-228`
**Severity**: High
**Category**: Performance / Bug

**Problem**:
The polling interval starts at line 195 but has weak cleanup. If the component unmounts during polling (e.g., user closes parent page), the interval keeps running for 10 minutes. The cleanup at lines 126-130 only handles `pollRef.current`, but if `startPolling` is called multiple times rapidly, there could be multiple timers.

```typescript
const startPolling = useCallback((publicToken: string) => {
  if (pollRef.current) clearInterval(pollRef.current)  // Only clears ONE previous
  
  pollRef.current = setInterval(async () => {
    // ... polling logic
  }, 2500)
  
  // 10-minute timeout
  setTimeout(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, 10 * 60 * 1000)  // This setTimeout is NOT cleaned up
}, [postToParent])
```

**Suggested Fix**:
Store the timeout ID and clean it up:

```typescript
const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

const startPolling = useCallback((publicToken: string) => {
  // Clear previous polling
  if (pollRef.current) clearInterval(pollRef.current)
  if (timeoutRef.current) clearTimeout(timeoutRef.current)
  
  pollRef.current = setInterval(async () => {
    // ... polling logic
  }, 2500)
  
  // 10-minute timeout
  timeoutRef.current = setTimeout(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, 10 * 60 * 1000)
}, [postToParent])

// Cleanup on unmount
useEffect(() => {
  return () => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
  }
}, [])
```

---

### Issue 5: Popup Blocked Fallback Incomplete
**File**: `/Users/sebastianchavez/Desktop/COLOSS/web/src/pages/embed/EmbedCheckout.tsx:301-308`
**Severity**: High
**Category**: UX / Security

**Problem**:
When the Mollie popup is blocked (line 302), the code shows an error but doesn't provide a fallback link. The user is stuck with no way to complete payment. The comment suggests "redirect in current window" but this would break out of the iframe and navigate the parent page away - terrible UX.

```typescript
if (!popup || popup.closed) {
  // Fallback: redirect in current window (breaks out of iframe, but at least works)
  setError('Popup geblokkeerd. Klik op de link om te betalen.')
  setStep('checkout')
  setSubmitting(false)
  return  // No link provided!
}
```

**Suggested Fix**:
Store the checkout URL and show it as a clickable link:

```typescript
const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null)

// In handleCheckout
if (data?.checkout_url) {
  setCheckoutUrl(data.checkout_url)
  setStep('processing')
  const popup = window.open(...)
  popupRef.current = popup
  
  if (!popup || popup.closed) {
    setError('popup-blocked')  // Special error flag
    setStep('checkout')
    setSubmitting(false)
    return
  }
}

// In render (checkout step)
{error === 'popup-blocked' && checkoutUrl && (
  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
    <p className="text-sm text-yellow-800 mb-2">
      Je browser blokkeert pop-ups. Klik op de knop hieronder om te betalen:
    </p>
    <a
      href={checkoutUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center px-4 py-2 text-sm font-medium text-white rounded-lg"
      style={{ backgroundColor: accentColor }}
    >
      Open betaalpagina
    </a>
  </div>
)}
```

---

## Warnings (Should Fix)

### Warning 1: No Rate Limiting on Order Creation
**File**: `/Users/sebastianchavez/Desktop/COLOSS/web/src/pages/embed/EmbedCheckout.tsx:272-279`
**Problem**: The embed widget calls `create-order-public` without any client-side rate limiting. A malicious actor could spam order creation from an embedded iframe, creating spam registrations or inventory DoS attacks.

**Suggestion**: 
- Add a simple client-side debounce (1 submission per 3 seconds)
- Backend should have rate limiting on `create-order-public` Edge Function (per IP + event)

```typescript
const lastSubmitRef = useRef<number>(0)

const handleCheckout = async () => {
  const now = Date.now()
  if (now - lastSubmitRef.current < 3000) {
    setError('Even geduld, te snel...')
    return
  }
  lastSubmitRef.current = now
  
  // ... rest of checkout logic
}
```

---

### Warning 2: Email Validation Is Too Weak
**File**: `/Users/sebastianchavez/Desktop/COLOSS/web/src/pages/embed/EmbedCheckout.tsx:189`
**Problem**: The email regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` is basic and allows invalid emails like `a@b.c`. While this is technically valid, it won't catch common typos like `user@gmailcom` or `user@gmail.`.

**Suggestion**: Use a more robust regex or a library like `validator.js`:

```typescript
const isValidEmail = (e: string) => {
  const regex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
  return regex.test(e)
}
```

Or better yet, add backend validation in `create-order-public`.

---

### Warning 3: No Loading State for Ticket Fetch
**File**: `/Users/sebastianchavez/Desktop/COLOSS/web/src/pages/embed/EmbedCheckout.tsx:103-110`
**Problem**: If `get_ticket_availability` RPC call fails or is slow, the widget shows a generic loader with no indication that ticket fetching failed. User sees "Event niet gevonden" even though the event exists.

**Suggestion**: Split loading states:

```typescript
const [loadingEvent, setLoadingEvent] = useState(true)
const [loadingTickets, setLoadingTickets] = useState(false)

// In fetchEvent
setEvent(eventData)
setLoadingEvent(false)
setLoadingTickets(true)

const { data: availabilityData, error: availabilityError } = await supabase
  .rpc('get_ticket_availability', { _event_id: eventData.id })

if (availabilityError) {
  setError('Kon tickets niet ophalen. Probeer opnieuw.')
} else {
  setTickets(availabilityData?.ticket_types || [])
}
setLoadingTickets(false)
```

---

### Warning 4: ResizeObserver Not Cleaned Up Properly
**File**: `/Users/sebastianchavez/Desktop/COLOSS/web/src/contexts/EmbedContext.tsx:96-114`
**Problem**: The `ResizeObserver` is initialized but the cleanup only calls `disconnect()`. If the `EmbedProvider` is unmounted and re-mounted quickly (e.g., React StrictMode in dev), there could be multiple observers.

**Suggestion**: Reset the ref to null after disconnect:

```typescript
return () => {
  if (resizeObserverRef.current) {
    resizeObserverRef.current.disconnect()
    resizeObserverRef.current = null
  }
}
```

---

### Warning 5: Snippet Uses Template Literal Without Escaping
**File**: `/Users/sebastianchavez/Desktop/COLOSS/web/src/pages/events/EmbedSnippetGenerator.tsx:34`
**Problem**: The snippet includes `sourceUrl=${WEBSITE_URL}` which is meant as a placeholder for the organizer to replace, but it's not clearly documented and could be confusing.

**Suggestion**: Use a clearer placeholder and add a comment:

```typescript
const snippet = useMemo(() => {
  const iframeSrc = embedUrl + (embedUrl.includes('?') ? '&' : '?') + 'sourceUrl=https://your-website.com'
  return `<!-- COLOSS Ticket Widget: ${eventName} -->
<!-- Replace "https://your-website.com" with your actual domain -->
<iframe
  src="${iframeSrc}"
  style="width:100%;border:none;min-height:500px"
  allow="payment"
  loading="lazy"
  title="Tickets - ${eventName}"
></iframe>
<script src="${baseUrl}/embed.js" defer></script>`
}, [embedUrl, eventName, baseUrl])
```

Or better: detect the actual parent origin client-side in the embed and don't require the param at all.

---

## Supabase Specific Findings

### RLS Policies
| Table | Has RLS | Policy Count | Issues |
|-------|---------|--------------|--------|
| event_settings | Assumed Yes | Unknown | Migration only adds comment, doesn't create RLS policy for embed domain |
| events | Yes (assumed) | Unknown | Widget uses `getPublicEventBySlug` - assumes RLS allows public read for published events |

**Issue**: The migration doesn't verify that `event_settings` has a policy allowing organizers to read/write `embed.*` settings. Without this, the `EmbedSnippetGenerator` component may fail to save domain whitelist settings (though this feature isn't implemented yet).

**Recommendation**: Add explicit RLS policy in migration:

```sql
-- Allow event organizers to manage embed settings
CREATE POLICY "organizers_manage_embed_settings"
ON event_settings
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = event_settings.event_id
    AND e.org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'admin')
    )
  )
);
```

---

### Auth Patterns
- **Guest checkout correctly implemented**: Widget uses `create-order-public` Edge Function which doesn't require auth
- **No auth token leakage**: Widget never calls `supabase.auth.getSession()` or exposes tokens
- **Email is user input**: Properly treated as untrusted, validated on both client and server

**Finding**: The widget correctly implements anonymous/guest checkout without leaking any authenticated user state to the parent window.

---

### Query Performance
- **get_ticket_availability RPC**: Called once on load, good caching potential
- **No N+1 queries**: Single RPC call returns all ticket types with availability
- **Polling overhead**: Polls `get-order-public` every 2.5 seconds for up to 10 minutes - this is acceptable for low volume, but consider exponential backoff for production

**Suggestion**: Add exponential backoff to polling:

```typescript
let pollInterval = 2500
const maxInterval = 10000

pollRef.current = setInterval(async () => {
  const { data } = await supabase.functions.invoke('get-order-public', ...)
  
  if (data?.order?.status === 'paid') {
    // ... handle success
  } else {
    // Increase interval
    pollInterval = Math.min(pollInterval * 1.2, maxInterval)
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = setInterval(/* recursive */, pollInterval)
    }
  }
}, pollInterval)
```

---

## Code Quality Findings

### TypeScript Usage
- **Good**: Proper interfaces for ticket types, validation errors, messages
- **Good**: No `any` types except for stats (line 468) - acceptable for RPC results
- **Warning**: `event` state is typed as `any` (line 69) - should be `AppEvent | null`

**Fix**:
```typescript
const [event, setEvent] = useState<AppEvent | null>(null)
```

---

### Error Handling
- **Good**: Graceful fallback for postMessage failures (catch blocks)
- **Good**: Validation errors are properly typed and translated
- **Warning**: Silent failures in polling (line 216) - should at least log to console for debugging
- **Warning**: No retry logic for failed API calls

---

### Accessibility
- **Missing**: No ARIA labels on quantity buttons
- **Missing**: No keyboard navigation for ticket selection
- **Missing**: Form inputs have labels (good) but missing `aria-describedby` for errors
- **Missing**: Loading spinner has no `aria-live` region

**Suggestions**:
```typescript
<button
  aria-label={`Decrease quantity for ${ticket.name}`}
  onClick={() => handleQuantityChange(ticket.id, -1)}
>
  &minus;
</button>

<div role="alert" aria-live="polite">
  {error && <p className="text-sm text-red-800">{error}</p>}
</div>
```

---

### Performance
- **Good**: Uses `useMemo` for computed values (totalPrice, totalItems)
- **Good**: Debounced resize notification with 50ms timeout
- **Warning**: `notifyResize` depends on `postToParent` which is recreated on every `isEmbed` change - should be stable
- **Warning**: `useEffect` with many dependencies (line 119-123) triggers resize on every state change - could be optimized

---

## Security Audit Summary

| Category | Status | Issues Found |
|----------|--------|--------------|
| XSS Prevention | ⚠️ Warning | Accent color injection (low risk), sourceUrl sanitization (OK) |
| CSRF | ✅ Pass | No auth required, guest checkout safe |
| postMessage Security | ❌ Critical | No origin validation, wildcard posting |
| CSP | ❌ Critical | No frame-ancestors implementation |
| Auth Leakage | ✅ Pass | No tokens exposed to parent |
| Input Validation | ⚠️ Warning | Email regex too weak, no rate limiting |
| RLS Bypass | ⚠️ Warning | Migration doesn't verify embed settings RLS |

---

## Testing Checklist

Before approving:
- [ ] Test embed on different domains (localhost, staging, production)
- [ ] Test popup blocker scenario - verify fallback link works
- [ ] Test with AdBlockers (uBlock Origin, etc.) - may block postMessage or iframe
- [ ] Test auto-resize with different screen sizes (mobile, tablet, desktop)
- [ ] Test free order flow (no Mollie popup)
- [ ] Test paid order flow with actual Mollie payment
- [ ] Test concurrent order attempts (race conditions)
- [ ] Test XSS with malicious accent color: `?accent=red;background:url(javascript:alert(1))`
- [ ] Test postMessage hijacking: parent page sends fake `coloss:theme` messages
- [ ] Test CSP enforcement: embed on unauthorized domain (when whitelisting implemented)

---

## Conclusion

The F017 implementation demonstrates good understanding of iframe communication patterns and security considerations. The code is well-structured with clear separation of concerns. However, **critical security issues with postMessage origin validation and missing CSP implementation** prevent approval at this stage.

The widget is functionally complete but needs security hardening before production deployment.

### Recommended Actions
1. **CRITICAL**: Fix postMessage origin validation (Issue 1)
2. **CRITICAL**: Implement CSP frame-ancestors (Issue 2)
3. **HIGH**: Fix polling cleanup (Issue 4)
4. **HIGH**: Add popup blocked fallback link (Issue 5)
5. **MEDIUM**: Add rate limiting (Warning 1)
6. **LOW**: Improve email validation (Warning 2)

Once Issues 1-5 are fixed, re-submit for review.

---

## Files Reviewed
1. `/Users/sebastianchavez/Desktop/COLOSS/web/src/pages/embed/EmbedCheckout.tsx` - Main embed checkout page
2. `/Users/sebastianchavez/Desktop/COLOSS/web/src/contexts/EmbedContext.tsx` - Embed context with postMessage
3. `/Users/sebastianchavez/Desktop/COLOSS/web/public/embed.js` - Auto-resize script
4. `/Users/sebastianchavez/Desktop/COLOSS/web/src/pages/events/EmbedSnippetGenerator.tsx` - Snippet generator
5. `/Users/sebastianchavez/Desktop/COLOSS/web/src/pages/events/EventEmbed.tsx` - Embed tab wrapper
6. `/Users/sebastianchavez/Desktop/COLOSS/web/src/App.tsx` - Route additions
7. `/Users/sebastianchavez/Desktop/COLOSS/web/src/pages/EventDetail.tsx` - Sidebar nav addition
8. `/Users/sebastianchavez/Desktop/COLOSS/supabase/migrations/20260209100000_f017_embed_settings.sql` - DB migration
