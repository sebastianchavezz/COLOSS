# Handoff: F012 Messaging & FAQ → Tester

**Component:** F012 Messaging + FAQ System (Web UI)

**Status:** Ready for functional testing

---

## What Was Built

Four new web pages for event messaging and FAQ management:

1. **EventMessaging.tsx** - Organizer message thread manager
2. **ParticipantChat.tsx** - Participant-facing chat (public)
3. **PublicFaq.tsx** - Public FAQ page (public)
4. **EventFaqAdmin.tsx** - Organizer FAQ CRUD interface

Plus route updates in App.tsx and navigation tabs in EventDetail.tsx.

---

## How to Test

### Start the Development Server

```bash
cd /Users/sebastianchavez/Desktop/COLOSS/web
npm install  # If needed
npm run dev
```

Dev server should be running at: **http://localhost:5173**

### Access the Pages

#### Organizer Pages (Protected - Requires Login)
- **Messaging:** http://localhost:5173/org/demo/events/{eventSlug}/messaging
  - Replace `{eventSlug}` with actual event slug from Events list
  - Accessible via EventDetail → "Berichten" tab

- **FAQ Admin:** http://localhost:5173/org/demo/events/{eventSlug}/faq
  - Accessible via EventDetail → "FAQ" tab

#### Participant Pages (Public - No Login Required)
- **Chat:** http://localhost:5173/e/{eventSlug}/chat

- **FAQ:** http://localhost:5173/e/{eventSlug}/faq

---

## Test Flow

### Quick Sanity Check (5 mins)

1. **Login** - Go to /login, sign in with test account
2. **Navigate to event** - Click any event in Events list
3. **Check new tabs** - Verify "Berichten" and "FAQ" tabs appear in nav
4. **Click Berichten** - Should load messaging page (may show error if backend not ready)
5. **Click FAQ** - Should load FAQ admin page (may show error if backend not ready)

### Full Test Scenarios (See TESTING_GUIDE_F012.md)

Run through Test 1-20 from the testing guide:
- FAQ creation, editing, deletion, sorting
- Public FAQ browsing, search, filtering
- Participant chat workflow
- Organizer message management
- Status filtering and updates
- Error handling and edge cases
- Responsive layout on mobile
- Auth protection verification

---

## Expected Behavior

### Pages Load Successfully
- No TypeScript errors
- No console errors (except network if backend not deployed)
- Layout renders correctly
- Navigation works

### Forms Work
- Can type in inputs
- Send buttons work (will fail if backend not ready)
- Validation shows errors (title/content required for FAQ)
- Status changes update UI

### List Navigation
- Can click items
- Selection highlights correctly
- Filters and searches work locally (may not fetch new data if backend not ready)

### Responsive Design
- Works on desktop and tablet
- No horizontal scroll on mobile
- Buttons are clickable on small screens

---

## Known Issues / Blockers

### Backend Dependencies
**⚠️ These components depend on Edge Functions that must be deployed:**

1. **get-threads** - List message threads
2. **get-thread-messages** - Get messages in a thread
3. **send-message** - Send/create message
4. **update-thread-status** - Change thread status
5. **get-faqs** - Fetch FAQ items
6. **faq-crud** - Create/update/delete FAQ items

**Status:** If backend functions not deployed, you'll see network errors (404 or auth errors).

### Database Tables
**These tables must exist with proper RLS:**

1. **message_threads** - Thread records
2. **messages** - Individual messages
3. **faq_items** - FAQ knowledge base

---

## What to Focus On

### Critical (Breaking Functionality)
- [ ] Can pages load without errors?
- [ ] Do forms submit without crashing?
- [ ] Does navigation between tabs work?
- [ ] Are routes accessible (protected vs public)?

### Important (Feature Completeness)
- [ ] Can create/edit/delete FAQ items?
- [ ] Can send and receive messages?
- [ ] Do filters work (status, search, category)?
- [ ] Do status updates persist?

### Nice to Have (Polish)
- [ ] Error messages are helpful?
- [ ] Loading states show?
- [ ] Mobile layout works?
- [ ] Success toasts appear?

---

## How to Report Issues

Use this template for any bugs found:

```
## Bug: [Clear Title]

**Component:** EventMessaging / ParticipantChat / PublicFaq / EventFaqAdmin

**URL:** http://localhost:5173/...

**Steps to Reproduce:**
1. ...
2. ...

**Expected:** ...

**Actual:** ...

**Error in Console:** [Paste any error messages]

**Environment:** Chrome/Firefox/Safari, Desktop/Mobile
```

---

## Files to Review

**Core Components:**
- `/Users/sebastianchavez/Desktop/COLOSS/web/src/pages/EventMessaging.tsx` (325 lines)
- `/Users/sebastianchavez/Desktop/COLOSS/web/src/pages/ParticipantChat.tsx` (280 lines)
- `/Users/sebastianchavez/Desktop/COLOSS/web/src/pages/PublicFaq.tsx` (285 lines)
- `/Users/sebastianchavez/Desktop/COLOSS/web/src/pages/EventFaqAdmin.tsx` (410 lines)

**Updated Files:**
- `/Users/sebastianchavez/Desktop/COLOSS/web/src/App.tsx` (route additions)
- `/Users/sebastianchavez/Desktop/COLOSS/web/src/pages/EventDetail.tsx` (tab additions)

**Documentation:**
- `/Users/sebastianchavez/Desktop/COLOSS/web/F012_IMPLEMENTATION_SUMMARY.md` (Technical overview)
- `/Users/sebastianchavez/Desktop/COLOSS/web/TESTING_GUIDE_F012.md` (20 test scenarios)

---

## Success Criteria

✅ **All components render without crashing**
✅ **Forms accept input and attempt submission**
✅ **Navigation works between tabs and pages**
✅ **Public pages accessible without login**
✅ **Protected pages redirect to login when needed**
✅ **Responsive layout works on mobile**
✅ **Error handling is graceful (no silent failures)**
✅ **Ready for backend integration testing**

---

## Next Steps After Testing

1. **If bugs found:** Report using template above → @fixer will patch
2. **If backend not ready:** Wait for Edge Functions deployment → Re-test
3. **If all green:** Move to integration testing with backend
4. **Final step:** Performance testing with real data volume

---

## Questions?

Refer to:
- **Architecture:** See F012_IMPLEMENTATION_SUMMARY.md
- **Testing approach:** See TESTING_GUIDE_F012.md
- **Component details:** Check inline comments in each .tsx file

---

**Tester Assignment:** @tester
**Start Date:** [Today]
**Target Completion:** [+3 days]
**Severity if blocked:** Medium (depends on backend, so parallel track OK)
