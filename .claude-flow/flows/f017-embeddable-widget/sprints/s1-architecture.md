# S1: Embeddable Widget - Architecture

## Component Architecture

```
Organizer's Website                    COLOSS App
┌─────────────────────┐               ┌──────────────────────────┐
│                     │               │  /embed/:eventSlug       │
│  <iframe>           │ ──────────►   │  ┌────────────────────┐  │
│    src="/embed/..."  │               │  │ EmbedProvider       │  │
│  </iframe>          │  postMessage  │  │  ├─ EmbedCheckout   │  │
│                     │ ◄───────────► │  │  │  ├─ TicketList   │  │
│  <script embed.js>  │               │  │  │  ├─ GuestForm    │  │
│    auto-resize      │               │  │  │  ├─ OrderSummary │  │
│    event listeners  │               │  │  │  └─ Confirmation │  │
└─────────────────────┘               │  └────────────────────┘  │
                                      └──────────────────────────┘
```

## URL Schema
```
/embed/:eventSlug?sourceUrl=<encoded>&theme=light|dark&accent=<hex>
```

## postMessage Protocol

### iframe → parent
```typescript
// Resize request
{ type: 'coloss:resize', height: number }

// Checkout complete
{ type: 'coloss:checkout-complete', orderId: string, totalAmount: number }

// Error
{ type: 'coloss:error', message: string }

// Ready (loaded)
{ type: 'coloss:ready' }
```

### parent → iframe
```typescript
// Theme override (optional)
{ type: 'coloss:theme', accent: string }
```

## Payment Flow (Mollie in Popup)

```
1. User clicks "Afrekenen"
2. create-order-public returns checkout_url
3. window.open(checkout_url, '_blank', 'popup')
4. Poll order status via get-order-public every 2s
5. When status === 'paid', show confirmation inline
6. postMessage('coloss:checkout-complete') to parent
```

## Security Model

1. **No auth required** - Guest checkout with email
2. **Domain whitelist** - Optional `embed_settings.allowed_domains` in event_settings
3. **CSP frame-ancestors** - Set dynamically based on allowed domains
4. **sourceUrl validation** - Only used for analytics, sanitized
5. **Same Supabase anon key** - No elevated permissions
6. **Mollie popup** - Banks/PSPs block payment pages in iframes
