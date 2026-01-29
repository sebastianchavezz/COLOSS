# F012 Web UI - Quick Reference Card

## Component Locations

```
web/src/pages/
├── EventMessaging.tsx      # Organizer: manage message threads
├── ParticipantChat.tsx     # Public: send/receive messages
├── PublicFaq.tsx           # Public: browse FAQ
└── EventFaqAdmin.tsx       # Organizer: CRUD FAQ items
```

## Routes

### Public (No Login Required)
```
GET /e/:eventSlug/chat          → ParticipantChat
GET /e/:eventSlug/faq           → PublicFaq
```

### Protected (Login Required)
```
GET /org/:orgSlug/events/:eventSlug/messaging   → EventMessaging
GET /org/:orgSlug/events/:eventSlug/faq         → EventFaqAdmin
```

**Navigation:** Both accessible via EventDetail tabs ("Berichten", "FAQ")

---

## Data Models

### Thread
```typescript
interface Thread {
    id: string                    // UUID
    participant_id: string        // User who started
    participant_name: string      // Denormalized for list
    participant_email: string     // Denormalized for list
    status: 'open' | 'pending' | 'closed'
    last_message_at: string       // ISO timestamp
    last_message_preview: string  // First 100 chars
    unread_count: number          // For organizer view
}
```

### Message
```typescript
interface Message {
    id: string                    // UUID
    thread_id: string             // Foreign key
    sender_type: 'participant' | 'organizer'
    sender_name: string           // Denormalized
    content: string               // Plain text
    created_at: string            // ISO timestamp
}
```

### FAQ Item
```typescript
interface FaqItem {
    id: string                    // UUID
    event_id: string              // Foreign key
    title: string                 // Question
    content: string               // Answer (plain text)
    category: string              // E.g. "Betaling", "Terugbetaling"
    status: 'draft' | 'published'
    sort_order: number            // 0, 1, 2, ...
    created_at: string            // ISO timestamp
    updated_at: string            // ISO timestamp
}
```

---

## API Endpoints (Edge Functions)

### Messaging

**Get threads** - List all message threads for event
```
GET /functions/v1/get-threads?event_id={eventId}
Auth: Required (Bearer token)
Response: { threads: Thread[] }
```

**Get messages** - Load messages in a thread
```
GET /functions/v1/get-thread-messages?thread_id={threadId}
Auth: Optional (RLS checks access)
Response: { messages: Message[] }
```

**Send message** - Create message (auto-creates thread)
```
POST /functions/v1/send-message
Auth: Required for organizer, Optional for participant
Body: {
    event_id: string,
    thread_id?: string,  // Omit to create new thread
    content: string
}
Response: { thread_id: string, message_id: string }
```

**Update status** - Change thread status
```
PATCH /functions/v1/update-thread-status
Auth: Required (Organizer only)
Body: {
    thread_id: string,
    status: 'open' | 'pending' | 'closed'
}
Response: { success: boolean }
```

### FAQ

**Get FAQs** - Fetch published FAQ items
```
GET /functions/v1/get-faqs?event_id={eventId}&category={category}&search={query}
Auth: Not required (public)
Response: { faqs: FaqItem[] }
```

**FAQ CRUD** - Create, update, or delete FAQ items
```
POST   /functions/v1/faq-crud  # Create
PUT    /functions/v1/faq-crud  # Update
DELETE /functions/v1/faq-crud  # Delete

Auth: Required (Organizer only via RLS)
Body: {
    id?: string,            # Required for PUT/DELETE
    event_id: string,
    title: string,
    content: string,
    category: string,
    status: 'draft' | 'published',
    sort_order: number
}
Response: { success: boolean, faq?: FaqItem }
```

---

## Common Patterns

### Fetch from Edge Function
```typescript
const { data: { session } } = await supabase.auth.getSession()
const token = session?.access_token

const response = await fetch(
    `${SUPABASE_URL}/functions/v1/function-name`,
    {
        method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ /* payload */ })
    }
)

if (!response.ok) throw new Error(response.statusText)
const data = await response.json()
```

### Query Supabase Directly
```typescript
const { data, error } = await supabase
    .from('table_name')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })

if (error) throw error
setItems(data)
```

### Error Toast
```typescript
setError(err.message || 'Fout bij ...')
setTimeout(() => setError(null), 3000)
```

### Loading State
```typescript
const [loading, setLoading] = useState(true)
// ...
{loading ? (
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
) : (
    /* content */
)}
```

---

## Styling Quick Notes

**Colors Used:**
- Primary: `indigo-600` (buttons, links)
- Hover: `indigo-700`
- Success: `green-100` / `green-800`
- Warning: `yellow-100` / `yellow-800`
- Error: `red-50` / `red-700`
- Neutral: `gray-*`

**Common Classes:**
- Buttons: `px-4 py-2 rounded-md font-medium`
- Cards: `bg-white rounded-lg shadow border border-gray-200`
- Input: `px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500`
- Badge: `px-2 py-1 rounded text-sm font-medium`

**Responsive:**
- Mobile: No breakpoints used (full width)
- Desktop: Optional max-width containers (`max-w-3xl`, `max-w-6xl`)
- Use `grid` for multi-column layouts

---

## Debugging Tips

### Check Token
```typescript
const { data: { session } } = await supabase.auth.getSession()
console.log('Token:', session?.access_token?.slice(0, 50) + '...')
```

### Test API Directly
```bash
curl -H "Authorization: Bearer $TOKEN" \
     "http://localhost:54321/functions/v1/get-faqs?event_id=xxx"
```

### Check RLS Policies
```sql
-- In Supabase SQL Editor
SELECT * FROM pg_policies WHERE tablename = 'faq_items';
```

### Browser DevTools
- **Network tab:** Check API calls (status, response)
- **Console:** Look for TypeScript/React errors
- **Application:** Check sessionStorage for auth token
- **Elements:** Inspect element structure

---

## Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| 401 Unauthorized | Token missing/invalid. Check auth session |
| 404 Not Found | Edge Function not deployed or wrong path |
| Empty list | Check database query, RLS policies, filters |
| Form won't submit | Check validation (try console.log formData) |
| Page won't load | Check useEffect dependencies, error in console |
| Styling looks wrong | Clear browser cache, check Tailwind build |
| Mobile layout broken | Check max-width containers, add responsive classes |

---

## Testing Checklist

```
Before pushing to production:
☐ All pages render without errors
☐ Forms accept input
☐ Send/Create buttons work
☐ No console errors
☐ Responsive on mobile
☐ Error messages appear
☐ Loading states show
☐ Success messages appear
☐ Can filter/search
☐ Can edit/delete items
```

---

## File Structure

```
web/src/
├── pages/
│   ├── EventMessaging.tsx         ← Organizer threads
│   ├── ParticipantChat.tsx        ← Public chat
│   ├── PublicFaq.tsx              ← Public FAQ
│   ├── EventFaqAdmin.tsx          ← Organizer FAQ admin
│   ├── EventDetail.tsx            ← MODIFIED (added tabs)
│   └── ...
├── components/
│   ├── Layout.tsx
│   ├── ProtectedRoute.tsx
│   └── ...
├── contexts/
│   └── AuthContext.tsx
├── lib/
│   └── supabase.ts
├── types/
│   └── supabase.ts
└── App.tsx                        ← MODIFIED (added routes)
```

---

## Environment Variables

```bash
# In web/.env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

## Start Dev Server

```bash
cd /Users/sebastianchavez/Desktop/COLOSS/web
npm install
npm run dev
# http://localhost:5173
```

---

## Useful Commands

```bash
# Type checking
npm run build

# Format code (if prettier installed)
npx prettier --write src/pages/EventMessaging.tsx

# Run dev with logs
npm run dev 2>&1 | tee dev.log

# Check for unused imports
grep -n "import.*from" src/pages/EventMessaging.tsx
```

---

## Handoff Summary

✅ **4 components** created (1,300 lines code)
✅ **2 routes** added to App.tsx
✅ **2 tabs** added to EventDetail
✅ **20 test scenarios** documented
✅ **Full documentation** provided
✅ **Ready for testing** - no missing pieces

**Next:** @tester runs TESTING_GUIDE_F012.md
