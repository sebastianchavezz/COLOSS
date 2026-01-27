-- Migration: 20240121000014_sprint13_observability.sql
-- Description: Sprint 13 - Observability (Lightweight Enforcement Logging)
-- Creates minimal logging for enforcement decisions
-- NO happy-path logs, NO PII, ONLY when something is blocked/mutated

-- ========================================================
-- 1. SETTINGS ENFORCEMENT LOG TABLE
-- ========================================================
-- Purpose: Track when settings enforcement blocks/mutates actions
-- NOT for general audit, ONLY for enforcement reasoning

CREATE TABLE public.settings_enforcement_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    domain text NOT NULL, -- 'governance', 'ticket_pdf', 'ticket_privacy', 'waitlist', 'interest_list'
    reason text NOT NULL, -- Human-readable explanation
    actor text NOT NULL, -- 'anon' | 'user' | 'system'
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for querying by event and domain
CREATE INDEX idx_settings_enforcement_log_event_id ON public.settings_enforcement_log(event_id);
CREATE INDEX idx_settings_enforcement_log_domain ON public.settings_enforcement_log(domain);
CREATE INDEX idx_settings_enforcement_log_created_at ON public.settings_enforcement_log(created_at DESC);

COMMENT ON TABLE public.settings_enforcement_log IS 
'Logs when settings enforcement blocks or mutates an action. Append-only. No PII.';

-- ========================================================
-- 2. RLS: Backend-only access
-- ========================================================
ALTER TABLE public.settings_enforcement_log ENABLE ROW LEVEL SECURITY;

-- Org members can view logs for their events
CREATE POLICY "Org members can view enforcement logs"
    ON public.settings_enforcement_log
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.events e
            WHERE e.id = settings_enforcement_log.event_id
            AND public.is_org_member(e.org_id)
        )
    );

-- No insert policy (only service_role/backend can insert)
-- No update/delete policy (append-only)

-- ========================================================
-- 3. HELPER FUNCTION: log_enforcement
-- ========================================================
-- Purpose: Centralized enforcement logging
-- Usage: SELECT log_enforcement(event_id, 'governance', 'Private event blocked', 'anon');

CREATE OR REPLACE FUNCTION public.log_enforcement(
    _event_id uuid,
    _domain text,
    _reason text,
    _actor text DEFAULT 'system'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Validate actor
    IF _actor NOT IN ('anon', 'user', 'system') THEN
        RAISE EXCEPTION 'Invalid actor: %. Must be anon, user, or system.', _actor;
    END IF;
    
    -- Validate domain
    IF _domain NOT IN ('governance', 'ticket_pdf', 'ticket_privacy', 'waitlist', 'interest_list', 'capacity') THEN
        RAISE EXCEPTION 'Invalid domain: %.', _domain;
    END IF;
    
    -- Insert log (append-only)
    INSERT INTO public.settings_enforcement_log (event_id, domain, reason, actor)
    VALUES (_event_id, _domain, _reason, _actor);
END;
$$;

COMMENT ON FUNCTION public.log_enforcement IS 
'Logs an enforcement decision. Only call when blocking/mutating due to settings.';

-- ========================================================
-- 4. TRIGGER: Prevent updates/deletes (append-only)
-- ========================================================
CREATE OR REPLACE FUNCTION public.prevent_enforcement_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'settings_enforcement_log is append-only. Updates and deletes are not allowed.';
END;
$$;

CREATE TRIGGER prevent_enforcement_log_update
    BEFORE UPDATE ON public.settings_enforcement_log
    FOR EACH ROW EXECUTE FUNCTION public.prevent_enforcement_log_mutation();

CREATE TRIGGER prevent_enforcement_log_delete
    BEFORE DELETE ON public.settings_enforcement_log
    FOR EACH ROW EXECUTE FUNCTION public.prevent_enforcement_log_mutation();
