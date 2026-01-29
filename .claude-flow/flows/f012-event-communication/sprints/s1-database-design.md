# F012 Database Design - Detailed Column Specifications

## Metadata

| Field | Value |
|-------|-------|
| **Flow** | F012 - Event Communication |
| **Document** | Database Design (S1 Reference) |
| **Author** | @pm (for @architect review) |
| **Created** | 2026-01-28 |

---

## 1. Table: conversation_threads

**Purpose**: Represents a 1:1 support conversation between a single participant and the organizers of an event. One thread per (org, event, participant) triple. Organizer sees list of threads; participant sees exactly one.

### Column Specifications

| Column | Type | Nullable | Default | Constraints | Notes |
|--------|------|----------|---------|-------------|-------|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PRIMARY KEY | Thread identifier |
| `org_id` | `uuid` | NOT NULL | -- | FK -> orgs(id) RESTRICT | Tenant isolation anchor |
| `event_id` | `uuid` | NOT NULL | -- | FK -> events(id) RESTRICT | Which event this thread belongs to |
| `participant_id` | `uuid` | NOT NULL | -- | FK -> participants(id) RESTRICT | Which participant initiated |
| `status` | `text` | NOT NULL | `'open'` | CHECK IN ('open', 'closed') | Thread lifecycle status |
| `unread_count_participant` | `integer` | NOT NULL | `0` | CHECK >= 0 | Messages participant hasn't read |
| `unread_count_organizer` | `integer` | NOT NULL | `0` | CHECK >= 0 | Messages organizer hasn't read |
| `last_message_at` | `timestamptz` | NULL | -- | -- | Timestamp of most recent message (for sort) |
| `created_at` | `timestamptz` | NOT NULL | `now()` | -- | Thread creation time |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | -- | Last modification (moddatetime trigger) |

### Constraints

```sql
-- Primary key
CONSTRAINT conversation_threads_pkey PRIMARY KEY (id)

-- Foreign keys
CONSTRAINT conversation_threads_org_id_fkey
    FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE RESTRICT
CONSTRAINT conversation_threads_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE RESTRICT
CONSTRAINT conversation_threads_participant_id_fkey
    FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE RESTRICT

-- Unique: one thread per participant per event per org
CONSTRAINT conversation_threads_unique_thread
    UNIQUE (org_id, event_id, participant_id)

-- Status validation
CONSTRAINT conversation_threads_valid_status
    CHECK (status IN ('open', 'closed'))

-- Unread counters non-negative
CONSTRAINT conversation_threads_unread_participant_check
    CHECK (unread_count_participant >= 0)
CONSTRAINT conversation_threads_unread_organizer_check
    CHECK (unread_count_organizer >= 0)
```

### Indexes

```sql
-- Organizer: list threads by event, sorted by activity
CREATE INDEX idx_conv_threads_event_status
    ON public.conversation_threads(event_id, status, last_message_at DESC);

-- Participant: find own thread for an event
CREATE INDEX idx_conv_threads_participant_event
    ON public.conversation_threads(participant_id, event_id);

-- Organizer: find threads with unread messages
CREATE INDEX idx_conv_threads_unread
    ON public.conversation_threads(event_id, unread_count_organizer)
    WHERE unread_count_organizer > 0;
```

---

## 2. Table: conversation_messages

**Purpose**: Individual messages within a conversation thread. Append-only (no UPDATE, only INSERT and DELETE for retention). Each message is either from the participant or from an organizer.

### Column Specifications

| Column | Type | Nullable | Default | Constraints | Notes |
|--------|------|----------|---------|-------------|-------|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PRIMARY KEY | Message identifier |
| `thread_id` | `uuid` | NOT NULL | -- | FK -> conversation_threads(id) CASCADE | Parent thread |
| `sender_type` | `text` | NOT NULL | -- | CHECK IN ('participant', 'organizer') | Who sent this |
| `sender_user_id` | `uuid` | NOT NULL | -- | FK -> auth.users(id) SET NULL | Actual user (for display name lookup) |
| `content` | `text` | NOT NULL | -- | CHECK char_length >= 1 AND char_length <= 2000 | Message body |
| `is_flagged` | `boolean` | NOT NULL | `false` | -- | Profanity/abuse flag (placeholder hook) |
| `created_at` | `timestamptz` | NOT NULL | `now()` | -- | When message was sent |

### Constraints

```sql
-- Primary key
CONSTRAINT conversation_messages_pkey PRIMARY KEY (id)

-- Foreign key to thread (CASCADE: retention cleanup deletes messages)
CONSTRAINT conversation_messages_thread_id_fkey
    FOREIGN KEY (thread_id) REFERENCES public.conversation_threads(id) ON DELETE CASCADE

-- Foreign key to auth user (SET NULL: if user account deleted, messages preserved anonymously)
CONSTRAINT conversation_messages_sender_user_id_fkey
    FOREIGN KEY (sender_user_id) REFERENCES auth.users(id) ON DELETE SET NULL

-- Sender type validation
CONSTRAINT conversation_messages_valid_sender_type
    CHECK (sender_type IN ('participant', 'organizer'))

-- Content length: minimum 1 character, maximum 2000
CONSTRAINT conversation_messages_content_min
    CHECK (char_length(content) >= 1)
CONSTRAINT conversation_messages_content_max
    CHECK (char_length(content) <= 2000)
```

### Indexes

```sql
-- Primary access pattern: get messages for a thread, chronological
CREATE INDEX idx_conv_messages_thread_created
    ON public.conversation_messages(thread_id, created_at ASC);

-- Retention cleanup: find old messages by thread creation date
CREATE INDEX idx_conv_messages_thread_id
    ON public.conversation_messages(thread_id);
```

### Design Note: No updated_at Column
Messages are append-only. No editing or updating of sent messages. This simplifies the model and maintains message integrity for audit purposes. Deletion only happens via GDPR retention cleanup.

---

## 3. Table: faq_items

**Purpose**: FAQ entries managed by organizers per event. Lifecycle: draft (only visible to organizer) -> published (visible to public). Full CRUD by organizer.

### Column Specifications

| Column | Type | Nullable | Default | Constraints | Notes |
|--------|------|----------|---------|-------------|-------|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PRIMARY KEY | FAQ item identifier |
| `org_id` | `uuid` | NOT NULL | -- | FK -> orgs(id) CASCADE | Tenant isolation |
| `event_id` | `uuid` | NOT NULL | -- | FK -> events(id) CASCADE | Which event this FAQ belongs to |
| `title` | `text` | NOT NULL | -- | CHECK char_length >= 1 AND <= 200 | Question / heading |
| `content` | `text` | NOT NULL | -- | CHECK char_length >= 1 AND <= 10000 | Answer (markdown) |
| `category` | `text` | NULL | -- | CHECK char_length <= 50 if not null | Grouping label (free-form, organizer-defined) |
| `status` | `text` | NOT NULL | `'draft'` | CHECK IN ('draft', 'published') | Visibility control |
| `sort_order` | `integer` | NOT NULL | `0` | -- | Manual ordering by organizer |
| `created_by` | `uuid` | NULL | -- | FK -> auth.users(id) SET NULL | Who created this item |
| `created_at` | `timestamptz` | NOT NULL | `now()` | -- | Creation timestamp |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | -- | Last modification (moddatetime trigger) |

### Constraints

```sql
-- Primary key
CONSTRAINT faq_items_pkey PRIMARY KEY (id)

-- Foreign keys
CONSTRAINT faq_items_org_id_fkey
    FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE
CONSTRAINT faq_items_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE
CONSTRAINT faq_items_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL

-- Unique: no duplicate titles per event
CONSTRAINT faq_items_unique_title_per_event
    UNIQUE (event_id, title)

-- Status validation
CONSTRAINT faq_items_valid_status
    CHECK (status IN ('draft', 'published'))

-- Title length
CONSTRAINT faq_items_title_min
    CHECK (char_length(title) >= 1)
CONSTRAINT faq_items_title_max
    CHECK (char_length(title) <= 200)

-- Content length
CONSTRAINT faq_items_content_min
    CHECK (char_length(content) >= 1)
CONSTRAINT faq_items_content_max
    CHECK (char_length(content) <= 10000)

-- Category length (if provided)
CONSTRAINT faq_items_category_max
    CHECK (category IS NULL OR char_length(category) <= 50)
```

### Indexes

```sql
-- Public read: published items for an event, sorted by display order
CREATE INDEX idx_faq_items_event_published
    ON public.faq_items(event_id, sort_order ASC, created_at DESC)
    WHERE status = 'published';

-- Category filter
CREATE INDEX idx_faq_items_event_category
    ON public.faq_items(event_id, category)
    WHERE status = 'published' AND category IS NOT NULL;

-- Organizer admin: all items for an event
CREATE INDEX idx_faq_items_event_all
    ON public.faq_items(event_id, created_at DESC);
```

---

## 4. RLS Policy Specifications

### 4.1 conversation_threads

```sql
ALTER TABLE public.conversation_threads ENABLE ROW LEVEL SECURITY;

-- Participant can see their own thread for an event
CREATE POLICY "Participant can view own thread"
    ON public.conversation_threads FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.participants p
            WHERE p.id = conversation_threads.participant_id
            AND p.user_id = auth.uid()
        )
    );

-- Org members (owner/admin/support) can view all threads for their events
CREATE POLICY "Org members can view event threads"
    ON public.conversation_threads FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.org_members om
            WHERE om.org_id = conversation_threads.org_id
            AND om.user_id = auth.uid()
            AND om.role IN ('owner', 'admin', 'support')
        )
    );

-- Only service role can INSERT (via RPC functions)
-- No INSERT policy for authenticated users = default deny

-- Only org members (owner/admin/support) can UPDATE status
CREATE POLICY "Org members can update thread status"
    ON public.conversation_threads FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.org_members om
            WHERE om.org_id = conversation_threads.org_id
            AND om.user_id = auth.uid()
            AND om.role IN ('owner', 'admin', 'support')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.org_members om
            WHERE om.org_id = conversation_threads.org_id
            AND om.user_id = auth.uid()
            AND om.role IN ('owner', 'admin', 'support')
        )
    );

-- No DELETE policy for authenticated users (service role only for retention)
```

### 4.2 conversation_messages

```sql
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;

-- Participant can see messages in their own thread
CREATE POLICY "Participant can view own thread messages"
    ON public.conversation_messages FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.conversation_threads ct
            JOIN public.participants p ON p.id = ct.participant_id
            WHERE ct.id = conversation_messages.thread_id
            AND p.user_id = auth.uid()
        )
    );

-- Org members can view messages in their event threads
CREATE POLICY "Org members can view event thread messages"
    ON public.conversation_messages FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.conversation_threads ct
            JOIN public.org_members om ON om.org_id = ct.org_id
            WHERE ct.id = conversation_messages.thread_id
            AND om.user_id = auth.uid()
            AND om.role IN ('owner', 'admin', 'support')
        )
    );

-- No INSERT/UPDATE/DELETE for authenticated users (service role only via RPC)
```

### 4.3 faq_items

```sql
ALTER TABLE public.faq_items ENABLE ROW LEVEL SECURITY;

-- Public can read published FAQs
CREATE POLICY "Public can view published FAQs"
    ON public.faq_items FOR SELECT
    USING (status = 'published');

-- Org members can read all FAQs (including drafts)
CREATE POLICY "Org members can view all FAQs for their events"
    ON public.faq_items FOR SELECT
    USING (public.is_org_member(org_id));

-- Org members (owner/admin) can create FAQs
CREATE POLICY "Org members can create FAQ items"
    ON public.faq_items FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.org_members om
            WHERE om.org_id = faq_items.org_id
            AND om.user_id = auth.uid()
            AND om.role IN ('owner', 'admin')
        )
    );

-- Org members (owner/admin) can update FAQs
CREATE POLICY "Org members can update FAQ items"
    ON public.faq_items FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.org_members om
            WHERE om.org_id = faq_items.org_id
            AND om.user_id = auth.uid()
            AND om.role IN ('owner', 'admin')
        )
    );

-- Org members (owner/admin) can delete FAQs
CREATE POLICY "Org members can delete FAQ items"
    ON public.faq_items FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.org_members om
            WHERE om.org_id = faq_items.org_id
            AND om.user_id = auth.uid()
            AND om.role IN ('owner', 'admin')
        )
    );
```

---

## 5. Entity Relationship Addition

```
┌─────────────┐      ┌─────────────┐      ┌──────────────────┐
│    orgs     │──1:N─│   events    │──1:N─│ conversation_    │
└─────────────┘      └──────┬──────┘      │ threads          │
                            │             └────────┬─────────┘
                            │                      │
                            │                      │ 1:N
                            │                      ▼
                            │             ┌──────────────────┐
                            │             │ conversation_    │
                            │             │ messages         │
                            │             └──────────────────┘
                            │
                            │ 1:N
                            ▼
                     ┌──────────────┐
                     │  faq_items   │
                     └──────────────┘

                     ┌──────────────────┐
                     │  participants    │──────────────┐
                     └──────────────────┘              │
                            │                          │ participant_id
                            │ 1                        │
                            └──────────────────────────┘
                                          ▲
                              conversation_threads.participant_id
```

---

## 6. Enum Types (New)

No new enum types required. Both `status` fields use CHECK constraints with text type for simplicity and ease of future extension without migration-level changes.

---

## 7. Trigger: moddatetime

Both `conversation_threads` and `faq_items` require the moddatetime trigger for `updated_at`:

```sql
CREATE TRIGGER handle_updated_at_conversation_threads
    BEFORE UPDATE ON public.conversation_threads
    FOR EACH ROW EXECUTE PROCEDURE extensions.moddatetime(updated_at);

CREATE TRIGGER handle_updated_at_faq_items
    BEFORE UPDATE ON public.faq_items
    FOR EACH ROW EXECUTE PROCEDURE extensions.moddatetime(updated_at);
```

---

*Database Design Document - F012*
*Created: 2026-01-28 | Author: @pm*
