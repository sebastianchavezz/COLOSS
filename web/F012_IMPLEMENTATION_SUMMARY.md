# F012 Messaging & FAQ Implementation Summary

## Overview
Created minimal, functional React components for F012 (messaging + FAQ system) without complex styling or dependencies. All components integrate with Edge Functions for backend communication.

---

## Files Created

### 1. `/Users/sebastianchavez/Desktop/COLOSS/web/src/pages/EventMessaging.tsx`
**Organizer messaging interface** - Two-panel layout for managing participant conversations.

**Features:**
- Left panel: Thread list with participant names, unread badges, status indicators, last message preview
- Right panel: Message thread chronologically displayed
- Status filter dropdown (All / Open / Pending / Closed)
- Reply textarea with send button
- Thread status management (Open/Pending/Closed)
- Auto-scroll to latest messages
- Unread count badge in header

**API Integration:**
- `GET /functions/v1/get-threads?event_id=X` - Fetch all threads
- `GET /functions/v1/get-thread-messages?thread_id=X` - Fetch messages for a thread
- `POST /functions/v1/send-message` - Send organizer reply (body: `{thread_id, event_id, content}`)
- `PATCH /functions/v1/update-thread-status` - Update thread status (body: `{thread_id, status}`)

**Route:** `/org/:orgSlug/events/:eventSlug/messaging` (Protected)

---

### 2. `/Users/sebastianchavez/Desktop/COLOSS/web/src/pages/ParticipantChat.tsx`
**Participant-facing chat interface** - Simple one-to-one messaging with organizer.

**Features:**
- Event slug resolution to event_id
- Auto-creates thread on first message
- Messages displayed chronologically
- Sender name and timestamp per message
- Keyboard shortcut: Ctrl+Enter to send
- "Start a conversation" prompt when no thread exists
- Link to FAQ at bottom of chat

**API Integration:**
- Query `events` table to resolve slug to ID
- `GET /functions/v1/get-thread-messages?thread_id=X` - Fetch messages
- `POST /functions/v1/send-message` - Send participant message (body: `{event_id, thread_id (optional), content}`)

**Route:** `/e/:eventSlug/chat` (Public)

---

### 3. `/Users/sebastianchavez/Desktop/COLOSS/web/src/pages/PublicFaq.tsx`
**Public FAQ page** - End-user facing knowledge base.

**Features:**
- Event slug resolution to event_id
- Search input (filters by title and content)
- Category chip tabs (All / [Category1] / [Category2] / etc)
- Accordion-style expandable FAQ items
- Each item shows: title, category, content
- "Contact Organisatie" CTA button linking to chat
- Responsive layout

**API Integration:**
- Query `events` table to resolve slug to ID
- `GET /functions/v1/get-faqs?event_id=X` - Fetch all published FAQs

**Route:** `/e/:eventSlug/faq` (Public)

---

### 4. `/Users/sebastianchavez/Desktop/COLOSS/web/src/pages/EventFaqAdmin.tsx`
**Organizer FAQ management** - Full CRUD interface for FAQ items.

**Features:**
- List all FAQ items (draft + published) in table format
- Create new FAQ button (shows/hides form)
- Edit FAQ item (inline form modal)
- Delete FAQ item (with confirmation)
- Sortable: up/down buttons to reorder items
- Status toggle (Draft / Published)
- Category management
- Form validation (title and content required)
- Success/error toast messages

**Table Columns:**
- Title (with content preview)
- Category
- Status (badge indicator)
- Sort order (with up/down controls)
- Actions (Edit/Delete buttons)

**API Integration:**
- Direct Supabase query to `faq_items` table (RLS enforces org isolation)
- `POST /functions/v1/faq-crud` - Create new FAQ
- `PUT /functions/v1/faq-crud` - Update FAQ item
- `DELETE /functions/v1/faq-crud` - Delete FAQ item
- Sort order updates via PUT to same endpoint

**Route:** `/org/:orgSlug/events/:eventSlug/faq` (Protected)

---

## Files Modified

### `/Users/sebastianchavez/Desktop/COLOSS/web/src/App.tsx`
**Added imports:**
```typescript
import { EventMessaging } from './pages/EventMessaging'
import { EventFaqAdmin } from './pages/EventFaqAdmin'
import { ParticipantChat } from './pages/ParticipantChat'
import { PublicFaq } from './pages/PublicFaq'
```

**Added routes:**
```typescript
// Public routes
<Route path="/e/:eventSlug/chat" element={<ParticipantChat />} />
<Route path="/e/:eventSlug/faq" element={<PublicFaq />} />

// Protected organizer routes (inside event detail)
<Route path="messaging" element={<EventMessaging />} />
<Route path="faq" element={<EventFaqAdmin />} />
```

---

### `/Users/sebastianchavez/Desktop/COLOSS/web/src/pages/EventDetail.tsx`
**Updated tabs array:**
Added two new tabs to the event detail navigation:
- "Berichten" (Messaging) → `/org/:orgSlug/events/:eventSlug/messaging`
- "FAQ" (FAQ Admin) → `/org/:orgSlug/events/:eventSlug/faq`

These appear in the horizontal tab bar alongside Overzicht, Tickets, Bestellingen, etc.

---

## Architecture & Patterns

### Authentication
- **Protected routes** use `ProtectedRoute` wrapper from existing codebase
- **Public pages** (chat, FAQ) are accessible without login
- **Token handling:** Uses `supabase.auth.getSession()` to get access token for API calls

### API Communication
- All Edge Function calls use `fetch()` to `${SUPABASE_URL}/functions/v1/{functionName}`
- Authenticated calls include `Authorization: Bearer {token}` header
- Consistent error handling with try-catch and error state

### State Management
- React hooks (`useState`, `useEffect`, `useCallback`)
- Context from `useOutletContext` for organizer views (event/org data)
- No external state management library

### Styling
- Tailwind CSS inline classes (minimal, functional)
- `clsx` utility for conditional classes
- Color scheme: Indigo (primary), Gray (neutral), Red (delete), Green (success)
- Responsive: works on mobile and desktop

### Data Resolution
- **Organizer views:** Event data passed via context from EventDetail
- **Public views:** Event slug resolved to event_id via direct Supabase query
- **Thread creation:** Automatic on first participant message

---

## Edge Function Dependencies

These components expect the following Edge Functions to exist and be deployed:

1. **get-threads** - List all message threads for an event
   - Query params: `event_id`
   - Auth: Required (Organizer only via RLS)

2. **get-thread-messages** - Get all messages in a thread
   - Query params: `thread_id`
   - Auth: Not required (public read or checked in function)

3. **send-message** - Create or respond to a message thread
   - Body: `{ event_id, thread_id?, content }`
   - Auth: Not required (RLS enforces proper isolation)
   - Creates thread if needed

4. **update-thread-status** - Change thread status
   - Method: PATCH
   - Body: `{ thread_id, status }`
   - Auth: Required (Organizer only)

5. **get-faqs** - Fetch published FAQ items
   - Query params: `event_id`, `category?`, `search?`
   - Auth: Not required (public read)

6. **faq-crud** - Create/update/delete FAQ items
   - Methods: POST (create), PUT (update), DELETE (delete)
   - Body: `{ id?, event_id, title, content, category, status, sort_order }`
   - Auth: Required (Organizer only via RLS)

---

## Testing Checklist

### EventMessaging (Organizer)
- [ ] Load `/org/demo/events/{slug}/messaging` - shows thread list
- [ ] Click thread - loads messages
- [ ] Filter by status - shows only matching threads
- [ ] Type reply and send - message appears
- [ ] Change thread status - status updates immediately
- [ ] Unread badge shows correct count
- [ ] Messages auto-scroll to bottom

### ParticipantChat (Public)
- [ ] Load `/e/{slug}/chat` - shows empty state
- [ ] Type message and send - creates thread and message
- [ ] Messages load on refresh
- [ ] Link to FAQ works
- [ ] Back button goes home

### PublicFaq (Public)
- [ ] Load `/e/{slug}/faq` - shows FAQ items
- [ ] Search filters by title/content
- [ ] Category chips filter correctly
- [ ] Click FAQ item - expands accordion
- [ ] Contact button links to chat
- [ ] No published items shows "Geen vragen gevonden"

### EventFaqAdmin (Organizer)
- [ ] Load `/org/demo/events/{slug}/faq` - shows list
- [ ] Create new FAQ - form appears, saves successfully
- [ ] Edit FAQ - form loads data, saves changes
- [ ] Delete FAQ - shows confirmation, removes item
- [ ] Sort order buttons - reorder items
- [ ] Status toggle - switch between draft/published
- [ ] Validation - requires title and content

---

## Known Limitations (MVP)

1. **Markdown rendering:** FAQ content displayed as plain text (no markdown parsing)
2. **Pagination:** No pagination on thread or FAQ lists (MVP)
3. **Typing indicators:** No "user is typing" feature
4. **Message search:** No search within a thread
5. **File uploads:** No attachment support in messages
6. **Notifications:** No email/push notifications for new messages
7. **Bulk FAQ import:** No CSV import for FAQs

---

## Next Steps for Full Implementation

1. **Backend:** Deploy Edge Functions (get-threads, send-message, etc.)
2. **Database:** Verify message_threads, messages, faq_items tables exist with proper RLS
3. **Testing:** Run test scenarios from checklist
4. **Polish:** Add loading skeletons, error recovery, retry logic
5. **Mobile:** Test responsive layout on small screens
6. **Accessibility:** Add ARIA labels, keyboard navigation

---

## File Sizes & Dependencies

- **EventMessaging.tsx:** ~325 lines, uses Lucide icons
- **ParticipantChat.tsx:** ~280 lines, uses Lucide icons
- **PublicFaq.tsx:** ~285 lines, uses Lucide icons
- **EventFaqAdmin.tsx:** ~410 lines, uses Lucide icons

**External packages used:**
- `react` (hooks)
- `react-router-dom` (routing)
- `lucide-react` (icons)
- `clsx` (utilities)
- `@supabase/supabase-js` (client, already in project)

No additional dependencies required.
