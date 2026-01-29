# F012 Messaging & FAQ - Testing Guide

## Prerequisites

1. Backend deployed with F012 Edge Functions:
   - `get-threads`
   - `get-thread-messages`
   - `send-message`
   - `update-thread-status`
   - `get-faqs`
   - `faq-crud`

2. Database tables created:
   - `message_threads` (id, event_id, participant_id, status, created_at, etc.)
   - `messages` (id, thread_id, sender_type, content, created_at, etc.)
   - `faq_items` (id, event_id, title, content, category, status, sort_order)

3. RLS policies enabled on all tables (organizer-only for admin tables)

4. Dev server running:
   ```bash
   cd /Users/sebastianchavez/Desktop/COLOSS/web
   npm run dev
   ```

---

## Test Scenarios

### Test 1: Create FAQ Items (Organizer)

**Objective:** Verify FAQ creation workflow

**Steps:**
1. Login as organizer (http://localhost:5173/login)
2. Navigate to any event
3. Click "FAQ" tab (should appear in EventDetail tabs)
4. Click "Nieuwe FAQ" button
5. Fill form:
   - Title: "Hoe kan ik mijn kaartje terugbetaald krijgen?"
   - Content: "Neem contact op met support@event.nl"
   - Category: "Betaling"
   - Status: "Gepubliceerd"
6. Click "Opslaan"

**Expected:**
- Success toast appears
- FAQ appears in list below
- Table shows correct title, category, status
- Sort order is auto-assigned

**Actual:** _(to be filled during testing)_

---

### Test 2: Edit FAQ Item

**Objective:** Verify FAQ edit workflow

**Steps:**
1. In FAQ admin, click "Bewerk" on any FAQ item
2. Change title to "Hoe kan ik mijn kaartje annuleren?"
3. Change status to "Concept"
4. Click "Opslaan"

**Expected:**
- Form closes
- FAQ list updates
- Title changed in table
- Status badge shows "Concept"

**Actual:** _(to be filled during testing)_

---

### Test 3: Delete FAQ Item

**Objective:** Verify FAQ deletion with confirmation

**Steps:**
1. In FAQ admin, click "Verwijder" on any FAQ item
2. Click "OK" in confirmation dialog

**Expected:**
- Confirmation dialog appears
- FAQ removed from list
- Success toast appears

**Actual:** _(to be filled during testing)_

---

### Test 4: Sort FAQ Items

**Objective:** Verify sort order management

**Steps:**
1. In FAQ admin, see 3+ FAQ items
2. Click up/down arrows on sort_order column
3. Refresh page

**Expected:**
- Sort order changes visually
- Changes persist after refresh
- Items display in correct order on public FAQ page

**Actual:** _(to be filled during testing)_

---

### Test 5: Public FAQ Page - Browse

**Objective:** Verify public FAQ display

**Steps:**
1. Navigate to `/e/{eventSlug}/faq` (using real event slug)
2. Verify page loads with title "Veelgestelde Vragen"
3. Check FAQ items are displayed
4. Click FAQ item to expand

**Expected:**
- Event name shows in header
- Only published FAQs appear
- Accordion expands to show content
- Search box and category chips visible

**Actual:** _(to be filled during testing)_

---

### Test 6: Public FAQ - Search

**Objective:** Verify FAQ search functionality

**Steps:**
1. On public FAQ page, type in search box: "betaling"
2. Verify only matching FAQs appear

**Expected:**
- Only FAQs with "betaling" in title or content show
- Other FAQs hidden

**Actual:** _(to be filled during testing)_

---

### Test 7: Public FAQ - Category Filter

**Objective:** Verify category filtering

**Steps:**
1. On public FAQ page, click category chip (e.g., "Betaling")
2. Verify only FAQs in that category appear
3. Click "Alle" to reset

**Expected:**
- Category-specific FAQs appear
- Other categories disappear
- "Alle" shows all FAQs

**Actual:** _(to be filled during testing)_

---

### Test 8: Participant Chat - Start Conversation

**Objective:** Verify thread creation on first message

**Steps:**
1. Navigate to `/e/{eventSlug}/chat` (public, no login needed)
2. See "Start een gesprek" message
3. Type: "Hoeveel kost een kaartje?"
4. Click "Verzenden"

**Expected:**
- Message appears in chat
- Thread created in database
- Message from "Participant" (blue bubble)
- Loading state shows during send

**Actual:** _(to be filled during testing)_

---

### Test 9: Participant Chat - Load Messages

**Objective:** Verify message persistence

**Steps:**
1. From previous test, refresh page `/e/{eventSlug}/chat`
2. Check messages load

**Expected:**
- Previous messages appear
- Thread ID is remembered
- No "Start a conversation" prompt

**Actual:** _(to be filled during testing)_

---

### Test 10: Organizer Messaging - Receive & Reply

**Objective:** Verify organizer can see and reply to messages

**Steps:**
1. As organizer, navigate to `/org/demo/events/{slug}/messaging`
2. Look for thread from participant (Test 8)
3. Click thread to select it
4. Type reply: "Standaardticket kost €25."
5. Click "Verzenden"

**Expected:**
- Thread appears in left list
- Participant's message shows in right panel
- Organizer reply sends and appears as blue bubble
- Thread status shows "Open" by default

**Actual:** _(to be filled during testing)_

---

### Test 11: Organizer Messaging - Status Filter

**Objective:** Verify thread filtering

**Steps:**
1. In messaging view, change status filter to "Closed"
2. Verify only closed threads appear

**Expected:**
- Filter dropdown updates
- List shows only matching threads

**Actual:** _(to be filled during testing)_

---

### Test 12: Organizer Messaging - Change Status

**Objective:** Verify thread status updates

**Steps:**
1. In messaging view, select a thread
2. Click status dropdown in header (shows "Open")
3. Change to "Closed"

**Expected:**
- Status updates immediately
- List filters reflect change (if filtering by status)

**Actual:** _(to be filled during testing)_

---

### Test 13: Participant Chat - FAQ Link

**Objective:** Verify navigation to FAQ from chat

**Steps:**
1. On `/e/{eventSlug}/chat`, scroll down
2. Click "Vind je antwoord niet?" CTA button
3. Should navigate to FAQ page

**Expected:**
- Button links to `/e/{eventSlug}/faq`
- FAQ page loads

**Actual:** _(to be filled during testing)_

---

### Test 14: Responsive Layout - Mobile

**Objective:** Verify components work on mobile screens

**Steps:**
1. Open DevTools (F12) → Toggle device toolbar
2. Set to iPhone 12 (390px width)
3. Test each page:
   - `/e/{slug}/chat` - should stack vertically
   - `/e/{slug}/faq` - should be readable
   - `/org/.../messaging` - left panel might hide on tiny screens

**Expected:**
- Text readable without horizontal scroll
- Buttons clickable
- No layout breakage

**Actual:** _(to be filled during testing)_

---

### Test 15: Error Handling - Network Error

**Objective:** Verify graceful error handling

**Steps:**
1. Open DevTools → Network tab
2. Throttle to offline
3. Try to send a message
4. Restore online

**Expected:**
- Error message appears
- No silent failures
- Can retry after going online

**Actual:** _(to be filled during testing)_

---

### Test 16: Edge Case - Empty FAQ

**Objective:** Verify empty state

**Steps:**
1. Create event with no FAQ items
2. Navigate to `/e/{slug}/faq`

**Expected:**
- "Geen vragen gevonden" message appears
- No crash

**Actual:** _(to be filled during testing)_

---

### Test 17: Edge Case - No Threads

**Objective:** Verify empty state in messaging

**Steps:**
1. Navigate to `/org/.../messaging` on event with no threads

**Expected:**
- Empty state or "Geen threads gevonden" message
- Right panel shows helper text

**Actual:** _(to be filled during testing)_

---

### Test 18: Auth - Public Pages Accessible Without Login

**Objective:** Verify public routes don't require auth

**Steps:**
1. Logout (if needed)
2. Navigate directly to `/e/{slug}/chat`
3. Navigate to `/e/{slug}/faq`

**Expected:**
- Both pages load without redirecting to login
- Can interact with chat

**Actual:** _(to be filled during testing)_

---

### Test 19: Auth - Protected Pages Require Login

**Objective:** Verify organizer routes are protected

**Steps:**
1. Logout
2. Try to navigate to `/org/demo/events/{slug}/messaging`

**Expected:**
- Redirects to login page
- After login, can access page

**Actual:** _(to be filled during testing)_

---

### Test 20: Performance - Large FAQ List

**Objective:** Verify performance with 50+ FAQs

**Steps:**
1. Create 50+ FAQ items via API or script
2. Navigate to public FAQ page
3. Check load time and responsiveness

**Expected:**
- Page loads in <2 seconds
- Search still responsive
- No lag when expanding items

**Actual:** _(to be filled during testing)_

---

## Bug Report Template

If issues found, use this template:

```markdown
## Bug: [Title]

**Test:** Test #X

**Steps to Reproduce:**
1. ...
2. ...

**Expected:**
...

**Actual:**
...

**Screenshot/Video:**
[If applicable]

**Environment:**
- Browser: Chrome 120, Firefox 121, Safari 17
- Device: Desktop, iPhone 12, Pixel 7
- URL: http://localhost:5173/...
```

---

## Sign-Off Checklist

- [ ] All 20 tests passed
- [ ] No critical bugs
- [ ] Performance acceptable
- [ ] Mobile layout works
- [ ] Error handling graceful
- [ ] Ready for production

**Tested by:** ________________
**Date:** ________________
**Notes:** ________________
