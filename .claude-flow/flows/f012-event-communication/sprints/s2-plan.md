# Sprint S2: F012 - Minimal UI (Participant Chat + Organizer Threads + FAQ Pages)

## Metadata

| Field | Value |
|-------|-------|
| **Flow** | F012 - Event Communication |
| **Sprint** | S2 - Frontend UI |
| **Phase** | Planning |
| **Created** | 2026-01-28 |
| **Author** | @pm |
| **Depends on** | S1 (all backend infrastructure must be complete) |

---

## Sprint Goal

Deliver functional minimal UI for: participant sending a message to the organizer, organizer viewing and replying to threads with unread badges, and public FAQ browsing with search and category filtering. Organizer FAQ CRUD admin page.

---

## Success Criteria

- [ ] Participant can open "Contact Organisator" chat from their event confirmation page and send a message
- [ ] Organizer sees thread list under event > communication > messages with unread badges
- [ ] Organizer can click a thread, see message history, and reply
- [ ] Organizer can close/reopen threads via status toggle
- [ ] Public FAQ page renders published FAQs with search input and category filter
- [ ] Organizer FAQ admin page: table listing all items (draft + published), create/edit/publish/delete
- [ ] All pages use existing layout patterns (Layout component, ProtectedRoute where needed)
- [ ] Error states handled (network failure, unauthorized, empty states)

---

## Tasks

### Task 2.1: Participant Chat View Component
- **Agent**: @web
- **Priority**: P0 (must)
- **Size**: L
- **Acceptance Criteria**:
  - Page: `/e/:eventSlug/chat` (public route, requires auth + valid participation)
  - Shows single thread: "Contact Organisator" header
  - Message list scrollable, newest at bottom
  - Messages show: sender label (You / Organisator), content, timestamp
  - Text input at bottom with send button
  - Rate limit error shown inline if exceeded ("Wacht even voordat je opnieuw schrijft")
  - Empty state if no messages yet ("Stuur je eerste bericht naar de organisator")
  - Loading skeleton while fetching thread
  - On first message (no thread exists yet): thread is created automatically via send-message Edge Function

### Task 2.2: Organizer Thread List Page
- **Agent**: @web
- **Priority**: P0 (must)
- **Size**: M
- **Acceptance Criteria**:
  - Route: `/org/:orgSlug/events/:eventSlug/communication/messages` (new sub-route under communication)
  - Table/list of threads: participant name, last message preview (truncated to 60 chars), unread badge (integer > 0 shown), status (Open/Closed chip), last activity timestamp
  - Sorted by: newest activity first
  - Status filter tabs: All / Open / Closed
  - Clicking a thread navigates to thread detail view
  - Empty state: "Nog geen berichten ontvangen"

### Task 2.3: Organizer Thread Detail View
- **Agent**: @web
- **Priority**: P0 (must)
- **Size**: L
- **Acceptance Criteria**:
  - Route: `/org/:orgSlug/events/:eventSlug/communication/messages/:threadId`
  - Header: participant name + Open/Closed toggle button
  - Message history: same layout as participant view but with organizer perspective (their messages on right, participant on left)
  - Reply input at bottom (organizer sending)
  - Close/Reopen button in header (calls update-thread-status)
  - Unread badge disappears when thread is viewed (get-thread resets counter)
  - Back button / breadcrumb to thread list

### Task 2.4: Public FAQ Page
- **Agent**: @web
- **Priority**: P0 (must)
- **Size**: M
- **Acceptance Criteria**:
  - Route: `/e/:eventSlug/faq` (public, no auth required)
  - Search input at top (filters by title + content match)
  - Category filter: pill buttons for each available category + "All" default
  - FAQ items rendered as expandable accordion cards: title as trigger, content (rendered as markdown) as body
  - Items sorted by sort_order, then created_at
  - Empty state per filter: "Geen FAQs gevonden voor deze categorie"
  - Global empty state: "Er zijn nog geen FAQs beschikbaar voor dit evenement"

### Task 2.5: Organizer FAQ Admin Page
- **Agent**: @web
- **Priority**: P0 (must)
- **Size**: L
- **Acceptance Criteria**:
  - Route: `/org/:orgSlug/events/:eventSlug/communication/faq`
  - Table listing all FAQ items: title, category, status chip (Draft/Published), sort_order input (editable inline), actions column
  - Create button opens modal/inline form: title, content (textarea for markdown), category, sort_order
  - Edit: click row or edit icon opens same form pre-filled
  - Publish toggle: quick action button per row (Draft -> Published or Published -> Draft)
  - Delete: confirmation dialog before hard delete
  - Table sorted by sort_order ASC
  - Empty state: "Nog geen FAQ-items. Klik 'Nieuw Item' om te beginnen."

### Task 2.6: Navigation Integration
- **Agent**: @web
- **Priority**: P1 (should)
- **Size**: S
- **Acceptance Criteria**:
  - EventCommunication page (existing) gets two new sub-tabs or links: "Berichten" (messages) and "FAQ"
  - Public event pages (checkout confirmation, event detail) get a "FAQ" link if event has published FAQs
  - Public event pages get a "Contact Organisatie" link if messaging is enabled (messaging.enabled setting, default true)
  - App.tsx routes updated with new routes for all above pages

### Task 2.7: Supabase Client Helpers
- **Agent**: @web
- **Priority**: P0 (must)
- **Size**: M
- **Acceptance Criteria**:
  - Hook/utility: `useThread(threadId)` -- fetches thread + messages, handles unread reset
  - Hook/utility: `useThreadList(eventId, filters)` -- fetches thread list with pagination
  - Hook/utility: `useFaqs(eventId, filters)` -- fetches published FAQs with search/category
  - All hooks use the existing supabase client from `../lib/supabase`
  - Error handling: toast or inline error display on fetch failure
  - Loading states returned for skeleton rendering

---

## Out of Scope (S2)

- Real-time updates (WebSocket / Supabase Realtime subscriptions) -- threads refresh on page load only
- Rich text editor for messages (plain textarea)
- Markdown preview in FAQ admin (raw markdown input only; public view renders markdown)
- Mobile-responsive optimization beyond basic Tailwind responsive classes
- Animations or transitions beyond default browser behavior

---

## UI Routing Plan

```
App.tsx additions:
├── /e/:eventSlug/chat              → ParticipantChat (public, auth required)
├── /e/:eventSlug/faq               → PublicFaq (public, no auth)
│
└── /org/:orgSlug/events/:eventSlug/
    └── communication/
        ├── (index) → EventCommunication (existing email settings)
        ├── messages/
        │   ├── (index) → OrganizerThreadList
        │   └── :threadId → OrganizerThreadDetail
        └── faq → OrganizerFaqAdmin
```

---

## Component File Plan

```
web/src/
├── pages/
│   ├── public/
│   │   ├── ParticipantChat.tsx          # /e/:eventSlug/chat
│   │   └── PublicFaq.tsx                # /e/:eventSlug/faq
│   └── events/
│       ├── OrganizerThreadList.tsx      # messages index
│       ├── OrganizerThreadDetail.tsx    # messages/:threadId
│       └── OrganizerFaqAdmin.tsx        # faq admin
├── hooks/
│   ├── useThread.ts
│   ├── useThreadList.ts
│   └── useFaqs.ts
└── components/
    ├── MessageBubble.tsx                # Reusable message display
    └── FaqAccordion.tsx                 # Reusable FAQ expand/collapse
```

---

## Technical Notes for @web

### Existing Patterns to Follow
- Use `useOutletContext` for event/org data in sub-routes (see EventCommunication.tsx)
- Use `supabase` client from `../lib/supabase` for all API calls
- Edge Functions called via `supabase.functions.invoke('function-name', { body, headers })`
- Error display: red left-bordered div (`bg-red-50 border-l-4 border-red-400 p-4 text-red-700`)
- Success display: green left-bordered div
- Loading state: simple text "Laden..." or skeleton placeholder
- Styling: Tailwind CSS, existing class patterns from other pages

### Message Timestamp Display
- Use relative time (e.g., "2 minuten geleden", "vandaag 14:30") for messages within last 24h
- Use absolute date for older messages ("25 jan 2026 14:30")

### Unread Badge
- Show as colored circle with number when unread_count_organizer > 0
- Position: right side of thread list row
- Disappears when thread is opened (counter reset by get-thread)

### FAQ Markdown Rendering
- Public FAQ page renders content as markdown
- Use a lightweight markdown library (e.g., `react-markdown` if available, or simple HTML conversion)
- Admin page shows raw markdown in textarea (WYSIWYG editor is out of scope)

---

## Risk Assessment (S2)

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Edge Function invocation latency makes chat feel sluggish | Medium | Medium | Show optimistic UI: append message to local state immediately, confirm via response |
| Participant eligibility check fails on page load (confusing UX) | Low | Medium | Show friendly message: "Je hebt geen actieve registratie of ticket voor dit evenement" with link to event page |
| FAQ markdown rendering XSS vulnerability | Medium | High | Sanitize all markdown output; use react-markdown with safe defaults |
| Thread list becomes very long for popular events | Low | Medium | Pagination with limit=25; infinite scroll or "load more" button |

---

*Sprint S2 Plan - F012 Event Communication UI*
*Created: 2026-01-28 | Author: @pm*
