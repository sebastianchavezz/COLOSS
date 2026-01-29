# F012 Edge Functions - Interface Specifications

## Metadata

| Field | Value |
|-------|-------|
| **Flow** | F012 - Event Communication |
| **Document** | Edge Function Specifications (S1 Reference) |
| **Author** | @pm (for @architect review) |
| **Created** | 2026-01-28 |

---

## Shared Patterns

All Edge Functions follow the existing codebase conventions:
- Use `authenticateUser(req)` from `_shared/auth.ts` for JWT validation
- Use `isOrgMember(client, orgId, userId, roles)` from `_shared/auth.ts` for RBAC
- Use service role client (`SUPABASE_SERVICE_ROLE_KEY`) for RPC calls that bypass RLS
- Use `corsHeaders` from `_shared/cors.ts`
- Return `{ success: true, data: ... }` or `{ error: string, code: string }` via `_shared/response.ts`
- HTTP status codes: 200/201 success, 400 bad request, 401 unauthorized, 403 forbidden, 404 not found, 429 rate limit

---

## 1. send-message

**File**: `supabase/functions/send-message/index.ts`

### Request

```
POST /functions/v1/send-message
Content-Type: application/json
Authorization: Bearer <jwt>
```

### Body Schema

```typescript
// Participant sending a new message (or replying in existing thread)
interface ParticipantSendInput {
    event_id: string    // Required: which event
    content: string     // Required: message text (1-2000 chars)
}

// Organizer replying to an existing thread
interface OrganizerReplyInput {
    thread_id: string   // Required: which thread to reply in
    content: string     // Required: message text (1-2000 chars)
}

type SendMessageInput = ParticipantSendInput | OrganizerReplyInput
```

### Logic Flow

```
1. Authenticate user (JWT)
2. Validate input:
   - content must be string, 1-2000 chars
   - Either event_id OR thread_id must be present (not both, not neither)
3. Determine caller role:
   a. If event_id provided:
      - Assume participant flow
      - Find participant record where user_id = auth.uid()
      - Call RPC: create_thread_and_message(org_id, event_id, participant_id, content, rate_limit)
        - org_id resolved from events table
        - rate_limit resolved from event settings (messaging.rate_limit.messages_per_minute, default 5)
   b. If thread_id provided:
      - Load thread to get org_id
      - Check if caller is org_member (owner/admin/support) for that org
      - If yes: call RPC organizer_reply(thread_id, sender_user_id, content)
      - If no: check if caller is the thread's participant
        - If yes: call RPC create_thread_and_message with existing thread (append to existing)
        - If no: return 403
4. Return response
```

### Responses

```typescript
// 201 Created - Success
{
    success: true,
    data: {
        thread_id: string,
        message_id: string,
        sender_type: 'participant' | 'organizer'
    }
}

// 400 Bad Request - Validation failure
{
    error: "Invalid input",
    code: "VALIDATION_ERROR",
    details: { field: string, message: string }
}

// 401 Unauthorized
{
    error: "Authentication required",
    code: "AUTH_REQUIRED"
}

// 403 Forbidden - Not eligible
{
    error: "Not eligible to send messages for this event",
    code: "NOT_ELIGIBLE"
}

// 429 Too Many Requests - Rate limited
{
    error: "Rate limit exceeded. Please wait before sending another message.",
    code: "RATE_LIMIT_EXCEEDED",
    details: { retry_after_seconds: 60 }
}
```

---

## 2. get-thread

**File**: `supabase/functions/get-thread/index.ts`

### Request

```
GET /functions/v1/get-thread?thread_id=<uuid>&limit=50&offset=0
Authorization: Bearer <jwt>
```

### Query Parameters

| Param | Type | Required | Default | Max | Description |
|-------|------|----------|---------|-----|-------------|
| `thread_id` | uuid | Yes | -- | -- | Thread to retrieve |
| `limit` | integer | No | 50 | 200 | Messages per page |
| `offset` | integer | No | 0 | -- | Pagination offset |

### Logic Flow

```
1. Authenticate user (JWT)
2. Validate thread_id is valid UUID
3. Load thread from conversation_threads
4. Determine access:
   a. Caller is participant of this thread (participants.user_id = auth.uid() AND participant_id match)
      -> Reset unread_count_participant to 0 (via service role UPDATE)
   b. Caller is org_member (owner/admin/support) for thread's org
      -> Reset unread_count_organizer to 0 (via service role UPDATE)
   c. Neither -> return 403
5. Fetch messages: SELECT FROM conversation_messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?
6. Fetch total_count: SELECT COUNT(*) FROM conversation_messages WHERE thread_id = ?
7. Return response
```

### Response

```typescript
// 200 OK
{
    success: true,
    data: {
        thread: {
            id: string,
            event_id: string,
            participant_id: string,
            status: 'open' | 'closed',
            unread_count_participant: number,
            unread_count_organizer: number,
            created_at: string,
            updated_at: string
        },
        messages: [
            {
                id: string,
                sender_type: 'participant' | 'organizer',
                sender_user_id: string | null,
                content: string,
                is_flagged: boolean,
                created_at: string
            }
        ],
        total_count: number,
        limit: number,
        offset: number
    }
}
```

---

## 3. list-threads

**File**: `supabase/functions/list-threads/index.ts`

### Request

```
GET /functions/v1/list-threads?event_id=<uuid>&status=all&limit=25&offset=0
Authorization: Bearer <jwt>
```

### Query Parameters

| Param | Type | Required | Default | Max | Description |
|-------|------|----------|---------|-----|-------------|
| `event_id` | uuid | Yes | -- | -- | Event to list threads for |
| `status` | text | No | `all` | -- | Filter: `open`, `closed`, `all` |
| `limit` | integer | No | 25 | 100 | Threads per page |
| `offset` | integer | No | 0 | -- | Pagination offset |

### Logic Flow

```
1. Authenticate user (JWT)
2. Validate event_id
3. Verify caller is org_member (owner/admin/support) for the event's org
   - If not: return 403
4. Build query:
   SELECT ct.*, p.first_name, p.last_name, p.email as participant_email
   FROM conversation_threads ct
   JOIN participants p ON p.id = ct.participant_id
   WHERE ct.event_id = ?
   AND (? = 'all' OR ct.status = ?)
   ORDER BY ct.last_message_at DESC NULLS LAST
   LIMIT ? OFFSET ?
5. Fetch total_count with same WHERE (without limit/offset)
6. Return response
```

### Response

```typescript
// 200 OK
{
    success: true,
    data: {
        threads: [
            {
                id: string,
                participant_id: string,
                participant_first_name: string,
                participant_last_name: string,
                participant_email: string,
                status: 'open' | 'closed',
                unread_count_organizer: number,
                unread_count_participant: number,
                last_message_at: string | null,
                created_at: string
            }
        ],
        total_count: number,
        limit: number,
        offset: number
    }
}
```

---

## 4. update-thread-status

**File**: `supabase/functions/update-thread-status/index.ts`

### Request

```
PUT /functions/v1/update-thread-status
Content-Type: application/json
Authorization: Bearer <jwt>
```

### Body Schema

```typescript
interface UpdateThreadStatusInput {
    thread_id: string           // Required
    status: 'open' | 'closed'  // Required: new status
}
```

### Logic Flow

```
1. Authenticate user (JWT)
2. Validate input
3. Load thread
4. Verify caller is org_member (owner/admin/support) for thread's org
5. If new status == current status: return 200 (no-op, idempotent)
6. UPDATE conversation_threads SET status = ?, updated_at = now() WHERE id = ?
7. Write audit log:
   - action: 'close_thread' or 'reopen_thread'
   - entity_type: 'conversation_thread'
   - entity_id: thread_id
   - actor_user_id: caller user_id
   - metadata: { previous_status, new_status }
8. Return response
```

### Response

```typescript
// 200 OK
{
    success: true,
    data: {
        thread_id: string,
        previous_status: 'open' | 'closed',
        new_status: 'open' | 'closed',
        updated_at: string
    }
}
```

---

## 5. create-faq-item

**File**: `supabase/functions/faq-items/index.ts` (combined CRUD endpoint)

### Request

```
POST /functions/v1/faq-items
Content-Type: application/json
Authorization: Bearer <jwt>
```

### Body Schema

```typescript
interface CreateFaqItemInput {
    event_id: string     // Required
    title: string        // Required (1-200 chars)
    content: string      // Required (1-10000 chars, markdown)
    category?: string    // Optional (max 50 chars)
    sort_order?: number  // Optional (default 0)
}
```

### Logic Flow

```
1. Authenticate user (JWT)
2. Validate input (lengths, types)
3. Load event to get org_id
4. Verify caller is org_member (owner/admin) for that org
5. Check uniqueness: no existing faq_item with same (event_id, title)
6. Check max_items_per_event setting (default 50)
7. INSERT faq_items with status = 'draft'
8. Write audit log: action = 'faq_create'
9. Return created item
```

### Response

```typescript
// 201 Created
{
    success: true,
    data: {
        id: string,
        event_id: string,
        title: string,
        content: string,
        category: string | null,
        status: 'draft',
        sort_order: number,
        created_at: string
    }
}
```

---

## 6. update-faq-item

### Request

```
PUT /functions/v1/faq-items/:id
Content-Type: application/json
Authorization: Bearer <jwt>
```

### Body Schema

```typescript
interface UpdateFaqItemInput {
    title?: string       // Optional update
    content?: string     // Optional update
    category?: string | null  // Optional update (null to clear)
    sort_order?: number  // Optional update
    status?: 'draft' | 'published'  // Optional status change
}
```

### Logic Flow

```
1. Authenticate user (JWT)
2. Load faq_item by id
3. Verify caller is org_member (owner/admin) for item's org
4. If title changing: check uniqueness (event_id, new_title)
5. Merge updates (only provided fields)
6. UPDATE faq_items
7. Write audit log:
   - If status changed to 'published': action = 'faq_publish'
   - Else: action = 'faq_update'
8. Return updated item
```

### Response

```typescript
// 200 OK
{
    success: true,
    data: {
        id: string,
        event_id: string,
        title: string,
        content: string,
        category: string | null,
        status: 'draft' | 'published',
        sort_order: number,
        updated_at: string
    }
}
```

---

## 7. delete-faq-item

### Request

```
DELETE /functions/v1/faq-items/:id
Authorization: Bearer <jwt>
```

### Logic Flow

```
1. Authenticate user (JWT)
2. Load faq_item by id
3. Verify caller is org_member (owner/admin) for item's org
4. Write audit log: action = 'faq_delete', before_state = current item data
5. DELETE faq_items WHERE id = ?
6. Return success
```

### Response

```typescript
// 200 OK
{
    success: true,
    data: {
        deleted_id: string,
        message: "FAQ item verwijderd"
    }
}
```

---

## 8. get-event-faqs

**File**: `supabase/functions/get-event-faqs/index.ts`

### Request

```
GET /functions/v1/get-event-faqs?event_id=<uuid>&category=<text>&search=<text>&limit=25
```

**No authentication required** (public endpoint).

### Query Parameters

| Param | Type | Required | Default | Max | Description |
|-------|------|----------|---------|-----|-------------|
| `event_id` | uuid | Yes | -- | -- | Which event's FAQs |
| `category` | text | No | -- | -- | Filter by category (exact match) |
| `search` | text | No | -- | -- | Search title + content (case-insensitive ILIKE) |
| `limit` | integer | No | 25 | 100 | Items per page |

### Logic Flow

```
1. Validate event_id (no auth needed)
2. Build query:
   SELECT * FROM faq_items
   WHERE event_id = ?
   AND status = 'published'
   AND (? IS NULL OR category = ?)                    -- category filter
   AND (? IS NULL OR title ILIKE '%' || ? || '%'      -- search filter
        OR content ILIKE '%' || ? || '%')
   ORDER BY sort_order ASC, created_at DESC
   LIMIT ?
3. Fetch distinct categories for filter UI:
   SELECT DISTINCT category FROM faq_items
   WHERE event_id = ? AND status = 'published' AND category IS NOT NULL
4. Return response
```

### Response

```typescript
// 200 OK
{
    success: true,
    data: {
        faqs: [
            {
                id: string,
                title: string,
                content: string,      // markdown
                category: string | null,
                sort_order: number,
                created_at: string
            }
        ],
        categories: string[],         // distinct categories for filter UI
        total_count: number
    }
}
```

---

## Edge Function File Structure

```
supabase/functions/
├── send-message/
│   └── index.ts
├── get-thread/
│   └── index.ts
├── list-threads/
│   └── index.ts
├── update-thread-status/
│   └── index.ts
├── faq-items/
│   └── index.ts          # Combined: POST (create), PUT/:id (update), DELETE/:id
└── get-event-faqs/
    └── index.ts
```

---

## Shared Types Addition

Add to `_shared/types.ts`:

```typescript
/**
 * Conversation thread status
 */
export type ThreadStatus = 'open' | 'closed'

/**
 * Message sender type
 */
export type MessageSenderType = 'participant' | 'organizer'

/**
 * FAQ item status
 */
export type FaqStatus = 'draft' | 'published'
```

---

*Edge Functions Specification - F012*
*Created: 2026-01-28 | Author: @pm*
