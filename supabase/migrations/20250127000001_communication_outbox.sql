-- Migration: 20250127000001_communication_outbox.sql
-- Description: Communication Module - Email Outbox Pattern with Bulk Messaging
-- Purpose: Queue-based email verzending met exactly-once garanties, bulk messaging, en compliance (GDPR)
--
-- Tables created:
--   1. message_templates - Reusable email templates
--   2. message_batches - Bulk job tracking met progress monitoring
--   3. email_outbox - Queue voor alle uitgaande emails
--   4. email_outbox_events - Event sourcing voor status changes
--   5. message_batch_items - Individual recipients per batch
--   6. email_unsubscribes - Unsubscribe registry per email/org/type
--   7. email_bounces - Bounce history tracking
--
-- Design Principles:
--   - Outbox Pattern: Emails worden altijd eerst in DB geschreven (transactioneel veilig)
--   - Idempotency: Dubbele verzending wordt voorkomen via idempotency_key
--   - Event Sourcing: Alle status changes worden gelogd in email_outbox_events
--   - Retry-safe: Gefaalde emails worden automatisch opnieuw geprobeerd met exponential backoff

-- ========================================================
-- 1. ENUM TYPES
-- ========================================================

-- Email status voor de volledige lifecycle van een email
DO $$ BEGIN
    CREATE TYPE email_status AS ENUM (
        'queued',        -- Wacht op verzending
        'processing',    -- Wordt momenteel verzonden
        'sent',          -- Verzonden naar provider (niet bevestigd)
        'delivered',     -- Ontvangen door recipient mailserver
        'bounced',       -- Hard bounce - permanent afgewezen
        'soft_bounced',  -- Soft bounce - tijdelijk probleem, retry mogelijk
        'complained',    -- Recipient heeft spam gemeld
        'failed',        -- Verzending gefaald na alle retries
        'cancelled'      -- Handmatig geannuleerd
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Batch status voor bulk email jobs
DO $$ BEGIN
    CREATE TYPE batch_status AS ENUM (
        'draft',         -- Concept, nog niet klaar voor verzending
        'queued',        -- Wacht op processing
        'processing',    -- Recipients worden verwerkt
        'sending',       -- Emails worden verzonden
        'completed',     -- Alle emails verwerkt
        'paused',        -- Handmatig gepauzeerd
        'cancelled',     -- Handmatig geannuleerd
        'failed'         -- Processing gefaald
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Batch item status voor individuele recipients in een batch
DO $$ BEGIN
    CREATE TYPE batch_item_status AS ENUM (
        'pending',       -- Wacht op processing
        'queued',        -- Email is aangemaakt in outbox
        'skipped',       -- Overgeslagen (unsubscribed/bounced)
        'failed'         -- Kon niet worden verwerkt
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ========================================================
-- 2. TABLES (in dependency order)
-- ========================================================

-- 2.1 message_templates: Reusable email templates
-- Templates worden per organisatie beheerd en kunnen variabelen bevatten
CREATE TABLE IF NOT EXISTS public.message_templates (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
    name text NOT NULL,
    description text,
    -- Subject en body als JSONB voor i18n support: {"nl": "...", "en": "..."}
    subject jsonb NOT NULL,
    html_body jsonb NOT NULL,
    text_body jsonb,
    -- Schema voor template variabelen (voor UI validatie)
    variables_schema jsonb DEFAULT '{}'::jsonb,
    -- Type: system templates zijn read-only
    template_type text NOT NULL DEFAULT 'custom',
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid REFERENCES auth.users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT message_templates_pkey PRIMARY KEY (id),
    CONSTRAINT message_templates_valid_type CHECK (template_type IN ('system', 'custom')),
    CONSTRAINT message_templates_unique_name UNIQUE (org_id, name)
);

-- 2.2 message_batches: Bulk job tracking met progress monitoring
CREATE TABLE IF NOT EXISTS public.message_batches (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE RESTRICT,
    event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
    name text NOT NULL,
    description text,
    -- Email type bepaalt of marketing unsubscribe regels van toepassing zijn
    email_type text NOT NULL DEFAULT 'marketing',
    template_id uuid REFERENCES public.message_templates(id),
    subject text NOT NULL,
    html_body text NOT NULL,
    text_body text,
    -- Filter voor recipient selectie (stored voor audit trail)
    recipient_filter jsonb NOT NULL,
    status batch_status NOT NULL DEFAULT 'draft',
    -- Progress counters
    total_recipients integer NOT NULL DEFAULT 0,
    queued_count integer NOT NULL DEFAULT 0,
    sent_count integer NOT NULL DEFAULT 0,
    delivered_count integer NOT NULL DEFAULT 0,
    failed_count integer NOT NULL DEFAULT 0,
    bounced_count integer NOT NULL DEFAULT 0,
    -- Scheduling
    scheduled_at timestamptz,
    started_at timestamptz,
    completed_at timestamptz,
    -- Audit
    created_by uuid NOT NULL REFERENCES auth.users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT message_batches_pkey PRIMARY KEY (id),
    CONSTRAINT message_batches_valid_type CHECK (email_type IN ('transactional', 'marketing'))
);

-- 2.3 email_outbox: Queue voor alle uitgaande emails
-- Dit is het hart van het outbox pattern - alle emails gaan eerst hier in
CREATE TABLE IF NOT EXISTS public.email_outbox (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE RESTRICT,
    event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
    -- Idempotency key voorkomt dubbele verzending (bijv. "order:123:confirmation")
    idempotency_key text NOT NULL,
    -- Sender info
    from_name text NOT NULL,
    from_email text NOT NULL,
    reply_to text,
    -- Recipient
    to_email text NOT NULL,
    -- Content
    subject text NOT NULL,
    html_body text NOT NULL,
    text_body text,
    -- Template reference (optional)
    template_id uuid REFERENCES public.message_templates(id),
    template_variables jsonb,
    -- Scheduling & retry
    scheduled_at timestamptz NOT NULL DEFAULT now(),
    status email_status NOT NULL DEFAULT 'queued',
    attempt_count integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 3,
    last_attempt_at timestamptz,
    next_attempt_at timestamptz,
    -- Provider response
    provider_message_id text,
    error_message text,
    error_code text,
    -- Batch reference (for bulk emails)
    batch_id uuid REFERENCES public.message_batches(id),
    -- Categorization
    email_type text NOT NULL DEFAULT 'transactional',
    tags jsonb DEFAULT '[]'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    -- Timestamps
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    delivered_at timestamptz,

    CONSTRAINT email_outbox_pkey PRIMARY KEY (id),
    CONSTRAINT email_outbox_idempotency_key UNIQUE (idempotency_key),
    -- Email format validation using regex pattern
    CONSTRAINT email_outbox_valid_email CHECK (to_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    CONSTRAINT email_outbox_valid_from_email CHECK (from_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    CONSTRAINT email_outbox_attempt_count_check CHECK (attempt_count >= 0 AND attempt_count <= max_attempts),
    CONSTRAINT email_outbox_valid_email_type CHECK (email_type IN ('transactional', 'marketing', 'system'))
);

-- 2.4 email_outbox_events: Event sourcing voor alle status changes
-- Elke state transition wordt hier gelogd voor audit en debugging
CREATE TABLE IF NOT EXISTS public.email_outbox_events (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    email_id uuid NOT NULL REFERENCES public.email_outbox(id) ON DELETE CASCADE,
    event_type text NOT NULL,
    previous_status email_status,
    new_status email_status,
    -- Provider webhook data
    provider_event_id text,
    provider_timestamp timestamptz,
    -- Error info
    error_message text,
    error_code text,
    -- Extra context
    metadata jsonb DEFAULT '{}'::jsonb,
    raw_payload jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT email_outbox_events_pkey PRIMARY KEY (id),
    CONSTRAINT email_outbox_events_valid_type CHECK (
        event_type IN (
            'created', 'queued', 'processing', 'sent', 'delivered',
            'bounced', 'soft_bounced', 'complained', 'failed', 'cancelled', 'retry_scheduled'
        )
    )
);

-- 2.5 message_batch_items: Individual recipients per batch
CREATE TABLE IF NOT EXISTS public.message_batch_items (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    batch_id uuid NOT NULL REFERENCES public.message_batches(id) ON DELETE CASCADE,
    -- Link naar participant (optional - kan ook guest email zijn)
    participant_id uuid REFERENCES public.participants(id) ON DELETE SET NULL,
    email text NOT NULL,
    -- Personalisatie variabelen per recipient
    variables jsonb DEFAULT '{}'::jsonb,
    status batch_item_status NOT NULL DEFAULT 'pending',
    -- Link naar outbox record wanneer queued
    email_id uuid REFERENCES public.email_outbox(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,

    CONSTRAINT message_batch_items_pkey PRIMARY KEY (id),
    CONSTRAINT message_batch_items_valid_email CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

-- 2.6 email_unsubscribes: Unsubscribe registry per email/org/type
-- Respecteert GDPR: marketing emails alleen naar mensen die niet unsubscribed zijn
CREATE TABLE IF NOT EXISTS public.email_unsubscribes (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    email text NOT NULL,
    -- NULL org_id = global unsubscribe (alle organisaties)
    org_id uuid REFERENCES public.orgs(id) ON DELETE CASCADE,
    -- Type: 'marketing' = alleen marketing, 'all' = alle non-transactional
    email_type text NOT NULL DEFAULT 'marketing',
    -- Source tracking voor compliance
    source text NOT NULL DEFAULT 'user_request',
    reason text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT email_unsubscribes_pkey PRIMARY KEY (id),
    CONSTRAINT email_unsubscribes_valid_email CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    CONSTRAINT email_unsubscribes_valid_type CHECK (email_type IN ('marketing', 'all')),
    CONSTRAINT email_unsubscribes_valid_source CHECK (
        source IN ('user_request', 'link_click', 'admin_action', 'bounce_threshold')
    )
);

-- 2.7 email_bounces: Bounce history voor tracking en auto-unsubscribe
CREATE TABLE IF NOT EXISTS public.email_bounces (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    email text NOT NULL,
    bounce_type text NOT NULL,
    provider text NOT NULL DEFAULT 'resend',
    provider_event_id text,
    provider_timestamp timestamptz,
    -- Link naar de email die bouncede
    email_outbox_id uuid REFERENCES public.email_outbox(id) ON DELETE SET NULL,
    error_code text,
    error_message text,
    raw_payload jsonb,
    -- Org context (optional)
    org_id uuid REFERENCES public.orgs(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT email_bounces_pkey PRIMARY KEY (id),
    CONSTRAINT email_bounces_valid_type CHECK (bounce_type IN ('hard', 'soft', 'complaint'))
);

-- ========================================================
-- 3. INDEXES
-- ========================================================

-- message_templates indexes
CREATE INDEX IF NOT EXISTS idx_message_templates_org
    ON public.message_templates(org_id, is_active);

-- message_batches indexes
CREATE INDEX IF NOT EXISTS idx_message_batches_org
    ON public.message_batches(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_batches_status
    ON public.message_batches(status)
    WHERE status IN ('queued', 'processing', 'sending');

-- email_outbox indexes
-- Critical: index voor de cron job die pending emails ophaalt
CREATE INDEX IF NOT EXISTS idx_email_outbox_processing
    ON public.email_outbox(next_attempt_at, status)
    WHERE status IN ('queued', 'soft_bounced');
CREATE INDEX IF NOT EXISTS idx_email_outbox_org
    ON public.email_outbox(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_outbox_event
    ON public.email_outbox(event_id, status)
    WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_outbox_batch
    ON public.email_outbox(batch_id, status)
    WHERE batch_id IS NOT NULL;
-- Index voor webhook lookups (Resend stuurt hun message_id terug)
CREATE INDEX IF NOT EXISTS idx_email_outbox_provider_message
    ON public.email_outbox(provider_message_id)
    WHERE provider_message_id IS NOT NULL;

-- email_outbox_events indexes
CREATE INDEX IF NOT EXISTS idx_email_outbox_events_email
    ON public.email_outbox_events(email_id, created_at DESC);
-- Unique index op provider_event_id voor idempotent webhook processing
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_outbox_events_provider
    ON public.email_outbox_events(provider_event_id)
    WHERE provider_event_id IS NOT NULL;

-- message_batch_items indexes
CREATE INDEX IF NOT EXISTS idx_message_batch_items_batch
    ON public.message_batch_items(batch_id, status);
-- Voorkom dubbele recipients per batch
CREATE UNIQUE INDEX IF NOT EXISTS idx_message_batch_items_unique_recipient
    ON public.message_batch_items(batch_id, email);

-- email_unsubscribes indexes
-- Composite index voor lookup: email + org + type
-- COALESCE zorgt ervoor dat NULL org_id een unieke waarde krijgt
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_unsubscribes_lookup
    ON public.email_unsubscribes(
        email,
        COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid),
        email_type
    );

-- email_bounces indexes
CREATE INDEX IF NOT EXISTS idx_email_bounces_email
    ON public.email_bounces(email, created_at DESC);
-- Unique index voor idempotent bounce processing
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_bounces_provider_event
    ON public.email_bounces(provider_event_id)
    WHERE provider_event_id IS NOT NULL;

-- ========================================================
-- 4. ROW LEVEL SECURITY (RLS)
-- ========================================================

-- Enable RLS on all tables (CRITICAL: default deny)
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_unsubscribes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_bounces ENABLE ROW LEVEL SECURITY;

-- Drop existing policies (idempotent)
DROP POLICY IF EXISTS "Org members can view templates" ON public.message_templates;
DROP POLICY IF EXISTS "Org members can view batches" ON public.message_batches;
DROP POLICY IF EXISTS "Org members can view outbox emails" ON public.email_outbox;
DROP POLICY IF EXISTS "Access via parent email" ON public.email_outbox_events;
DROP POLICY IF EXISTS "Access via parent batch" ON public.message_batch_items;
DROP POLICY IF EXISTS "Public can check unsubscribe status" ON public.email_unsubscribes;
DROP POLICY IF EXISTS "Org members can view bounces" ON public.email_bounces;

-- message_templates: Org members kunnen templates van hun org zien
CREATE POLICY "Org members can view templates"
    ON public.message_templates FOR SELECT
    USING (public.is_org_member(org_id));

-- message_batches: Org members kunnen batches van hun org zien
CREATE POLICY "Org members can view batches"
    ON public.message_batches FOR SELECT
    USING (public.is_org_member(org_id));

-- email_outbox: Org members kunnen outbox emails van hun org zien
CREATE POLICY "Org members can view outbox emails"
    ON public.email_outbox FOR SELECT
    USING (public.is_org_member(org_id));

-- email_outbox_events: Toegang via parent email record
-- JOIN op email_outbox om org_id te checken
CREATE POLICY "Access via parent email"
    ON public.email_outbox_events FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.email_outbox e
        WHERE e.id = email_outbox_events.email_id
        AND public.is_org_member(e.org_id)
    ));

-- message_batch_items: Toegang via parent batch record
CREATE POLICY "Access via parent batch"
    ON public.message_batch_items FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.message_batches b
        WHERE b.id = message_batch_items.batch_id
        AND public.is_org_member(b.org_id)
    ));

-- email_unsubscribes: Publiek leesbaar voor compliance checks
-- Belangrijk: iedereen moet kunnen checken of een email unsubscribed is
CREATE POLICY "Public can check unsubscribe status"
    ON public.email_unsubscribes FOR SELECT
    USING (true);

-- email_bounces: Org members kunnen bounces zien, of bounces zonder org
CREATE POLICY "Org members can view bounces"
    ON public.email_bounces FOR SELECT
    USING (org_id IS NULL OR public.is_org_member(org_id));

-- ========================================================
-- 5. HELPER FUNCTIONS
-- ========================================================

-- 5.1 is_email_deliverable: Check of email verzonden mag worden
-- Returns false als:
--   - Email is globally unsubscribed
--   - Email is unsubscribed voor deze org
--   - Email heeft te veel hard bounces
CREATE OR REPLACE FUNCTION public.is_email_deliverable(
    _email text,
    _org_id uuid,
    _email_type text DEFAULT 'transactional'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
    _unsubscribed boolean;
    _hard_bounce_count integer;
    _bounce_threshold integer := 3;
BEGIN
    -- Transactional emails worden altijd verzonden (behalve bij hard bounces)
    -- Marketing emails respecteren unsubscribe status

    IF _email_type != 'transactional' THEN
        -- Check global unsubscribe (org_id IS NULL)
        SELECT EXISTS (
            SELECT 1 FROM public.email_unsubscribes
            WHERE email = _email
            AND org_id IS NULL
            AND email_type IN (_email_type, 'all')
        ) INTO _unsubscribed;

        IF _unsubscribed THEN
            RETURN false;
        END IF;

        -- Check org-specific unsubscribe
        SELECT EXISTS (
            SELECT 1 FROM public.email_unsubscribes
            WHERE email = _email
            AND org_id = _org_id
            AND email_type IN (_email_type, 'all')
        ) INTO _unsubscribed;

        IF _unsubscribed THEN
            RETURN false;
        END IF;
    END IF;

    -- Check hard bounce count (applies to ALL email types)
    SELECT COUNT(*) INTO _hard_bounce_count
    FROM public.email_bounces
    WHERE email = _email
    AND bounce_type = 'hard'
    AND created_at > now() - interval '30 days';

    IF _hard_bounce_count >= _bounce_threshold THEN
        RETURN false;
    END IF;

    RETURN true;
END;
$$;

-- 5.2 queue_email: Queue een email met validatie
-- Valideert email format, deliverability, en idempotency
CREATE OR REPLACE FUNCTION public.queue_email(
    _org_id uuid,
    _event_id uuid,
    _idempotency_key text,
    _to_email text,
    _subject text,
    _html_body text,
    _email_type text DEFAULT 'transactional',
    _from_name text DEFAULT NULL,
    _from_email text DEFAULT NULL,
    _reply_to text DEFAULT NULL,
    _text_body text DEFAULT NULL,
    _template_id uuid DEFAULT NULL,
    _template_variables jsonb DEFAULT NULL,
    _scheduled_at timestamptz DEFAULT NULL,
    _batch_id uuid DEFAULT NULL,
    _tags jsonb DEFAULT '[]'::jsonb,
    _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _email_id uuid;
    _effective_from_name text;
    _effective_from_email text;
    _effective_scheduled_at timestamptz;
BEGIN
    -- Valideer email format
    IF _to_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RAISE EXCEPTION 'Invalid email format: %', _to_email;
    END IF;

    -- Check idempotency - als email met deze key al bestaat, return die id
    SELECT id INTO _email_id
    FROM public.email_outbox
    WHERE idempotency_key = _idempotency_key;

    IF _email_id IS NOT NULL THEN
        -- Email bestaat al, return bestaande id (idempotent)
        RETURN _email_id;
    END IF;

    -- Check deliverability
    IF NOT public.is_email_deliverable(_to_email, _org_id, _email_type) THEN
        -- Log dit als een event maar create geen outbox record
        RAISE NOTICE 'Email % is not deliverable for type %', _to_email, _email_type;
        RETURN NULL;
    END IF;

    -- Set defaults
    _effective_from_name := COALESCE(_from_name, 'COLOSS');
    _effective_from_email := COALESCE(_from_email, 'noreply@coloss.nl');
    _effective_scheduled_at := COALESCE(_scheduled_at, now());

    -- Insert email
    INSERT INTO public.email_outbox (
        org_id,
        event_id,
        idempotency_key,
        from_name,
        from_email,
        reply_to,
        to_email,
        subject,
        html_body,
        text_body,
        template_id,
        template_variables,
        scheduled_at,
        next_attempt_at,
        status,
        email_type,
        batch_id,
        tags,
        metadata
    ) VALUES (
        _org_id,
        _event_id,
        _idempotency_key,
        _effective_from_name,
        _effective_from_email,
        _reply_to,
        _to_email,
        _subject,
        _html_body,
        _text_body,
        _template_id,
        _template_variables,
        _effective_scheduled_at,
        _effective_scheduled_at,
        'queued',
        _email_type,
        _batch_id,
        _tags,
        _metadata
    )
    RETURNING id INTO _email_id;

    -- Log created event
    INSERT INTO public.email_outbox_events (
        email_id,
        event_type,
        new_status,
        metadata
    ) VALUES (
        _email_id,
        'created',
        'queued',
        jsonb_build_object('source', 'queue_email')
    );

    RETURN _email_id;
END;
$$;

-- 5.3 update_email_status: Update status met event logging
-- Centraal punt voor alle status updates zodat events consistent gelogd worden
CREATE OR REPLACE FUNCTION public.update_email_status(
    _email_id uuid,
    _new_status email_status,
    _error_message text DEFAULT NULL,
    _error_code text DEFAULT NULL,
    _provider_message_id text DEFAULT NULL,
    _provider_event_id text DEFAULT NULL,
    _provider_timestamp timestamptz DEFAULT NULL,
    _raw_payload jsonb DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _old_status email_status;
    _current_attempt_count integer;
    _max_attempts integer;
    _next_attempt timestamptz;
BEGIN
    -- Get current state
    SELECT status, attempt_count, max_attempts
    INTO _old_status, _current_attempt_count, _max_attempts
    FROM public.email_outbox
    WHERE id = _email_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Email not found: %', _email_id;
    END IF;

    -- Skip if already in final state
    IF _old_status IN ('delivered', 'bounced', 'complained', 'failed', 'cancelled') THEN
        RETURN false;
    END IF;

    -- Calculate next attempt for soft bounces
    IF _new_status = 'soft_bounced' AND _current_attempt_count < _max_attempts THEN
        -- Exponential backoff: 1min, 2min, 4min, etc.
        _next_attempt := now() + (power(2, _current_attempt_count) * interval '1 minute');
    ELSE
        _next_attempt := NULL;
    END IF;

    -- Update email record
    UPDATE public.email_outbox
    SET
        status = _new_status,
        error_message = COALESCE(_error_message, error_message),
        error_code = COALESCE(_error_code, error_code),
        provider_message_id = COALESCE(_provider_message_id, provider_message_id),
        last_attempt_at = CASE WHEN _new_status IN ('processing', 'sent') THEN now() ELSE last_attempt_at END,
        next_attempt_at = _next_attempt,
        attempt_count = CASE
            WHEN _new_status = 'processing' THEN _current_attempt_count + 1
            ELSE attempt_count
        END,
        sent_at = CASE WHEN _new_status = 'sent' THEN now() ELSE sent_at END,
        delivered_at = CASE WHEN _new_status = 'delivered' THEN now() ELSE delivered_at END,
        updated_at = now()
    WHERE id = _email_id;

    -- Log event
    INSERT INTO public.email_outbox_events (
        email_id,
        event_type,
        previous_status,
        new_status,
        provider_event_id,
        provider_timestamp,
        error_message,
        error_code,
        raw_payload
    ) VALUES (
        _email_id,
        _new_status::text,
        _old_status,
        _new_status,
        _provider_event_id,
        _provider_timestamp,
        _error_message,
        _error_code,
        _raw_payload
    );

    -- Handle bounces - record in email_bounces table
    IF _new_status IN ('bounced', 'soft_bounced', 'complained') THEN
        INSERT INTO public.email_bounces (
            email,
            bounce_type,
            provider_event_id,
            provider_timestamp,
            email_outbox_id,
            error_code,
            error_message,
            raw_payload,
            org_id
        )
        SELECT
            e.to_email,
            CASE
                WHEN _new_status = 'bounced' THEN 'hard'
                WHEN _new_status = 'soft_bounced' THEN 'soft'
                ELSE 'complaint'
            END,
            _provider_event_id,
            _provider_timestamp,
            _email_id,
            _error_code,
            _error_message,
            _raw_payload,
            e.org_id
        FROM public.email_outbox e
        WHERE e.id = _email_id
        -- Idempotent: skip als provider_event_id al bestaat
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN true;
END;
$$;

-- ========================================================
-- 6. TRIGGERS
-- ========================================================

-- 6.1 Automatic updated_at for email_outbox
CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- Drop triggers if they exist (idempotent)
DROP TRIGGER IF EXISTS email_outbox_updated_at ON public.email_outbox;
DROP TRIGGER IF EXISTS message_templates_updated_at ON public.message_templates;
DROP TRIGGER IF EXISTS message_batches_updated_at ON public.message_batches;

-- Create triggers
CREATE TRIGGER email_outbox_updated_at
    BEFORE UPDATE ON public.email_outbox
    FOR EACH ROW
    EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER message_templates_updated_at
    BEFORE UPDATE ON public.message_templates
    FOR EACH ROW
    EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER message_batches_updated_at
    BEFORE UPDATE ON public.message_batches
    FOR EACH ROW
    EXECUTE FUNCTION public.trigger_set_updated_at();

-- ========================================================
-- 7. COMMENTS
-- ========================================================

COMMENT ON TABLE public.email_outbox IS 'Queue voor alle uitgaande emails - hart van het outbox pattern';
COMMENT ON TABLE public.email_outbox_events IS 'Event sourcing voor email status changes - audit trail';
COMMENT ON TABLE public.message_batches IS 'Bulk email job tracking met progress monitoring';
COMMENT ON TABLE public.message_batch_items IS 'Individual recipients per bulk email batch';
COMMENT ON TABLE public.email_unsubscribes IS 'Unsubscribe registry - GDPR compliance';
COMMENT ON TABLE public.email_bounces IS 'Bounce history voor auto-unsubscribe en deliverability tracking';
COMMENT ON TABLE public.message_templates IS 'Reusable email templates met i18n support';

COMMENT ON FUNCTION public.queue_email IS 'Queue een email met validatie, deliverability check, en idempotency';
COMMENT ON FUNCTION public.is_email_deliverable IS 'Check of email verzonden mag worden (unsubscribe, bounces)';
COMMENT ON FUNCTION public.update_email_status IS 'Update email status met automatic event logging en bounce recording';

-- End of migration
