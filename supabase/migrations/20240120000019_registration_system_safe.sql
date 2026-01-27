-- SPRINT 5: REGISTRATION SYSTEM (SAFE MIGRATION)
-- Migration: 20240120000018_registration_system.sql

-- ========================================================
-- PREFLIGHT CHECK: Ensure no data loss
-- ========================================================
DO $$
DECLARE
    v_answer_count integer;
BEGIN
    SELECT count(*) INTO v_answer_count 
    FROM public.registration_answers;
    
    IF v_answer_count > 0 THEN
        RAISE EXCEPTION 
            'MIGRATION ABORTED: registration_answers contains % rows. Manual data migration required. See migration file for strategy.',
            v_answer_count
            USING ERRCODE = '55000'; -- object_not_in_prerequisite_state
    END IF;
END $$;

-- ========================================================
-- 1. ENUMS
-- ========================================================
ALTER TYPE public.registration_status ADD VALUE IF NOT EXISTS 'draft';
ALTER TYPE public.registration_status ADD VALUE IF NOT EXISTS 'pending_payment';
ALTER TYPE public.registration_status ADD VALUE IF NOT EXISTS 'transferred';

DO $$ BEGIN
    CREATE TYPE public.question_type AS ENUM (
        'text', 'textarea', 'number', 'select', 'checkbox', 'date', 'file'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE public.gender_type AS ENUM ('M', 'F', 'X', 'O');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ========================================================
-- 2. PARTICIPANTS (Update existing table)
-- ========================================================
ALTER TABLE public.participants 
    ADD COLUMN IF NOT EXISTS birth_date date,
    ADD COLUMN IF NOT EXISTS gender public.gender_type,
    ADD COLUMN IF NOT EXISTS phone text,
    ADD COLUMN IF NOT EXISTS address text,
    ADD COLUMN IF NOT EXISTS city text,
    ADD COLUMN IF NOT EXISTS country text DEFAULT 'NL',
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- ========================================================
-- 3. REGISTRATIONS (Update existing table)
-- ========================================================
ALTER TABLE public.registrations
    ADD COLUMN IF NOT EXISTS ticket_type_id uuid REFERENCES public.ticket_types(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS bib_number text,
    ADD COLUMN IF NOT EXISTS start_wave text,
    ADD COLUMN IF NOT EXISTS order_item_id uuid REFERENCES public.order_items(id),
    ADD COLUMN IF NOT EXISTS ticket_instance_id uuid REFERENCES public.ticket_instances(id),
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Drop old unique constraint
ALTER TABLE public.registrations DROP CONSTRAINT IF EXISTS registrations_event_participant_unique;

-- New unique constraint with soft delete support
CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_unique_participant 
    ON public.registrations(event_id, participant_id, ticket_type_id) 
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_registrations_event_status ON public.registrations(event_id, status);

-- ========================================================
-- 4. REGISTRATION QUESTIONS (New Table)
-- ========================================================
CREATE TABLE IF NOT EXISTS public.registration_questions (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    ticket_type_id uuid REFERENCES public.ticket_types(id) ON DELETE CASCADE,
    
    question_type public.question_type NOT NULL,
    label text NOT NULL,
    description text,
    options jsonb,
    
    is_required boolean NOT NULL DEFAULT false,
    is_medical boolean NOT NULL DEFAULT false,
    sort_order integer NOT NULL DEFAULT 0,
    
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT registration_questions_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_questions_event ON public.registration_questions(event_id, sort_order);

-- ========================================================
-- 5. REGISTRATION ANSWERS (Safe recreation)
-- ========================================================
-- Drop old table (preflight check ensures it's empty)
DROP TABLE IF EXISTS public.registration_answers CASCADE;

-- Create new schema
CREATE TABLE public.registration_answers (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    registration_id uuid NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
    question_id uuid NOT NULL REFERENCES public.registration_questions(id) ON DELETE RESTRICT,
    
    answer_value jsonb NOT NULL,
    
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT registration_answers_pkey PRIMARY KEY (id),
    CONSTRAINT answers_unique_per_registration UNIQUE (registration_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_answers_registration ON public.registration_answers(registration_id);

-- ========================================================
-- 6. APPEND-ONLY ENFORCEMENT
-- ========================================================
CREATE OR REPLACE FUNCTION public.prevent_answer_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'UPDATE') THEN
        RAISE EXCEPTION 'Answers are immutable (UPDATE blocked)'
            USING ERRCODE = '42501'; -- insufficient_privilege
    END IF;
    
    IF (TG_OP = 'DELETE') THEN
        RAISE EXCEPTION 'Answers are immutable (DELETE blocked)'
            USING ERRCODE = '42501';
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_answer_immutability ON public.registration_answers;
CREATE TRIGGER enforce_answer_immutability
    BEFORE UPDATE OR DELETE ON public.registration_answers
    FOR EACH ROW EXECUTE FUNCTION public.prevent_answer_mutation();

-- ========================================================
-- 7. RLS POLICIES
-- ========================================================
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_answers ENABLE ROW LEVEL SECURITY;

-- PARTICIPANTS
DROP POLICY IF EXISTS "Users can view own participant profile" ON public.participants;
DROP POLICY IF EXISTS "Users can update own participant profile" ON public.participants;
DROP POLICY IF EXISTS "Org members can view participants of their events" ON public.participants;
DROP POLICY IF EXISTS "Public can create participants" ON public.participants;
DROP POLICY IF EXISTS "Users manage own participants" ON public.participants;
DROP POLICY IF EXISTS "Orgs view event participants" ON public.participants;

CREATE POLICY "Users manage own participants" ON public.participants
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Orgs view event participants" ON public.participants
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.registrations r
            JOIN public.events e ON r.event_id = e.id
            WHERE r.participant_id = participants.id
            AND public.is_org_member(e.org_id)
        )
    );

-- REGISTRATIONS
DROP POLICY IF EXISTS "Users can view own registrations" ON public.registrations;
DROP POLICY IF EXISTS "Org members can view event registrations" ON public.registrations;
DROP POLICY IF EXISTS "Public can create registrations" ON public.registrations;
DROP POLICY IF EXISTS "Orgs manage event registrations" ON public.registrations;
DROP POLICY IF EXISTS "Users view own registrations" ON public.registrations; -- Added: from migration 18
DROP POLICY IF EXISTS "Users insert own answers" ON public.registration_answers; -- Added: clean up

CREATE POLICY "Users view own registrations" ON public.registrations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.participants p
            WHERE p.id = registrations.participant_id
            AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Orgs manage event registrations" ON public.registrations
    USING (
        EXISTS (
            SELECT 1 FROM public.events e
            WHERE e.id = registrations.event_id
            AND public.is_org_member(e.org_id)
        )
    );

-- REGISTRATION QUESTIONS
DROP POLICY IF EXISTS "Public can view questions" ON public.registration_questions;
DROP POLICY IF EXISTS "Orgs manage questions" ON public.registration_questions;

CREATE POLICY "Public can view questions" ON public.registration_questions
    FOR SELECT USING (true);

CREATE POLICY "Orgs manage questions" ON public.registration_questions
    USING (
        EXISTS (
            SELECT 1 FROM public.events e
            WHERE e.id = registration_questions.event_id
            AND public.is_org_member(e.org_id)
        )
    );

-- REGISTRATION ANSWERS (Append-only via RLS too)
DROP POLICY IF EXISTS "Users can view own answers" ON public.registration_answers;
DROP POLICY IF EXISTS "Org members can view answers" ON public.registration_answers;
DROP POLICY IF EXISTS "Public can create answers" ON public.registration_answers;
DROP POLICY IF EXISTS "Users view own answers" ON public.registration_answers;
DROP POLICY IF EXISTS "Orgs view answers with privacy" ON public.registration_answers;
DROP POLICY IF EXISTS "Users insert own answers" ON public.registration_answers;

-- Users view own
CREATE POLICY "Users view own answers" ON public.registration_answers
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.registrations r
            JOIN public.participants p ON r.participant_id = p.id
            WHERE r.id = registration_answers.registration_id
            AND p.user_id = auth.uid()
        )
    );

-- Users insert own (during checkout)
CREATE POLICY "Users insert own answers" ON public.registration_answers
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.registrations r
            JOIN public.participants p ON r.participant_id = p.id
            WHERE r.id = registration_answers.registration_id
            AND p.user_id = auth.uid()
        )
    );

-- Orgs view with medical data privacy
CREATE POLICY "Orgs view answers with privacy" ON public.registration_answers
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.registrations r
            JOIN public.events e ON r.event_id = e.id
            JOIN public.org_members om ON om.org_id = e.org_id
            JOIN public.registration_questions q ON q.id = registration_answers.question_id
            WHERE r.id = registration_answers.registration_id
            AND om.user_id = auth.uid()
            AND (
                om.role IN ('owner', 'admin', 'support')
                OR 
                (om.role = 'finance' AND q.is_medical = false)
            )
        )
    );

-- NO UPDATE/DELETE POLICIES (Enforced by trigger + empty policy set)

-- ========================================================
-- 8. AUDIT TRIGGER
-- ========================================================
CREATE OR REPLACE FUNCTION public.audit_registration_change()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'UPDATE' AND OLD.status != NEW.status) THEN
        INSERT INTO public.audit_log (
            org_id,
            actor_user_id,
            action,
            entity_type,
            entity_id,
            before_state,
            after_state,
            metadata
        )
        SELECT 
            e.org_id,
            auth.uid(),
            'REGISTRATION_STATUS_CHANGED',
            'registration',
            NEW.id,
            jsonb_build_object('status', OLD.status),
            jsonb_build_object('status', NEW.status),
            jsonb_build_object('event_id', NEW.event_id)
        FROM public.events e WHERE e.id = NEW.event_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS audit_registration_status ON public.registrations;
CREATE TRIGGER audit_registration_status
    AFTER UPDATE ON public.registrations
    FOR EACH ROW EXECUTE FUNCTION public.audit_registration_change();

-- ========================================================
-- 9. UPDATED_AT TRIGGER
-- ========================================================
DROP TRIGGER IF EXISTS handle_updated_at_registration_answers ON public.registration_answers;
CREATE TRIGGER handle_updated_at_registration_answers 
    BEFORE UPDATE ON public.registration_answers
    FOR EACH ROW EXECUTE PROCEDURE extensions.moddatetime(updated_at);

COMMENT ON TABLE public.registration_questions IS 'Dynamic questions configuration per event/ticket';
COMMENT ON TABLE public.registration_answers IS 'Answers to dynamic questions. APPEND-ONLY (UPDATE/DELETE blocked by trigger). Medical data protected via RLS.';
