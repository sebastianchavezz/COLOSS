-- ===========================================================================
-- F018: Waitlist Management (Wachtlijst Management)
-- ===========================================================================
-- Intent: Implement comprehensive waitlist system for sold-out events
--
-- Features:
-- 1. Join waitlist when ticket types are sold out
-- 2. FIFO queue with position tracking
-- 3. Automatic notification when spots become available
-- 4. Time-limited offers (24h to claim)
-- 5. Automatic processing on cancellations/refunds
-- 6. Organizer admin interface
--
-- Dependencies:
-- - event_settings with 'waitlist' domain (already exists from sprint 4)
-- - email_outbox table for notifications (F008)
-- - orders/order_items tables for capacity tracking
-- ===========================================================================

-- ===========================================================================
-- STEP 1: CREATE waitlist_entries TABLE
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.waitlist_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    ticket_type_id UUID REFERENCES public.ticket_types(id) ON DELETE CASCADE,

    -- Contact info
    email TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    full_name TEXT,

    -- Queue management
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1 AND quantity <= 10),
    position INTEGER NOT NULL, -- FIFO position, auto-assigned

    -- Status tracking
    status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN (
        'waiting',   -- In queue, waiting for spot
        'notified',  -- Spot available, email sent
        'offered',   -- Formal offer made, deadline set
        'converted', -- Successfully purchased
        'expired',   -- Offer deadline passed
        'cancelled'  -- User cancelled or removed by organizer
    )),

    -- Notification tracking
    notified_at TIMESTAMPTZ,
    offer_expires_at TIMESTAMPTZ,

    -- Conversion tracking
    converted_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,

    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent duplicate active entries per email/event/ticket_type
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_active_unique
    ON public.waitlist_entries(event_id, ticket_type_id, email)
    WHERE status IN ('waiting', 'notified', 'offered');

-- Prevent duplicate active entries with NULL ticket_type (any ticket)
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_active_unique_any_ticket
    ON public.waitlist_entries(event_id, email)
    WHERE status IN ('waiting', 'notified', 'offered') AND ticket_type_id IS NULL;

-- ===========================================================================
-- STEP 2: CREATE INDEXES
-- ===========================================================================

CREATE INDEX IF NOT EXISTS idx_waitlist_event_id
    ON public.waitlist_entries(event_id);

CREATE INDEX IF NOT EXISTS idx_waitlist_ticket_type
    ON public.waitlist_entries(ticket_type_id)
    WHERE ticket_type_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_waitlist_email
    ON public.waitlist_entries(email);

CREATE INDEX IF NOT EXISTS idx_waitlist_user_id
    ON public.waitlist_entries(user_id)
    WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_waitlist_status
    ON public.waitlist_entries(event_id, status)
    WHERE status = 'waiting';

CREATE INDEX IF NOT EXISTS idx_waitlist_position
    ON public.waitlist_entries(event_id, ticket_type_id, position)
    WHERE status = 'waiting';

CREATE INDEX IF NOT EXISTS idx_waitlist_offers_expiry
    ON public.waitlist_entries(offer_expires_at)
    WHERE status = 'offered' AND offer_expires_at IS NOT NULL;

-- ===========================================================================
-- STEP 3: ENABLE RLS
-- ===========================================================================

ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- STEP 4: RLS POLICIES
-- ===========================================================================

-- SELECT: Users can see their own entries, org members can see all for their events
CREATE POLICY waitlist_entries_select ON public.waitlist_entries
    FOR SELECT
    USING (
        -- Own entries (by user_id)
        (auth.uid() IS NOT NULL AND user_id = auth.uid())
        OR
        -- Own entries (by email)
        (email = (SELECT email FROM auth.users WHERE id = auth.uid()))
        OR
        -- Org members can see all entries for their events
        (EXISTS (
            SELECT 1 FROM public.events e
            INNER JOIN public.org_members om ON om.org_id = e.org_id
            WHERE e.id = waitlist_entries.event_id
            AND om.user_id = auth.uid()
        ))
    );

-- INSERT: Anyone can join waitlist (public), validated by RPC
CREATE POLICY waitlist_entries_insert ON public.waitlist_entries
    FOR INSERT
    WITH CHECK (true); -- RPC will validate

-- UPDATE: Only via SECURITY DEFINER RPCs
CREATE POLICY waitlist_entries_update ON public.waitlist_entries
    FOR UPDATE
    USING (false); -- Block direct updates

-- DELETE: Users can cancel own entries, org members can manage
CREATE POLICY waitlist_entries_delete ON public.waitlist_entries
    FOR DELETE
    USING (
        -- Own entries
        (auth.uid() IS NOT NULL AND user_id = auth.uid())
        OR
        (email = (SELECT email FROM auth.users WHERE id = auth.uid()))
        OR
        -- Org members can delete entries for their events
        (EXISTS (
            SELECT 1 FROM public.events e
            INNER JOIN public.org_members om ON om.org_id = e.org_id
            WHERE e.id = waitlist_entries.event_id
            AND om.user_id = auth.uid()
            AND om.role IN ('owner', 'admin')
        ))
    );

-- ===========================================================================
-- STEP 5: UPDATED_AT TRIGGER
-- ===========================================================================

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON public.waitlist_entries
    FOR EACH ROW
    EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ===========================================================================
-- STEP 6: HELPER FUNCTION - get_next_waitlist_position
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.get_next_waitlist_position(
    _event_id UUID,
    _ticket_type_id UUID
)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(MAX(position), 0) + 1
    FROM public.waitlist_entries
    WHERE event_id = _event_id
    AND (
        (_ticket_type_id IS NULL AND ticket_type_id IS NULL)
        OR
        (_ticket_type_id IS NOT NULL AND ticket_type_id = _ticket_type_id)
    );
$$;

COMMENT ON FUNCTION public.get_next_waitlist_position IS
'Returns the next available position in the waitlist queue for a given event and ticket type';

-- ===========================================================================
-- STEP 7: RPC - join_waitlist
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.join_waitlist(
    _event_id UUID,
    _ticket_type_id UUID,
    _email TEXT,
    _full_name TEXT DEFAULT NULL,
    _quantity INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event events;
    v_ticket_type ticket_types;
    v_waitlist_enabled BOOLEAN;
    v_is_sold_out BOOLEAN;
    v_sold_count INTEGER;
    v_next_position INTEGER;
    v_entry_id UUID;
    v_user_id UUID;
    v_estimated_wait TEXT;
BEGIN
    -- Normalize email
    _email := lower(trim(_email));

    -- Get authenticated user if any
    v_user_id := auth.uid();

    -- ========================================
    -- VALIDATION: Event exists and is published
    -- ========================================
    SELECT * INTO v_event
    FROM events
    WHERE id = _event_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'EVENT_NOT_FOUND',
            'message', 'Dit evenement bestaat niet of is verwijderd'
        );
    END IF;

    IF v_event.status != 'published' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'EVENT_NOT_PUBLISHED',
            'message', 'Je kunt je nog niet inschrijven voor de wachtlijst. Evenement is niet gepubliceerd.'
        );
    END IF;

    -- ========================================
    -- VALIDATION: Waitlist enabled
    -- ========================================
    SELECT COALESCE(
        (get_event_config(_event_id)->'waitlist'->>'enabled')::boolean,
        false
    ) INTO v_waitlist_enabled;

    IF NOT v_waitlist_enabled THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'WAITLIST_DISABLED',
            'message', 'De wachtlijst is niet actief voor dit evenement'
        );
    END IF;

    -- ========================================
    -- VALIDATION: Ticket type exists (if specified)
    -- ========================================
    IF _ticket_type_id IS NOT NULL THEN
        SELECT * INTO v_ticket_type
        FROM ticket_types
        WHERE id = _ticket_type_id AND event_id = _event_id;

        IF NOT FOUND THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'TICKET_TYPE_NOT_FOUND',
                'message', 'Dit tickettype bestaat niet'
            );
        END IF;

        -- Check if ticket type is actually sold out
        SELECT COUNT(*) INTO v_sold_count
        FROM ticket_instances
        WHERE ticket_type_id = _ticket_type_id;

        v_is_sold_out := (v_ticket_type.capacity_total IS NOT NULL
                         AND v_sold_count >= v_ticket_type.capacity_total);

        IF NOT v_is_sold_out THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'TICKET_NOT_SOLD_OUT',
                'message', format(
                    'Er zijn nog tickets beschikbaar! Ga naar de checkout om %s te kopen.',
                    v_ticket_type.name
                )
            );
        END IF;
    END IF;

    -- ========================================
    -- VALIDATION: Check for duplicate active entry
    -- ========================================
    IF EXISTS (
        SELECT 1 FROM waitlist_entries
        WHERE event_id = _event_id
        AND email = _email
        AND (_ticket_type_id IS NULL AND ticket_type_id IS NULL
             OR ticket_type_id = _ticket_type_id)
        AND status IN ('waiting', 'notified', 'offered')
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'ALREADY_ON_WAITLIST',
            'message', 'Je staat al op de wachtlijst voor dit ticket'
        );
    END IF;

    -- ========================================
    -- VALIDATION: Quantity
    -- ========================================
    IF _quantity < 1 OR _quantity > 10 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'INVALID_QUANTITY',
            'message', 'Je kunt tussen de 1 en 10 tickets aanvragen'
        );
    END IF;

    -- ========================================
    -- CREATE ENTRY
    -- ========================================
    v_next_position := get_next_waitlist_position(_event_id, _ticket_type_id);

    INSERT INTO waitlist_entries (
        event_id,
        ticket_type_id,
        email,
        user_id,
        full_name,
        quantity,
        position,
        status
    ) VALUES (
        _event_id,
        _ticket_type_id,
        _email,
        v_user_id,
        _full_name,
        _quantity,
        v_next_position,
        'waiting'
    )
    RETURNING id INTO v_entry_id;

    -- ========================================
    -- ESTIMATE WAIT
    -- ========================================
    -- Simple estimate: how many people ahead
    IF v_next_position <= 1 THEN
        v_estimated_wait := 'Je bent de eerste op de wachtlijst!';
    ELSIF v_next_position <= 5 THEN
        v_estimated_wait := format('Er staan ~%s personen voor je', v_next_position - 1);
    ELSIF v_next_position <= 20 THEN
        v_estimated_wait := format('Er staan ~%s personen voor je', v_next_position - 1);
    ELSE
        v_estimated_wait := format('Er staan meer dan %s personen voor je', v_next_position - 1);
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'entry_id', v_entry_id,
        'position', v_next_position,
        'estimated_wait', v_estimated_wait,
        'message', format(
            'Je staat nu op positie %s van de wachtlijst. We sturen je een email zodra er een plek vrijkomt.',
            v_next_position
        )
    );
END;
$$;

COMMENT ON FUNCTION public.join_waitlist IS
'Public function to join waitlist for a sold-out event/ticket. Validates event, waitlist settings, and sold-out status.';

-- ===========================================================================
-- STEP 8: RPC - get_waitlist_position
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.get_waitlist_position(
    _entry_id UUID,
    _email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_entry waitlist_entries;
    v_current_position INTEGER;
BEGIN
    -- Get entry and validate email
    SELECT * INTO v_entry
    FROM waitlist_entries
    WHERE id = _entry_id
    AND lower(email) = lower(trim(_email));

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'NOT_FOUND',
            'message', 'Wachtlijst entry niet gevonden of email komt niet overeen'
        );
    END IF;

    -- If status is not waiting, position might have changed
    IF v_entry.status != 'waiting' THEN
        RETURN jsonb_build_object(
            'success', true,
            'status', v_entry.status,
            'position', NULL,
            'message', CASE v_entry.status
                WHEN 'notified' THEN 'Er is een plek vrijgekomen! Check je email.'
                WHEN 'offered' THEN 'Je hebt een ticket aangeboden gekregen! Check je email.'
                WHEN 'converted' THEN 'Je hebt je ticket succesvol geclaimd!'
                WHEN 'expired' THEN 'Je aanbod is verlopen.'
                WHEN 'cancelled' THEN 'Je wachtlijst entry is geannuleerd.'
                ELSE 'Status onbekend'
            END
        );
    END IF;

    -- Count how many are ahead (same event + ticket_type, lower position, status = waiting)
    SELECT COUNT(*) INTO v_current_position
    FROM waitlist_entries
    WHERE event_id = v_entry.event_id
    AND (
        (v_entry.ticket_type_id IS NULL AND ticket_type_id IS NULL)
        OR
        (ticket_type_id = v_entry.ticket_type_id)
    )
    AND status = 'waiting'
    AND position <= v_entry.position;

    RETURN jsonb_build_object(
        'success', true,
        'status', v_entry.status,
        'position', v_current_position,
        'quantity', v_entry.quantity,
        'message', format('Je staat op positie %s van de wachtlijst', v_current_position)
    );
END;
$$;

COMMENT ON FUNCTION public.get_waitlist_position IS
'Get current position in waitlist queue. Validates email for privacy.';

-- ===========================================================================
-- STEP 9: RPC - cancel_waitlist_entry
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.cancel_waitlist_entry(
    _entry_id UUID,
    _email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_entry waitlist_entries;
BEGIN
    -- Get entry and validate email
    SELECT * INTO v_entry
    FROM waitlist_entries
    WHERE id = _entry_id
    AND lower(email) = lower(trim(_email))
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'NOT_FOUND',
            'message', 'Wachtlijst entry niet gevonden of email komt niet overeen'
        );
    END IF;

    -- Can only cancel if waiting/notified/offered
    IF v_entry.status NOT IN ('waiting', 'notified', 'offered') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'INVALID_STATUS',
            'message', format('Kan niet annuleren. Status is: %s', v_entry.status)
        );
    END IF;

    -- Update to cancelled
    UPDATE waitlist_entries
    SET status = 'cancelled',
        updated_at = NOW()
    WHERE id = _entry_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Je bent verwijderd van de wachtlijst'
    );
END;
$$;

COMMENT ON FUNCTION public.cancel_waitlist_entry IS
'Cancel/remove a waitlist entry. User can self-cancel.';

-- ===========================================================================
-- STEP 10: RPC - process_waitlist_offers
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.process_waitlist_offers(
    _event_id UUID,
    _ticket_type_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_available_capacity INTEGER := 0;
    v_current_sold INTEGER;
    v_total_capacity INTEGER;
    v_offers_made INTEGER := 0;
    v_entry RECORD;
    v_event events;
    v_ticket_type ticket_types;
    v_offer_expires_at TIMESTAMPTZ;
    v_email_id UUID;
BEGIN
    -- Get event
    SELECT * INTO v_event
    FROM events WHERE id = _event_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'EVENT_NOT_FOUND');
    END IF;

    -- Calculate available capacity
    IF _ticket_type_id IS NOT NULL THEN
        SELECT * INTO v_ticket_type
        FROM ticket_types WHERE id = _ticket_type_id;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'TICKET_TYPE_NOT_FOUND');
        END IF;

        -- Count sold tickets
        SELECT COUNT(*) INTO v_current_sold
        FROM ticket_instances
        WHERE ticket_type_id = _ticket_type_id;

        v_total_capacity := v_ticket_type.capacity_total;

        IF v_total_capacity IS NOT NULL AND v_current_sold < v_total_capacity THEN
            v_available_capacity := v_total_capacity - v_current_sold;
        END IF;
    ELSE
        -- For event-level waitlist, would need to calculate total event capacity
        -- For now, return error (should implement if needed)
        RETURN jsonb_build_object(
            'success', false,
            'error', 'EVENT_LEVEL_NOT_IMPLEMENTED',
            'message', 'Event-level waitlist processing not yet implemented'
        );
    END IF;

    IF v_available_capacity <= 0 THEN
        RETURN jsonb_build_object(
            'success', true,
            'offers_made', 0,
            'message', 'Geen capaciteit beschikbaar'
        );
    END IF;

    -- Set offer expiration (24 hours from now)
    v_offer_expires_at := NOW() + INTERVAL '24 hours';

    -- Process top N waiting entries (FIFO by position)
    FOR v_entry IN
        SELECT *
        FROM waitlist_entries
        WHERE event_id = _event_id
        AND ticket_type_id = _ticket_type_id
        AND status = 'waiting'
        ORDER BY position ASC
        LIMIT v_available_capacity
    LOOP
        -- Update entry to 'offered'
        UPDATE waitlist_entries
        SET
            status = 'offered',
            notified_at = NOW(),
            offer_expires_at = v_offer_expires_at,
            updated_at = NOW()
        WHERE id = v_entry.id;

        -- Queue notification email
        v_email_id := queue_email(
            _org_id := v_event.org_id,
            _event_id := _event_id,
            _idempotency_key := 'waitlist-offer:' || v_entry.id::text,
            _to_email := v_entry.email,
            _subject := format('Goed nieuws! Er is een plek vrijgekomen voor %s', v_event.name),
            _html_body := format(
                E'<!DOCTYPE html>\n' ||
                E'<html><body style="font-family:sans-serif;padding:20px;">\n' ||
                E'<h2>Goed nieuws!</h2>\n' ||
                E'<p>Er is een plek vrijgekomen voor <strong>%s</strong>!</p>\n' ||
                E'<p>Je hebt <strong>24 uur</strong> om je ticket te claimen.</p>\n' ||
                E'<p><a href="%s/events/%s/checkout?waitlist_entry=%s" style="display:inline-block;padding:12px 24px;background:#3B82F6;color:white;text-decoration:none;border-radius:6px;">Claim nu je ticket</a></p>\n' ||
                E'<p style="color:#666;font-size:14px;">Dit aanbod vervalt op %s</p>\n' ||
                E'</body></html>',
                v_event.name,
                get_base_url(),
                v_event.slug,
                v_entry.id::text,
                to_char(v_offer_expires_at, 'DD-MM-YYYY HH24:MI')
            ),
            _text_body := format(
                'Goed nieuws! Er is een plek vrijgekomen voor %s. ' ||
                'Je hebt 24 uur om je ticket te claimen. ' ||
                'Ga naar: %s/events/%s/checkout?waitlist_entry=%s',
                v_event.name,
                get_base_url(),
                v_event.slug,
                v_entry.id::text
            )
        );

        v_offers_made := v_offers_made + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'offers_made', v_offers_made,
        'available_capacity', v_available_capacity,
        'message', format('Verzonden %s wachtlijst aanbiedingen', v_offers_made)
    );
END;
$$;

COMMENT ON FUNCTION public.process_waitlist_offers IS
'Process waitlist when capacity becomes available. Updates entries to offered and sends notification emails.';

-- ===========================================================================
-- STEP 11: RPC - expire_waitlist_offers
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.expire_waitlist_offers()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_expired_count INTEGER := 0;
    v_entry RECORD;
BEGIN
    -- Find and expire all offers past their deadline
    FOR v_entry IN
        SELECT id, event_id, ticket_type_id
        FROM waitlist_entries
        WHERE status = 'offered'
        AND offer_expires_at IS NOT NULL
        AND offer_expires_at < NOW()
        FOR UPDATE
    LOOP
        -- Mark as expired
        UPDATE waitlist_entries
        SET status = 'expired',
            updated_at = NOW()
        WHERE id = v_entry.id;

        v_expired_count := v_expired_count + 1;

        -- Trigger next person in line
        PERFORM process_waitlist_offers(v_entry.event_id, v_entry.ticket_type_id);
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'expired_count', v_expired_count,
        'message', format('Expired %s waitlist offers', v_expired_count)
    );
END;
$$;

COMMENT ON FUNCTION public.expire_waitlist_offers IS
'Expire waitlist offers past their deadline. Should be called by scheduled cron job.';

-- ===========================================================================
-- STEP 12: RPC - convert_waitlist_entry
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.convert_waitlist_entry(
    _entry_id UUID,
    _order_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_entry waitlist_entries;
    v_order orders;
BEGIN
    -- Get entry
    SELECT * INTO v_entry
    FROM waitlist_entries
    WHERE id = _entry_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'ENTRY_NOT_FOUND');
    END IF;

    -- Verify order exists and matches event
    SELECT * INTO v_order
    FROM orders
    WHERE id = _order_id
    AND event_id = v_entry.event_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;

    -- Mark as converted
    UPDATE waitlist_entries
    SET
        status = 'converted',
        converted_order_id = _order_id,
        updated_at = NOW()
    WHERE id = _entry_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Waitlist entry converted to order'
    );
END;
$$;

COMMENT ON FUNCTION public.convert_waitlist_entry IS
'Mark waitlist entry as converted after successful purchase. Called by checkout flow.';

-- ===========================================================================
-- STEP 13: RPC - get_event_waitlist (Organizer Admin)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.get_event_waitlist(_event_id UUID)
RETURNS TABLE (
    id UUID,
    ticket_type_id UUID,
    ticket_type_name TEXT,
    email TEXT,
    full_name TEXT,
    quantity INTEGER,
    "position" INTEGER,
    status TEXT,
    created_at TIMESTAMPTZ,
    notified_at TIMESTAMPTZ,
    offer_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org_id UUID;
BEGIN
    -- Get org_id for event
    SELECT org_id INTO v_org_id
    FROM events
    WHERE events.id = _event_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event not found';
    END IF;

    -- Check if user is org member
    IF NOT EXISTS (
        SELECT 1 FROM org_members
        WHERE org_id = v_org_id
        AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Not authorized to view waitlist for this event';
    END IF;

    -- Return waitlist entries
    RETURN QUERY
    SELECT
        we.id,
        we.ticket_type_id,
        tt.name AS ticket_type_name,
        we.email,
        we.full_name,
        we.quantity,
        we.position,
        we.status,
        we.created_at,
        we.notified_at,
        we.offer_expires_at
    FROM waitlist_entries we
    LEFT JOIN ticket_types tt ON tt.id = we.ticket_type_id
    WHERE we.event_id = _event_id
    ORDER BY we.position ASC, we.created_at ASC;
END;
$$;

COMMENT ON FUNCTION public.get_event_waitlist IS
'Get all waitlist entries for an event. Only accessible to org members. For organizer admin panel.';

-- ===========================================================================
-- STEP 14: VIEW - v_waitlist_stats
-- ===========================================================================

CREATE OR REPLACE VIEW public.v_waitlist_stats AS
SELECT
    we.event_id,
    we.ticket_type_id,
    COUNT(*) FILTER (WHERE we.status = 'waiting') AS total_waiting,
    COUNT(*) FILTER (WHERE we.status = 'offered') AS total_offered,
    COUNT(*) FILTER (WHERE we.status = 'converted') AS total_converted,
    COUNT(*) FILTER (WHERE we.status = 'expired') AS total_expired,
    COUNT(*) FILTER (WHERE we.status = 'cancelled') AS total_cancelled,
    COALESCE(MAX(we.position) FILTER (WHERE we.status = 'waiting'), 0) + 1 AS next_position
FROM public.waitlist_entries we
GROUP BY we.event_id, we.ticket_type_id;

COMMENT ON VIEW public.v_waitlist_stats IS
'Aggregate statistics per event and ticket type. Shows counts by status and next available position.';

-- ===========================================================================
-- STEP 15: TRIGGER - Auto-process waitlist on order status change
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.trigger_waitlist_on_order_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_waitlist_enabled BOOLEAN;
    v_order_item RECORD;
BEGIN
    -- Only trigger on status change to 'refunded' or 'cancelled'
    IF (OLD.status != NEW.status) AND (NEW.status IN ('refunded', 'cancelled')) THEN

        -- Check if event has waitlist enabled
        SELECT COALESCE(
            (get_event_config(NEW.event_id)->'waitlist'->>'enabled')::boolean,
            false
        ) INTO v_waitlist_enabled;

        IF v_waitlist_enabled THEN
            -- Process waitlist for each ticket type in the order
            FOR v_order_item IN
                SELECT DISTINCT ticket_type_id
                FROM order_items
                WHERE order_id = NEW.id
                AND ticket_type_id IS NOT NULL
            LOOP
                -- Async: don't block the order update if this fails
                BEGIN
                    PERFORM process_waitlist_offers(NEW.event_id, v_order_item.ticket_type_id);
                EXCEPTION WHEN OTHERS THEN
                    -- Log error but don't block
                    RAISE WARNING 'Failed to process waitlist for ticket_type %: %',
                        v_order_item.ticket_type_id, SQLERRM;
                END;
            END LOOP;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_waitlist_on_order_status_change
    AFTER UPDATE OF status ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.trigger_waitlist_on_order_change();

COMMENT ON FUNCTION public.trigger_waitlist_on_order_change IS
'Automatically process waitlist when an order is cancelled or refunded, freeing up capacity.';

-- ===========================================================================
-- STEP 16: GRANT PERMISSIONS
-- ===========================================================================

-- Grant usage on public schema (already granted in layer 1, but ensure it)
GRANT USAGE ON SCHEMA public TO authenticated, anon;

-- Grant SELECT on table to authenticated users (RLS will filter)
GRANT SELECT ON public.waitlist_entries TO authenticated, anon;

-- Grant INSERT to anon/authenticated (RLS + RPC validation will control)
GRANT INSERT ON public.waitlist_entries TO authenticated, anon;

-- Grant DELETE to authenticated (RLS will control)
GRANT DELETE ON public.waitlist_entries TO authenticated;

-- Grant EXECUTE on RPCs
GRANT EXECUTE ON FUNCTION public.join_waitlist TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_waitlist_position TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.cancel_waitlist_entry TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_event_waitlist TO authenticated;

-- Internal functions (SECURITY DEFINER, called by system)
GRANT EXECUTE ON FUNCTION public.process_waitlist_offers TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_waitlist_offers TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_waitlist_entry TO authenticated;

-- ===========================================================================
-- COMPLETE: F018 Waitlist Management
-- ===========================================================================
-- Next steps:
-- 1. Set up cron job to call expire_waitlist_offers() periodically (e.g., every 30 min)
-- 2. Integrate convert_waitlist_entry() into checkout flow
-- 3. Build organizer admin UI using get_event_waitlist()
-- 4. Add waitlist join button to frontend when tickets are sold out
-- ===========================================================================
