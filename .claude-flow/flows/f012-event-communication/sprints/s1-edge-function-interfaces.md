# F012: Edge Function Interfaces (TypeScript Types)

> Copy-paste ready for @backend implementation.
> All Edge Functions use the Supabase service role client for database operations
> and validate auth via `supabase.auth.getUser()` or custom token extraction.

---

## Shared Types

```typescript
// types.ts - shared across all F012 Edge Functions

export type ChatThreadStatus = 'open' | 'pending' | 'closed';
export type ChatSenderType = 'participant' | 'organizer';
export type FaqStatus = 'draft' | 'published';

export interface ChatThread {
  id: string;                          // UUID
  org_id: string;                      // UUID
  event_id: string;                    // UUID
  participant_id: string;              // UUID
  status: ChatThreadStatus;
  unread_count_organizer: number;
  last_message_at: string | null;      // ISO timestamp
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;                          // UUID
  thread_id: string;                   // UUID
  org_id: string;                      // UUID
  sender_type: ChatSenderType;
  sender_user_id: string | null;       // NULL for guest participants
  content: string;
  is_flagged: boolean;
  created_at: string;                  // ISO timestamp
}

export interface FaqItem {
  id: string;                          // UUID
  org_id: string;                      // UUID
  event_id: string | null;             // NULL = org-wide
  title: string;
  content: string | null;              // Markdown
  category: string | null;
  status: FaqStatus;
  sort_order: number;
  created_by: string;                  // UUID
  created_at: string;
  updated_at: string;
}

export interface MessagingSettings {
  rate_limit: {
    msgs_per_minute: number;           // 1-60
  };
  max_message_length: number;          // 1-10000
  retention_days: number;              // 7-3650
  notifications: {
    email_enabled: boolean;
  };
}

// Standard error response
export interface ErrorResponse {
  error: string;
  code: string;                        // e.g. 'UNAUTHORIZED', 'NOT_FOUND', 'RATE_LIMITED'
  details?: string;
}
```

---

## 1. send-message (POST)

**File**: `supabase/functions/send-message/index.ts`

```typescript
// Request body
export interface SendMessageRequest {
  thread_id?: string;    // UUID. If omitted, a new thread is created (participant only).
  event_id: string;      // UUID. Required when thread_id is omitted.
  content: string;       // Message text (max length from settings)
}

// Success response
export interface SendMessageResponse {
  message_id: string;    // UUID of the created message
  thread_id: string;     // UUID of the thread (new or existing)
  created_at: string;    // ISO timestamp
}

// Error codes
// UNAUTHORIZED    - Not authenticated or not a valid participant/organizer
// FORBIDDEN       - Participant without registration/ticket for event
// NOT_FOUND       - thread_id or event_id does not exist
// RATE_LIMITED    - Exceeded msgs_per_minute for this event
// CONTENT_TOO_LONG - Exceeds max_message_length setting
// THREAD_CLOSED   - Cannot send to a closed thread (participant only)
// VALIDATION_ERROR - Missing required fields

/*
Edge Function Logic (pseudocode):
1. Extract user from auth header
2. Determine role: is user an org member (organizer) or a participant?
   - Query org_members for user_id -> organizer
   - Query participants for user_id -> participant
3. If participant:
   a. If thread_id is NULL: call get_or_create_chat_thread(event_id, participant_id)
   b. Validate: check_participant_event_access(event_id, participant_id) -> FORBIDDEN if false
   c. Read settings: get_messaging_settings(event_id)
   d. Rate limit: count_recent_participant_messages(thread_id, user_id, 60) >= msgs_per_minute -> RATE_LIMITED
   e. Content length: content.length > max_message_length -> CONTENT_TOO_LONG
   f. Insert message (sender_type = 'participant')
4. If organizer:
   a. thread_id is REQUIRED (organizers reply to existing threads)
   b. Verify thread belongs to their org
   c. Content length check (same settings)
   d. Insert message (sender_type = 'organizer')
5. Trigger on_chat_message_inserted handles counter + status updates
6. If notifications.email_enabled: queue notification email via queue_email()
7. Return { message_id, thread_id, created_at }
*/
```

---

## 2. get-threads (GET) -- Organizer Only

**File**: `supabase/functions/get-threads/index.ts`

```typescript
// Query parameters
export interface GetThreadsParams {
  event_id: string;                    // UUID. Required.
  status?: ChatThreadStatus | 'all';   // Filter by status. Default: 'all'
  page?: number;                       // 1-based page number. Default: 1
  page_size?: number;                  // Items per page (1-100). Default: 20
}

// Success response
export interface GetThreadsResponse {
  threads: ChatThread[];
  total: number;                       // Total matching threads (for pagination)
  unread_total: number;                // Sum of unread_count_organizer across ALL open threads
  page: number;
  page_size: number;
}

// Error codes
// UNAUTHORIZED    - Not authenticated
// FORBIDDEN       - Not an organizer (owner/admin/support) for this event's org
// NOT_FOUND       - event_id does not exist

/*
Edge Function Logic:
1. Extract user, verify organizer role for the event's org
2. Query chat_threads WHERE event_id = ? AND org_id = ? 
   AND (status = ? OR 'all')
   ORDER BY last_message_at DESC
   LIMIT page_size OFFSET (page-1)*page_size
3. Count total rows (without limit)
4. Count unread_total: SUM(unread_count_organizer) WHERE event_id = ? AND status IN ('open','pending')
5. Return paginated response
*/
```

---

## 3. get-thread-messages (GET)

**File**: `supabase/functions/get-thread-messages/index.ts`

```typescript
// Query parameters
export interface GetThreadMessagesParams {
  thread_id: string;                   // UUID. Required.
  limit?: number;                      // Max messages to return (1-200). Default: 50
  offset?: number;                     // Offset for pagination. Default: 0
}

// Success response
export interface GetThreadMessagesResponse {
  messages: ChatMessage[];
  thread_status: ChatThreadStatus;     // Current thread status
  total_messages: number;              // Total messages in thread
  limit: number;
  offset: number;
}

// Error codes
// UNAUTHORIZED    - Not authenticated
// FORBIDDEN       - Not the participant who owns this thread AND not an organizer
// NOT_FOUND       - thread_id does not exist

/*
Edge Function Logic:
1. Extract user
2. Determine access:
   - Is user the participant who owns this thread? (via participants.user_id)
   - OR is user an organizer for this thread's org? (via org_members)
   -> Neither? FORBIDDEN
3. Query chat_messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?
4. If user is an organizer:
   a. Call mark_chat_thread_read(thread_id, user_id) -- resets unread counter + records receipt
5. Return messages + thread_status + total count
*/
```

---

## 4. update-thread-status (PATCH) -- Organizer Only

**File**: `supabase/functions/update-thread-status/index.ts`

```typescript
// Request body
export interface UpdateThreadStatusRequest {
  thread_id: string;                   // UUID. Required.
  status: ChatThreadStatus;            // New status: 'open' | 'closed'
}

// Success response
export interface UpdateThreadStatusResponse {
  thread_id: string;
  new_status: ChatThreadStatus;
  updated_at: string;                  // ISO timestamp
}

// Error codes
// UNAUTHORIZED    - Not authenticated
// FORBIDDEN       - Not an organizer (owner/admin/support)
// NOT_FOUND       - thread_id does not exist
// INVALID_STATUS  - Invalid status value or disallowed transition

/*
Edge Function Logic:
1. Extract user, verify organizer role for thread's org
2. Validate status is 'open' or 'closed' (organizers only set these two)
3. UPDATE chat_threads SET status = ?, updated_at = now() WHERE id = ?
4. Trigger audit_chat_thread_status fires -> writes audit_log entry
5. Return { thread_id, new_status, updated_at }
*/
```

---

## 5. faq-crud (POST/PUT/DELETE) -- Organizer Only

**File**: `supabase/functions/faq-crud/index.ts`

```typescript
// POST: Create FAQ item
export interface CreateFaqRequest {
  event_id?: string;                   // UUID. NULL = org-wide
  title: string;                       // Required, non-empty
  content?: string;                    // Markdown body (optional)
  category?: string;                   // Free-form category label
  status?: FaqStatus;                  // Default: 'draft'
  sort_order?: number;                 // Default: 0
}

export interface CreateFaqResponse {
  faq_id: string;                      // UUID of created item
  created_at: string;
}

// PUT: Update FAQ item
export interface UpdateFaqRequest {
  faq_id: string;                      // UUID. Required.
  title?: string;
  content?: string;
  category?: string;
  status?: FaqStatus;
  sort_order?: number;
}

export interface UpdateFaqResponse {
  faq_id: string;
  updated_at: string;
}

// DELETE: Delete FAQ item
export interface DeleteFaqRequest {
  faq_id: string;                      // UUID. Required.
}

export interface DeleteFaqResponse {
  deleted: boolean;
  faq_id: string;
}

// Shared error codes
// UNAUTHORIZED    - Not authenticated
// FORBIDDEN       - Not owner/admin for the org
// NOT_FOUND       - faq_id or event_id does not exist
// VALIDATION_ERROR - Missing title, invalid event_id (wrong org)

/*
Edge Function Logic (all methods):
1. Extract user
2. Determine org_id:
   - POST: from event_id (if provided) or from request context
   - PUT/DELETE: from existing faq_items row
3. Verify user has owner or admin role for that org
4. Validate input (title non-empty, event_id belongs to org if provided)
5. Execute INSERT/UPDATE/DELETE
6. For PUT: log to audit_log (CRUD_FAQ action)
7. Return response
*/
```

---

## 6. get-faqs (GET) -- Public

**File**: `supabase/functions/get-faqs/index.ts`

```typescript
// Query parameters
export interface GetFaqsParams {
  event_id: string;                    // UUID. Required.
  category?: string;                   // Filter by category
  search?: string;                     // Full-text search query (Dutch tsvector)
  page?: number;                       // 1-based page. Default: 1
  page_size?: number;                  // Items per page (1-100). Default: 20
}

// Success response
export interface GetFaqsResponse {
  faqs: FaqItem[];
  categories: string[];                // Distinct categories available for this event
  total: number;                       // Total matching FAQs
  page: number;
  page_size: number;
}

// Error codes
// NOT_FOUND       - event_id does not exist or event is not published

/*
Edge Function Logic:
1. No auth required (public endpoint)
2. Verify event exists and is published
3. Resolve org_id from event
4. Query faq_items WHERE status = 'published' AND (
     (event_id = ? )  -- event-specific FAQs
     OR (event_id IS NULL AND org_id = ?)  -- org-wide FAQs
   )
   - If category filter: AND category = ?
   - If search query: AND tsvector matches search terms
   ORDER BY sort_order ASC, created_at DESC
   LIMIT page_size OFFSET (page-1)*page_size
5. Fetch distinct categories for the same scope (for filter UI)
6. Return paginated response

Note: RLS policy "Public can view published FAQs" enforces visibility.
      Edge Function uses anon/service client -- both will respect this policy.
*/
```

---

## Implementation Order for @backend

1. Create database migration (copy from design doc)
2. Implement `get-faqs` first (public, no auth complexity, validates FAQ schema)
3. Implement `faq-crud` (organizer auth + CRUD)
4. Implement `send-message` (most complex: auth determination, rate limiting, thread creation)
5. Implement `get-thread-messages` (read + side effect of marking read)
6. Implement `get-threads` (organizer dashboard listing)
7. Implement `update-thread-status` (simple status transition)

## Edge Cases to Handle

| Edge Case | Where | Handling |
|-----------|-------|----------|
| Guest participant (no auth user) sending message | send-message | Block at Edge Function level: require auth for messaging |
| Concurrent messages from same participant | send-message | Rate limit check + DB unique constraints prevent issues |
| Organizer closes thread, participant reopens by messaging | on_chat_message_inserted trigger | Auto-transitions status back to 'open' |
| FAQ with event_id pointing to different org | faq-crud INSERT | RLS CHECK policy + Edge Function validation |
| Empty search query | get-faqs | Treat as no filter (return all published) |
| Thread with 0 messages (freshly created) | get-thread-messages | Return empty array, thread_status = 'open' |
| Organizer reads thread multiple times | mark_chat_thread_read | UPSERT pattern (ON CONFLICT DO UPDATE read_at) |
| Rate limit boundary (exactly N messages) | send-message | Use >= comparison: count >= limit -> reject |

