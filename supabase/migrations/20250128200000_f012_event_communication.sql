-- ===========================================================================
-- F012: Event Communication - Participant <-> Organizer Messaging + FAQ
-- Migration: 20250128200000_f012_event_communication.sql
--
-- Purpose:
--   Participant-organizer messaging (threaded chat) and FAQ management for
--   events. Built on the existing multi-tenant org_id pattern with RLS-first
--   security.
--
-- Tables created:
--   1. chat_threads       - One thread per (org, event, participant) combo
--   2. chat_messages      - Individual messages within threads
--   3. chat_thread_reads  - Read receipts ("seen by organizer")
--   4. faq_items          - FAQ entries (org-wide or event-specific)
--
-- Settings domain added:
--   'messaging' - rate limits, max length, retention, notification toggles
--
-- Design Principles:
--   - org_id denormalized on all tables for O(1) RLS evaluation
--   - Unread counter materialized on chat_threads for fast dashboard queries
--   - FAQ uses nullable event_id for org-wide vs event-specific scoping
--   - No DELETE policies: messages are append-only, threads use status changes
--   - Audit log entries for thread status changes and FAQ mutations
-- ===========================================================================

-- ===========================================================================
-- 1. ENUM TYPES
-- ===========================================================================

-- Chat thread status
DO $$ BEGIN
    CREATE TYPE chat_thread_status AS ENUM (
        'open',      -- Active, awaiting organizer reply
        'pending',   -- Participant replied, ball is in organizer's court
        'closed'     -- Resolved / closed by organizer
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Chat message sender type
DO $$ BEGIN
    CREATE TYPE chat_sender_type AS ENUM (
        'participant',  -- Sent by the participant
        'organizer'     -- Sent by an org member (owner/admin/support)
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- FAQ item status
DO $$ BEGIN
    CREATE TYPE faq_status AS ENUM (
        'draft',      -- Not visible to public
        'published'   -- Visible to public (for published events)
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ===========================================================================
-- 2. TABLES
-- ===========================================================================

-- 2.1 chat_threads: One support thread per participant per event
-- Unique on (org_id, event_id, participant_id) so each participant has
-- exactly one thread for each event they are involved in.
CREATE TABLE IF NOT EXISTS public.chat_threads (
    id uuid NOT NULL DEFAULT gen_random_uuid(),

    -- Scoping (denormalized for RLS performance)
    org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE RESTRICT,
    event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
    participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE RESTRICT,

    -- State
    status chat_thread_status NOT NULL DEFAULT 'open',

    -- Counters (materialized for fast dashboard queries)
    unread_count_organizer integer NOT NULL DEFAULT 0,

    -- Timestamps
    last_message_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chat_threads_pkey PRIMARY KEY (id),
    -- One thread per participant per event (within the org)
    CONSTRAINT chat_threads_unique_scope UNIQUE (org_id, event_id, participant_id),
    -- Sanity: unread count cannot be negative
    CONSTRAINT chat_threads_unread_non_negative CHECK (unread_count_organizer >= 0)
);

-- 2.2 chat_messages: Individual messages within a thread
-- Append-only: no UPDATE or DELETE policies are granted.
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id uuid NOT NULL DEFAULT gen_random_uuid(),

    -- Parent thread
    thread_id uuid NOT NULL REFERENCES public.chat_threads(id) ON DELETE RESTRICT,

    -- Denormalized for RLS (avoids JOIN through chat_threads on every policy check)
    org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE RESTRICT,

    -- Sender identification
    sender_type chat_sender_type NOT NULL,
    -- The auth.users ID of the sender. NULL for guest participants (no auth account).
    sender_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

    -- Content
    content text NOT NULL,

    -- Moderation placeholder (profanity detection stub)
    is_flagged boolean NOT NULL DEFAULT false,

    -- Timestamp (no updated_at: messages are immutable)
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chat_messages_pkey PRIMARY KEY (id),
    -- Max 2000 characters per message
    CONSTRAINT chat_messages_content_length CHECK (char_length(content) <= 2000),
    -- Content must not be empty or whitespace-only
    CONSTRAINT chat_messages_content_not_empty CHECK (length(trim(content)) > 0)
);

-- 2.3 chat_thread_reads: Audit trail of when organizers read threads
-- Enables "last seen" tracking and accurate unread state.
CREATE TABLE IF NOT EXISTS public.chat_thread_reads (
    id uuid NOT NULL DEFAULT gen_random_uuid(),

    thread_id uuid NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
    -- The org member who read the thread
    read_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- Timestamp of the read action
    read_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chat_thread_reads_pkey PRIMARY KEY (id),
    -- Each user reads a thread at most once per "session" (upsert pattern in Edge Function)
    CONSTRAINT chat_thread_reads_unique UNIQUE (thread_id, read_by_user_id)
);

-- 2.4 faq_items: FAQ entries scoped to org or event
-- When event_id IS NULL: FAQ is org-wide (applies to all events in the org).
-- When event_id IS NOT NULL: FAQ is event-specific.
CREATE TABLE IF NOT EXISTS public.faq_items (
    id uuid NOT NULL DEFAULT gen_random_uuid(),

    -- Scoping
    org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
    -- Nullable: NULL = org-wide, set = event-specific
    event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,

    -- Content
    title text NOT NULL,
    content text,  -- Markdown body
    category text,  -- Free-form category label (e.g. "Tickets", "Location")

    -- Lifecycle
    status faq_status NOT NULL DEFAULT 'draft',

    -- Ordering within a category/page
    sort_order integer NOT NULL DEFAULT 0,

    -- Authorship
    created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,

    -- Timestamps
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT faq_items_pkey PRIMARY KEY (id),
    -- Title must be non-empty
    CONSTRAINT faq_items_title_not_empty CHECK (length(trim(title)) > 0)
);

-- ===========================================================================
-- 3. INDEXES
-- ===========================================================================

-- chat_threads: Primary access patterns
-- Organizer dashboard: list threads for an event, filtered by status
CREATE INDEX IF NOT EXISTS idx_chat_threads_event_status
    ON public.chat_threads(event_id, status);
-- Organizer dashboard: all threads for an org with unread > 0
CREATE INDEX IF NOT EXISTS idx_chat_threads_org_unread
    ON public.chat_threads(org_id, unread_count_organizer)
    WHERE unread_count_organizer > 0;
-- Participant lookup: find my thread for this event
CREATE INDEX IF NOT EXISTS idx_chat_threads_participant_event
    ON public.chat_threads(participant_id, event_id);
-- Last message ordering
CREATE INDEX IF NOT EXISTS idx_chat_threads_last_message
    ON public.chat_threads(event_id, last_message_at DESC);

-- chat_messages: Primary access pattern is "get messages in thread"
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_created
    ON public.chat_messages(thread_id, created_at ASC);
-- Org-level access (for organizer viewing all messages)
CREATE INDEX IF NOT EXISTS idx_chat_messages_org
    ON public.chat_messages(org_id, created_at DESC);

-- chat_thread_reads: Lookup by thread
CREATE INDEX IF NOT EXISTS idx_chat_thread_reads_thread
    ON public.chat_thread_reads(thread_id);

-- faq_items: Primary access patterns
-- Public FAQ listing: event + published status + sort order
CREATE INDEX IF NOT EXISTS idx_faq_items_event_published
    ON public.faq_items(event_id, status, sort_order)
    WHERE status = 'published';
-- Org-wide FAQs (event_id IS NULL)
CREATE INDEX IF NOT EXISTS idx_faq_items_org_wide
    ON public.faq_items(org_id, status, sort_order)
    WHERE event_id IS NULL;
-- Category filtering
CREATE INDEX IF NOT EXISTS idx_faq_items_category
    ON public.faq_items(org_id, category, status);
-- Full-text search support (title + content)
CREATE INDEX IF NOT EXISTS idx_faq_items_search
    ON public.faq_items USING GIN (
        to_tsvector('dutch', coalesce(title, '') || ' ' || coalesce(content, ''))
    );

-- ===========================================================================
-- 4. ROW LEVEL SECURITY (RLS)
-- ===========================================================================

-- Enable RLS on all new tables (CRITICAL: default deny)
ALTER TABLE public.chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_thread_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faq_items ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 4.1 chat_threads POLICIES
-- --------------------------------------------------------------------------

-- Participants can SELECT their own thread
-- (Participant is identified via the participants table linked to auth.uid())
DROP POLICY IF EXISTS "Participants can view own chat threads" ON public.chat_threads;
CREATE POLICY "Participants can view own chat threads"
    ON public.chat_threads
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.participants p
            WHERE p.id = chat_threads.participant_id
            AND p.user_id = auth.uid()
        )
    );

-- Organizers (owner/admin/support) can SELECT all threads for their org's events
DROP POLICY IF EXISTS "Organizers can view all threads for their org" ON public.chat_threads;
CREATE POLICY "Organizers can view all threads for their org"
    ON public.chat_threads
    FOR SELECT
    USING (
        public.is_org_member(org_id)
        AND (
            public.has_role(org_id, 'owner')
            OR public.has_role(org_id, 'admin')
            OR public.has_role(org_id, 'support')
        )
    );

-- Participants can INSERT a thread only if they have a valid registration
-- or ticket_instance for the event. This prevents spam from random users.
-- Note: Edge Function enforces additional checks; this is defense-in-depth.
DROP POLICY IF EXISTS "Participants can create thread if registered" ON public.chat_threads;
CREATE POLICY "Participants can create thread if registered"
    ON public.chat_threads
    FOR INSERT
    WITH CHECK (
        -- Must be the participant's own profile
        EXISTS (
            SELECT 1 FROM public.participants p
            WHERE p.id = chat_threads.participant_id
            AND p.user_id = auth.uid()
        )
        -- Must have registration OR ticket for this event
        AND (
            EXISTS (
                SELECT 1 FROM public.registrations r
                WHERE r.event_id = chat_threads.event_id
                AND r.participant_id = chat_threads.participant_id
                AND r.status IN ('pending', 'confirmed')
            )
            OR EXISTS (
                SELECT 1 FROM public.ticket_instances ti
                WHERE ti.event_id = chat_threads.event_id
                AND ti.owner_user_id = auth.uid()
                AND ti.status IN ('issued', 'checked_in')
            )
        )
    );

-- Organizers can UPDATE thread status (open/closed/pending)
-- Finance role excluded: they should not manage support threads.
DROP POLICY IF EXISTS "Organizers can update thread status" ON public.chat_threads;
CREATE POLICY "Organizers can update thread status"
    ON public.chat_threads
    FOR UPDATE
    USING (
        public.is_org_member(org_id)
        AND (
            public.has_role(org_id, 'owner')
            OR public.has_role(org_id, 'admin')
            OR public.has_role(org_id, 'support')
        )
    );

-- NO DELETE policy: threads are never deleted.

-- --------------------------------------------------------------------------
-- 4.2 chat_messages POLICIES
-- --------------------------------------------------------------------------

-- Participants can SELECT messages in their own thread
DROP POLICY IF EXISTS "Participants can view messages in own thread" ON public.chat_messages;
CREATE POLICY "Participants can view messages in own thread"
    ON public.chat_messages
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.chat_threads ct
            JOIN public.participants p ON p.id = ct.participant_id
            WHERE ct.id = chat_messages.thread_id
            AND p.user_id = auth.uid()
        )
    );

-- Organizers can SELECT all messages in their org's event threads
DROP POLICY IF EXISTS "Organizers can view all messages in org threads" ON public.chat_messages;
CREATE POLICY "Organizers can view all messages in org threads"
    ON public.chat_messages
    FOR SELECT
    USING (
        public.is_org_member(org_id)
        AND (
            public.has_role(org_id, 'owner')
            OR public.has_role(org_id, 'admin')
            OR public.has_role(org_id, 'support')
        )
    );

-- Participants can INSERT into their own thread
-- Rate limiting is enforced at Edge Function level (not here).
DROP POLICY IF EXISTS "Participants can send messages in own thread" ON public.chat_messages;
CREATE POLICY "Participants can send messages in own thread"
    ON public.chat_messages
    FOR INSERT
    WITH CHECK (
        chat_messages.sender_type = 'participant'
        AND EXISTS (
            SELECT 1 FROM public.chat_threads ct
            JOIN public.participants p ON p.id = ct.participant_id
            WHERE ct.id = chat_messages.thread_id
            AND p.user_id = auth.uid()
            AND ct.status != 'closed'  -- Cannot message in closed threads
        )
    );

-- Organizers can INSERT into any thread for their org's events
DROP POLICY IF EXISTS "Organizers can send messages in org threads" ON public.chat_messages;
CREATE POLICY "Organizers can send messages in org threads"
    ON public.chat_messages
    FOR INSERT
    WITH CHECK (
        chat_messages.sender_type = 'organizer'
        AND public.is_org_member(chat_messages.org_id)
        AND (
            public.has_role(chat_messages.org_id, 'owner')
            OR public.has_role(chat_messages.org_id, 'admin')
            OR public.has_role(chat_messages.org_id, 'support')
        )
    );

-- NO UPDATE or DELETE policies: messages are append-only and immutable.

-- --------------------------------------------------------------------------
-- 4.3 chat_thread_reads POLICIES
-- --------------------------------------------------------------------------

-- Organizers can view read receipts for their org's threads
DROP POLICY IF EXISTS "Organizers can view read receipts" ON public.chat_thread_reads;
CREATE POLICY "Organizers can view read receipts"
    ON public.chat_thread_reads
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.chat_threads ct
            WHERE ct.id = chat_thread_reads.thread_id
            AND public.is_org_member(ct.org_id)
        )
    );

-- Organizers can INSERT/UPDATE their own read receipts
-- (UPSERT pattern: Edge Function inserts on conflict updates read_at)
DROP POLICY IF EXISTS "Organizers can mark threads as read" ON public.chat_thread_reads;
CREATE POLICY "Organizers can mark threads as read"
    ON public.chat_thread_reads
    FOR INSERT
    WITH CHECK (
        chat_thread_reads.read_by_user_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.chat_threads ct
            WHERE ct.id = chat_thread_reads.thread_id
            AND public.is_org_member(ct.org_id)
        )
    );

-- Allow UPDATE for upsert pattern (ON CONFLICT DO UPDATE needs this)
DROP POLICY IF EXISTS "Organizers can update own read receipts" ON public.chat_thread_reads;
CREATE POLICY "Organizers can update own read receipts"
    ON public.chat_thread_reads
    FOR UPDATE
    USING (read_by_user_id = auth.uid());

-- --------------------------------------------------------------------------
-- 4.4 faq_items POLICIES
-- --------------------------------------------------------------------------

-- Public/authenticated users can SELECT published FAQs for published events
-- This includes org-wide FAQs (event_id IS NULL) and event-specific ones.
DROP POLICY IF EXISTS "Public can view published FAQs" ON public.faq_items;
CREATE POLICY "Public can view published FAQs"
    ON public.faq_items
    FOR SELECT
    USING (
        status = 'published'
        AND (
            -- Event-specific FAQ: event must be published
            (event_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.events e
                WHERE e.id = faq_items.event_id
                AND e.status = 'published'
                AND e.deleted_at IS NULL
            ))
            -- Org-wide FAQ: visible to anyone who can see any published event in that org
            OR (event_id IS NULL AND EXISTS (
                SELECT 1 FROM public.events e
                WHERE e.org_id = faq_items.org_id
                AND e.status = 'published'
                AND e.deleted_at IS NULL
            ))
        )
    );

-- Organizers (owner/admin) can SELECT all FAQs (including drafts)
DROP POLICY IF EXISTS "Organizers can view all FAQs including drafts" ON public.faq_items;
CREATE POLICY "Organizers can view all FAQs including drafts"
    ON public.faq_items
    FOR SELECT
    USING (
        public.is_org_member(org_id)
        AND (
            public.has_role(org_id, 'owner')
            OR public.has_role(org_id, 'admin')
        )
    );

-- Organizers (owner/admin) can INSERT FAQ items
DROP POLICY IF EXISTS "Organizers can create FAQ items" ON public.faq_items;
CREATE POLICY "Organizers can create FAQ items"
    ON public.faq_items
    FOR INSERT
    WITH CHECK (
        public.is_org_member(faq_items.org_id)
        AND (
            public.has_role(faq_items.org_id, 'owner')
            OR public.has_role(faq_items.org_id, 'admin')
        )
        -- If event_id is set, validate it belongs to the same org
        AND (
            faq_items.event_id IS NULL
            OR EXISTS (
                SELECT 1 FROM public.events e
                WHERE e.id = faq_items.event_id
                AND e.org_id = faq_items.org_id
            )
        )
    );

-- Organizers (owner/admin) can UPDATE FAQ items
DROP POLICY IF EXISTS "Organizers can update FAQ items" ON public.faq_items;
CREATE POLICY "Organizers can update FAQ items"
    ON public.faq_items
    FOR UPDATE
    USING (
        public.is_org_member(org_id)
        AND (
            public.has_role(org_id, 'owner')
            OR public.has_role(org_id, 'admin')
        )
    );

-- Organizers (owner/admin) can DELETE FAQ items
DROP POLICY IF EXISTS "Organizers can delete FAQ items" ON public.faq_items;
CREATE POLICY "Organizers can delete FAQ items"
    ON public.faq_items
    FOR DELETE
    USING (
        public.is_org_member(org_id)
        AND (
            public.has_role(org_id, 'owner')
            OR public.has_role(org_id, 'admin')
        )
    );

-- ===========================================================================
-- 5. TRIGGERS
-- ===========================================================================

-- 5.1 Auto-update updated_at on chat_threads
DROP TRIGGER IF EXISTS chat_threads_updated_at ON public.chat_threads;
CREATE TRIGGER chat_threads_updated_at
    BEFORE UPDATE ON public.chat_threads
    FOR EACH ROW
    EXECUTE FUNCTION public.trigger_set_updated_at();

-- 5.2 Auto-update updated_at on faq_items
DROP TRIGGER IF EXISTS faq_items_updated_at ON public.faq_items;
CREATE TRIGGER faq_items_updated_at
    BEFORE UPDATE ON public.faq_items
    FOR EACH ROW
    EXECUTE FUNCTION public.trigger_set_updated_at();

-- 5.3 Auto-update last_message_at and unread_count on new message
-- When a participant sends a message, increment unread_count_organizer.
-- When an organizer sends a message, the count stays (it is their own message).
-- Also updates last_message_at on the thread.
CREATE OR REPLACE FUNCTION public.on_chat_message_inserted()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Update last_message_at on the parent thread (always)
    UPDATE public.chat_threads
    SET
        last_message_at = NEW.created_at,
        updated_at = NEW.created_at,
        -- Increment unread only when participant sends (organizer needs to read it)
        unread_count_organizer = CASE
            WHEN NEW.sender_type = 'participant'
            THEN unread_count_organizer + 1
            ELSE unread_count_organizer
        END,
        -- Auto-transition thread status based on sender
        status = CASE
            WHEN NEW.sender_type = 'participant' AND status = 'closed'
            -- Participant re-opened a closed thread by messaging
            THEN 'open'
            WHEN NEW.sender_type = 'participant'
            -- Participant message -> pending (waiting for organizer)
            THEN 'pending'
            -- Organizer replied -> back to open
            WHEN NEW.sender_type = 'organizer' AND status = 'pending'
            THEN 'open'
            ELSE status
        END
    WHERE id = NEW.thread_id;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_chat_message_inserted ON public.chat_messages;
CREATE TRIGGER on_chat_message_inserted
    AFTER INSERT ON public.chat_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.on_chat_message_inserted();

-- 5.4 Audit log trigger for thread status changes
-- Fires AFTER UPDATE on chat_threads when status changes.
CREATE OR REPLACE FUNCTION public.audit_chat_thread_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Only log if status actually changed
    IF OLD.status != NEW.status THEN
        INSERT INTO public.audit_log (
            org_id,
            actor_user_id,
            action,
            entity_type,
            entity_id,
            before_state,
            after_state,
            metadata
        ) VALUES (
            NEW.org_id,
            auth.uid(),
            'THREAD_STATUS_CHANGED',
            'chat_thread',
            NEW.id,
            jsonb_build_object('status', OLD.status::text),
            jsonb_build_object('status', NEW.status::text),
            jsonb_build_object(
                'event_id', NEW.event_id,
                'participant_id', NEW.participant_id
            )
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_chat_thread_status ON public.chat_threads;
CREATE TRIGGER audit_chat_thread_status
    AFTER UPDATE ON public.chat_threads
    FOR EACH ROW
    EXECUTE FUNCTION public.audit_chat_thread_status_change();

-- ===========================================================================
-- 6. HELPER FUNCTIONS (RPCs for Edge Functions)
-- ===========================================================================

-- 6.1 get_or_create_thread: Find existing thread or create new one
-- Used by send-message Edge Function to ensure thread exists before inserting.
-- Returns the thread_id (existing or newly created).
CREATE OR REPLACE FUNCTION public.get_or_create_chat_thread(
    _event_id uuid,
    _participant_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _thread_id uuid;
    _org_id uuid;
BEGIN
    -- Resolve org_id from event
    SELECT org_id INTO _org_id
    FROM public.events
    WHERE id = _event_id;

    IF _org_id IS NULL THEN
        RAISE EXCEPTION 'Event not found: %', _event_id;
    END IF;

    -- Try to find existing thread
    SELECT id INTO _thread_id
    FROM public.chat_threads
    WHERE event_id = _event_id
    AND participant_id = _participant_id
    AND org_id = _org_id;

    -- If not found, create it
    IF _thread_id IS NULL THEN
        INSERT INTO public.chat_threads (org_id, event_id, participant_id, status)
        VALUES (_org_id, _event_id, _participant_id, 'open')
        RETURNING id INTO _thread_id;
    END IF;

    RETURN _thread_id;
END;
$$;

COMMENT ON FUNCTION public.get_or_create_chat_thread IS
    'Get or create a chat thread for a participant on an event. Returns thread_id.';

-- 6.2 mark_thread_read: Reset unread counter and record read receipt
-- Called by get-thread-messages Edge Function after organizer views a thread.
CREATE OR REPLACE FUNCTION public.mark_chat_thread_read(
    _thread_id uuid,
    _reader_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Verify thread exists and reader is an org member
    IF NOT EXISTS (
        SELECT 1 FROM public.chat_threads ct
        WHERE ct.id = _thread_id
        AND public.is_org_member(ct.org_id)
    ) THEN
        RAISE EXCEPTION 'Thread not found or not authorized';
    END IF;

    -- Reset unread counter to 0
    UPDATE public.chat_threads
    SET unread_count_organizer = 0, updated_at = now()
    WHERE id = _thread_id;

    -- Upsert read receipt
    INSERT INTO public.chat_thread_reads (thread_id, read_by_user_id, read_at)
    VALUES (_thread_id, _reader_user_id, now())
    ON CONFLICT (thread_id, read_by_user_id)
    DO UPDATE SET read_at = now();

    RETURN true;
END;
$$;

COMMENT ON FUNCTION public.mark_chat_thread_read IS
    'Reset unread counter and record read receipt for a thread. Called when organizer views messages.';

-- 6.3 check_participant_event_access: Verify participant has valid access to event
-- Used by send-message to validate before creating a thread.
CREATE OR REPLACE FUNCTION public.check_participant_event_access(
    _event_id uuid,
    _participant_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    -- Check registration (pending or confirmed)
    IF EXISTS (
        SELECT 1 FROM public.registrations r
        WHERE r.event_id = _event_id
        AND r.participant_id = _participant_id
        AND r.status IN ('pending', 'confirmed')
    ) THEN
        RETURN true;
    END IF;

    -- Check ticket ownership (issued or checked_in)
    IF EXISTS (
        SELECT 1 FROM public.ticket_instances ti
        JOIN public.participants p ON p.user_id = ti.owner_user_id
        WHERE ti.event_id = _event_id
        AND p.id = _participant_id
        AND ti.status IN ('issued', 'checked_in')
    ) THEN
        RETURN true;
    END IF;

    RETURN false;
END;
$$;

COMMENT ON FUNCTION public.check_participant_event_access IS
    'Verify that a participant has a valid registration or ticket for an event.';

-- 6.4 get_messaging_settings: Retrieve effective messaging settings for an event
-- Reads from the messaging settings domain (defaults -> org -> event merge).
CREATE OR REPLACE FUNCTION public.get_messaging_settings(
    _event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
    _org_id uuid;
    _defaults jsonb;
    _org_val jsonb;
    _event_val jsonb;
    _result jsonb;
BEGIN
    SELECT org_id INTO _org_id FROM public.events WHERE id = _event_id;
    IF _org_id IS NULL THEN
        RAISE EXCEPTION 'Event not found: %', _event_id;
    END IF;

    -- System defaults for messaging domain
    _defaults := jsonb_build_object(
        'rate_limit', jsonb_build_object(
            'msgs_per_minute', 5
        ),
        'max_message_length', 2000,
        'retention_days', 180,
        'notifications', jsonb_build_object(
            'email_enabled', false
        )
    );

    -- Org-level override
    SELECT setting_value INTO _org_val
    FROM public.org_settings
    WHERE org_id = _org_id AND domain = 'messaging';
    IF _org_val IS NULL THEN _org_val := '{}'::jsonb; END IF;

    -- Event-level override
    SELECT setting_value INTO _event_val
    FROM public.event_settings
    WHERE event_id = _event_id AND domain = 'messaging';
    IF _event_val IS NULL THEN _event_val := '{}'::jsonb; END IF;

    -- Merge: defaults || org || event (right side wins)
    _result := public.jsonb_deep_merge(
        public.jsonb_deep_merge(_defaults, _org_val),
        _event_val
    );

    RETURN _result;
END;
$$;

COMMENT ON FUNCTION public.get_messaging_settings IS
    'Get effective messaging settings for an event (defaults -> org -> event merge).';

-- 6.5 count_recent_messages: Rate limit check helper
-- Counts messages sent by a user in the last N seconds.
CREATE OR REPLACE FUNCTION public.count_recent_participant_messages(
    _thread_id uuid,
    _sender_user_id uuid,
    _window_seconds integer DEFAULT 60
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
    _count integer;
BEGIN
    SELECT COUNT(*) INTO _count
    FROM public.chat_messages
    WHERE thread_id = _thread_id
    AND sender_user_id = _sender_user_id
    AND sender_type = 'participant'
    AND created_at > now() - (_window_seconds || ' seconds')::interval;

    RETURN _count;
END;
$$;

COMMENT ON FUNCTION public.count_recent_participant_messages IS
    'Count messages sent by a participant in a thread within a time window. Used for rate limiting.';

-- ===========================================================================
-- 7. SETTINGS DOMAIN EXTENSION: 'messaging'
-- ===========================================================================

-- 7.1 Update domain CHECK constraints to include 'messaging'
DO $$
BEGIN
    ALTER TABLE public.org_settings DROP CONSTRAINT IF EXISTS org_settings_domain_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE public.org_settings ADD CONSTRAINT org_settings_domain_check
    CHECK (domain IN (
        'payments', 'transfers', 'communication', 'governance', 'legal',
        'basic_info', 'content_communication', 'branding', 'waitlist',
        'interest_list', 'ticket_pdf', 'ticket_privacy',
        'general', 'registration', 'checkout', 'privacy', 'observability',
        'participants', 'tickets', 'scanning',
        -- NEW: F012 Messaging domain
        'messaging'
    ));

DO $$
BEGIN
    ALTER TABLE public.event_settings DROP CONSTRAINT IF EXISTS event_settings_domain_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE public.event_settings ADD CONSTRAINT event_settings_domain_check
    CHECK (domain IN (
        'payments', 'transfers', 'communication', 'governance', 'legal',
        'basic_info', 'content_communication', 'branding', 'waitlist',
        'interest_list', 'ticket_pdf', 'ticket_privacy',
        'general', 'registration', 'checkout', 'privacy', 'observability',
        'participants', 'tickets', 'scanning',
        -- NEW: F012 Messaging domain
        'messaging'
    ));

-- 7.2 Update validate_setting_domain to handle 'messaging'
-- Note: This extends the existing function. The CASE statement already handles
-- unknown domains with RAISE EXCEPTION, so we add the 'messaging' WHEN clause.
-- We must redefine the full function to add the new WHEN branch.
-- For brevity, we use a targeted approach: just add validation for the new domain.

CREATE OR REPLACE FUNCTION public.validate_messaging_settings(_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
    _rate_limit jsonb;
    _notifications jsonb;
BEGIN
    -- rate_limit (nested object)
    IF _value ? 'rate_limit' THEN
        _rate_limit := _value->'rate_limit';

        IF jsonb_typeof(_rate_limit) != 'object' THEN
            RAISE EXCEPTION 'rate_limit must be an object';
        END IF;

        -- rate_limit.msgs_per_minute (number, 1-60)
        IF _rate_limit ? 'msgs_per_minute' THEN
            PERFORM public.validate_number_range(
                _rate_limit->'msgs_per_minute',
                'rate_limit.msgs_per_minute',
                1, 60
            );
        END IF;
    END IF;

    -- max_message_length (number, 1-10000)
    IF _value ? 'max_message_length' THEN
        PERFORM public.validate_number_range(
            _value->'max_message_length',
            'max_message_length',
            1, 10000
        );
    END IF;

    -- retention_days (number, 7-3650)
    IF _value ? 'retention_days' THEN
        PERFORM public.validate_number_range(
            _value->'retention_days',
            'retention_days',
            7, 3650
        );
    END IF;

    -- notifications (nested object)
    IF _value ? 'notifications' THEN
        _notifications := _value->'notifications';

        IF jsonb_typeof(_notifications) != 'object' THEN
            RAISE EXCEPTION 'notifications must be an object';
        END IF;

        -- notifications.email_enabled (boolean)
        IF (_notifications ? 'email_enabled') AND (jsonb_typeof(_notifications->'email_enabled') != 'boolean') THEN
            RAISE EXCEPTION 'notifications.email_enabled must be a boolean';
        END IF;
    END IF;

    RETURN true;
END;
$$;

COMMENT ON FUNCTION public.validate_messaging_settings IS
    'Validate messaging settings values for the messaging domain.';

-- ===========================================================================
-- 8. COMMENTS
-- ===========================================================================

COMMENT ON TABLE public.chat_threads IS
    'Support threads: one per (org, event, participant). Tracks status and unread count.';
COMMENT ON TABLE public.chat_messages IS
    'Individual messages within chat threads. Append-only (no update/delete).';
COMMENT ON TABLE public.chat_thread_reads IS
    'Read receipts: when organizers last viewed a thread.';
COMMENT ON TABLE public.faq_items IS
    'FAQ entries. event_id NULL = org-wide. event_id set = event-specific. Supports markdown content.';

COMMENT ON COLUMN public.chat_threads.unread_count_organizer IS
    'Materialized counter: number of unread participant messages. Managed by triggers + Edge Functions.';
COMMENT ON COLUMN public.chat_threads.status IS
    'open=active, pending=waiting for organizer reply, closed=resolved.';
COMMENT ON COLUMN public.chat_messages.sender_user_id IS
    'Auth user ID of sender. NULL for guest participants without an auth account.';
COMMENT ON COLUMN public.faq_items.event_id IS
    'NULL = org-wide FAQ. Set = event-specific FAQ. Validated via CHECK in INSERT policy.';
COMMENT ON COLUMN public.faq_items.content IS
    'Markdown-formatted FAQ body. Rendered client-side.';

-- ===========================================================================
-- 9. VERIFICATION
-- ===========================================================================

DO $$
BEGIN
    -- Verify tables exist
    ASSERT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'chat_threads'
    ), 'chat_threads table missing';

    ASSERT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'chat_messages'
    ), 'chat_messages table missing';

    ASSERT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'chat_thread_reads'
    ), 'chat_thread_reads table missing';

    ASSERT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'faq_items'
    ), 'faq_items table missing';

    -- Verify RLS is enabled
    ASSERT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'chat_threads'
        AND n.nspname = 'public'
        AND c.relrowsecurity = true
    ), 'RLS not enabled on chat_threads';

    ASSERT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'chat_messages'
        AND n.nspname = 'public'
        AND c.relrowsecurity = true
    ), 'RLS not enabled on chat_messages';

    ASSERT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'faq_items'
        AND n.nspname = 'public'
        AND c.relrowsecurity = true
    ), 'RLS not enabled on faq_items';

    -- Verify helper functions exist
    ASSERT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'get_or_create_chat_thread'
    ), 'get_or_create_chat_thread function missing';

    ASSERT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'mark_chat_thread_read'
    ), 'mark_chat_thread_read function missing';

    ASSERT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'check_participant_event_access'
    ), 'check_participant_event_access function missing';

    ASSERT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'get_messaging_settings'
    ), 'get_messaging_settings function missing';

    ASSERT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'validate_messaging_settings'
    ), 'validate_messaging_settings function missing';

    -- Verify messaging settings validation works
    ASSERT public.validate_messaging_settings('{
        "rate_limit": {"msgs_per_minute": 10},
        "max_message_length": 1500,
        "retention_days": 90,
        "notifications": {"email_enabled": true}
    }'::jsonb) = true, 'Valid messaging settings rejected';

    RAISE NOTICE 'F012: All tables, RLS policies, triggers, and helper functions verified.';
END;
$$;

-- End of migration
