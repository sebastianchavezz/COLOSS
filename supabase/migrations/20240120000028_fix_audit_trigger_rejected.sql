-- Migration: 20240120000028_fix_audit_trigger_rejected.sql
-- Fix: Remove 'rejected' case from audit_transfer_change (not in enum)

CREATE OR REPLACE FUNCTION public.audit_transfer_change()
RETURNS TRIGGER AS $$
DECLARE
    _actor_id uuid;
    _action text;
BEGIN
    -- Determine actor
    IF (TG_OP = 'INSERT') THEN
        _actor_id := COALESCE(NEW.initiated_by_user_id, auth.uid());
        _action := 'TRANSFER_INITIATED';
    ELSIF (TG_OP = 'UPDATE' AND OLD.status != NEW.status) THEN
        -- Determine actor and action based on new status
        CASE NEW.status
            WHEN 'accepted' THEN
                _actor_id := COALESCE(NEW.accepted_by_user_id, auth.uid());
                _action := 'TRANSFER_ACCEPTED';
            WHEN 'cancelled' THEN
                _actor_id := COALESCE(NEW.cancelled_by_user_id, auth.uid());
                _action := 'TRANSFER_CANCELLED';
            WHEN 'expired' THEN
                _actor_id := auth.uid();
                _action := 'TRANSFER_EXPIRED';
            ELSE
                _actor_id := auth.uid();
                _action := 'TRANSFER_STATUS_CHANGED';
        END CASE;
    ELSE
        -- No status change on UPDATE, skip audit
        RETURN NEW;
    END IF;

    -- Insert audit log
    INSERT INTO public.audit_log (
        org_id,
        actor_user_id,
        action,
        resource_type,
        resource_id,
        entity_type,
        entity_id,
        before_state,
        after_state,
        metadata
    ) VALUES (
        NEW.org_id,
        _actor_id,
        _action,
        'event',
        NEW.event_id,
        'ticket_transfer',
        NEW.id,
        CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('status', OLD.status) ELSE NULL END,
        jsonb_build_object('status', NEW.status),
        jsonb_build_object(
            'ticket_instance_id', NEW.ticket_instance_id,
            'to_email', NEW.to_email,
            'cancelled_at', NEW.cancelled_at,
            'cancelled_by_user_id', NEW.cancelled_by_user_id
        )
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
