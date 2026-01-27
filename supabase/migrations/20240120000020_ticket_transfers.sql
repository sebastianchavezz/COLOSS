-- SPRINT 6: TICKET TRANSFERS
-- Migration: 20240120000020_ticket_transfers.sql

-- ========================================================
-- 1. ENUM for Transfer Status
-- ========================================================
DO $$ BEGIN
    CREATE TYPE public.transfer_status AS ENUM (
        'pending',      -- Awaiting acceptance
        'accepted',     -- Transfer completed
        'expired',      -- Expired (time-based)
        'cancelled'     -- Cancelled by sender
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ========================================================
-- 2. TICKET_TRANSFERS Table
-- ========================================================
CREATE TABLE IF NOT EXISTS public.ticket_transfers (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    
    -- What is being transferred
    ticket_instance_id uuid NOT NULL REFERENCES public.ticket_instances(id) ON DELETE RESTRICT,
    
    -- From whom (current owner)
    from_participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE RESTRICT,
    
    -- To whom (can be known participant or email for unknown recipient)
    to_participant_id uuid REFERENCES public.participants(id) ON DELETE RESTRICT,
    to_email text, -- For recipients not yet in system
    
    -- Security
    transfer_token_hash text NOT NULL UNIQUE, -- SHA-256 of one-time token
    
    -- State machine
    status public.transfer_status NOT NULL DEFAULT 'pending',
    
    -- Timestamps
    initiated_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL, -- Configurable window (e.g. 7 days)
    accepted_at timestamptz,
    cancelled_at timestamptz,
    
    -- Multi-tenant context (denormalized for RLS performance)
    org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE RESTRICT,
    event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
    
    -- Metadata
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    
    CONSTRAINT ticket_transfers_pkey PRIMARY KEY (id),
    
    -- Business Rules
    CONSTRAINT transfer_expires_after_initiated CHECK (expires_at > initiated_at),
    CONSTRAINT transfer_recipient_required CHECK (
        to_participant_id IS NOT NULL OR to_email IS NOT NULL
    )
);

-- ========================================================
-- 3. Indexes
-- ========================================================

-- Idempotency: Only one pending transfer per ticket (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_transfers_unique_pending
    ON public.ticket_transfers(ticket_instance_id)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_transfers_ticket ON public.ticket_transfers(ticket_instance_id, status);
CREATE INDEX IF NOT EXISTS idx_transfers_from ON public.ticket_transfers(from_participant_id, status);
CREATE INDEX IF NOT EXISTS idx_transfers_to_participant ON public.ticket_transfers(to_participant_id, status);
CREATE INDEX IF NOT EXISTS idx_transfers_to_email ON public.ticket_transfers(to_email, status);
CREATE INDEX IF NOT EXISTS idx_transfers_org_event ON public.ticket_transfers(org_id, event_id, status);
CREATE INDEX IF NOT EXISTS idx_transfers_expires ON public.ticket_transfers(expires_at) WHERE status = 'pending';

-- ========================================================
-- 4. State Transition Trigger (Validation)
-- ========================================================
CREATE OR REPLACE FUNCTION public.validate_transfer_state_transition()
RETURNS TRIGGER AS $$
BEGIN
    -- Prevent modification of completed transfers
    IF (TG_OP = 'UPDATE' AND OLD.status IN ('accepted', 'expired', 'cancelled')) THEN
        IF NEW.status != OLD.status THEN
            RAISE EXCEPTION 'Cannot change status of completed transfer (current: %, attempted: %)', 
                OLD.status, NEW.status
                USING ERRCODE = '23514'; -- check_violation
        END IF;
    END IF;
    
    -- Validate status transitions
    IF (TG_OP = 'UPDATE' AND OLD.status != NEW.status) THEN
        -- pending → accepted|expired|cancelled (valid)
        -- Any other transition is invalid
        IF OLD.status = 'pending' THEN
            IF NEW.status NOT IN ('accepted', 'expired', 'cancelled') THEN
                RAISE EXCEPTION 'Invalid status transition: % → %', OLD.status, NEW.status
                    USING ERRCODE = '23514';
            END IF;
        ELSE
            RAISE EXCEPTION 'Invalid status transition: % → %', OLD.status, NEW.status
                USING ERRCODE = '23514';
        END IF;
    END IF;
    
    -- Set timestamp on status change
    IF (TG_OP = 'UPDATE' AND OLD.status != NEW.status) THEN
        IF NEW.status = 'accepted' THEN
            NEW.accepted_at := now();
        ELSIF NEW.status = 'cancelled' THEN
            NEW.cancelled_at := now();
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_transfer_state ON public.ticket_transfers;
CREATE TRIGGER validate_transfer_state
    BEFORE UPDATE ON public.ticket_transfers
    FOR EACH ROW EXECUTE FUNCTION public.validate_transfer_state_transition();

-- ========================================================
-- 5. Audit Trigger
-- ========================================================
CREATE OR REPLACE FUNCTION public.audit_transfer_change()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        INSERT INTO public.audit_log (
            org_id,
            actor_user_id,
            action,
            entity_type,
            entity_id,
            after_state,
            metadata
        ) VALUES (
            NEW.org_id,
            auth.uid(),
            'TRANSFER_INITIATED',
            'ticket_transfer',
            NEW.id,
            jsonb_build_object('status', NEW.status),
            jsonb_build_object(
                'ticket_instance_id', NEW.ticket_instance_id,
                'to_email', NEW.to_email,
                'expires_at', NEW.expires_at
            )
        );
    ELSIF (TG_OP = 'UPDATE' AND OLD.status != NEW.status) THEN
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
            CASE 
                WHEN NEW.status = 'accepted' THEN 'TRANSFER_ACCEPTED'
                WHEN NEW.status = 'cancelled' THEN 'TRANSFER_CANCELLED'
                WHEN NEW.status = 'expired' THEN 'TRANSFER_EXPIRED'
                ELSE 'TRANSFER_STATUS_CHANGED'
            END,
            'ticket_transfer',
            NEW.id,
            jsonb_build_object('status', OLD.status),
            jsonb_build_object('status', NEW.status),
            jsonb_build_object(
                'ticket_instance_id', NEW.ticket_instance_id
            )
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS audit_transfer_changes ON public.ticket_transfers;
CREATE TRIGGER audit_transfer_changes
    AFTER INSERT OR UPDATE ON public.ticket_transfers
    FOR EACH ROW EXECUTE FUNCTION public.audit_transfer_change();

-- ========================================================
-- 6. RLS Policies
-- ========================================================
ALTER TABLE public.ticket_transfers ENABLE ROW LEVEL SECURITY;

-- Sender can view their own transfers
CREATE POLICY "Senders view own transfers" ON public.ticket_transfers
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.participants p
            WHERE p.id = ticket_transfers.from_participant_id
            AND p.user_id = auth.uid()
        )
    );

-- Recipient (by participant) can view transfers to them
CREATE POLICY "Recipients view transfers to them" ON public.ticket_transfers
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.participants p
            WHERE p.id = ticket_transfers.to_participant_id
            AND p.user_id = auth.uid()
        )
    );

-- Org members can view transfers for their events
CREATE POLICY "Org members view event transfers" ON public.ticket_transfers
    FOR SELECT USING (
        public.is_org_member(org_id)
    );

-- No INSERT/UPDATE/DELETE policies for users (only via Edge Functions with service role)

-- ========================================================
-- 7. Updated_at Trigger
-- ========================================================
DROP TRIGGER IF EXISTS handle_updated_at_ticket_transfers ON public.ticket_transfers;
CREATE TRIGGER handle_updated_at_ticket_transfers 
    BEFORE UPDATE ON public.ticket_transfers
    FOR EACH ROW EXECUTE PROCEDURE extensions.moddatetime(updated_at);

COMMENT ON TABLE public.ticket_transfers IS 
    'Ticket transfer requests. Exactly-once acceptance via token. Auditable state machine.';
COMMENT ON INDEX public.idx_transfers_unique_pending IS
    'Idempotency: Only one pending transfer per ticket at a time';
