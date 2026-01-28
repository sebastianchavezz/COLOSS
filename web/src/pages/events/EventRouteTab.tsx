/**
 * EventRouteTab
 *
 * Wrapper component that renders EventRouteAdminContent within the EventDetail tabs.
 * Gets event from outlet context instead of URL params.
 */

import { useOutletContext } from 'react-router-dom';
import { EventRouteAdminContent } from './EventRouteAdmin';
import type { AppEvent } from '../../types/supabase';

type EventDetailContext = {
    event: AppEvent;
    org: { id: string; slug: string };
    refreshEvent: () => void;
};

export function EventRouteTab() {
    const { event } = useOutletContext<EventDetailContext>();

    if (!event) {
        return <div className="p-4 text-gray-500">Laden...</div>;
    }

    return <EventRouteAdminContent eventId={event.id} />;
}
