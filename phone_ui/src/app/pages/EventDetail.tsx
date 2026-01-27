import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { ArrowLeft, Calendar, MapPin, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/app/context/AuthContext";

interface Ticket {
    id: string;
    name: string;
    price: number;
    currency: string;
    capacity_remaining: number | null;
}

export function EventDetail() {
    const { eventId } = useParams<{ eventId: string }>();
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useAuth();

    const [event, setEvent] = useState<any>(null);
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [selectedQuantities, setSelectedQuantities] = useState<Record<string, number>>({});

    useEffect(() => {
        async function fetchEventDetails() {
            if (!eventId) return;

            try {
                // Fetch event details
                const { data: eventData, error: eventError } = await supabase
                    .from('events')
                    .select('*')
                    .eq('id', eventId)
                    .single();

                if (eventError) throw eventError;
                setEvent(eventData);

                // Fetch tickets
                const { data: ticketsData, error: ticketsError } = await supabase
                    .from('ticket_types')
                    .select('id, name, price, currency, capacity_total') // Changed to capacity_total
                    .eq('event_id', eventId)
                    // .eq('status', 'published') 
                    .order('price', { ascending: true });

                if (ticketsError) throw ticketsError;

                // Map capacity_total to capacity_remaining for now
                const mappedTickets = (ticketsData || []).map((t: any) => ({
                    ...t,
                    capacity_remaining: t.capacity_total // Temporary: use total as remaining
                }));

                setTickets(mappedTickets);
            } catch (err) {
                console.error('Error fetching event details:', err);
            } finally {
                setLoading(false);
            }
        }

        fetchEventDetails();
    }, [eventId]);

    const updateQuantity = (ticketId: string, delta: number) => {
        setSelectedQuantities(prev => {
            const current = prev[ticketId] || 0;
            const newValue = Math.max(0, current + delta);
            return { ...prev, [ticketId]: newValue };
        });
    };

    const handleCheckout = async () => {
        if (!user) {
            // Redirect to login with return path
            navigate("/login", { state: { from: location } });
            return;
        }

        setProcessing(true);
        try {
            // 1. Get or Create Participant
            let { data: participant } = await supabase
                .from('participants')
                .select('id')
                .eq('user_id', user.id)
                .single();

            if (!participant) {
                const { data: newParticipant, error: partError } = await supabase
                    .from('participants')
                    .insert({
                        user_id: user.id,
                        email: user.email!,
                        first_name: 'User', // Placeholder
                        last_name: 'Name',
                    })
                    .select()
                    .single();

                if (partError) throw partError;
                participant = newParticipant;
            }

            // 2. Create Registration
            // Check if already registered
            let { data: registration } = await supabase
                .from('registrations')
                .select('id')
                .eq('event_id', eventId)
                .eq('participant_id', participant!.id)
                .single();

            const totalAmount = tickets.reduce((sum, ticket) => {
                const qty = selectedQuantities[ticket.id] || 0;
                return sum + (ticket.price * qty);
            }, 0);

            const isFree = totalAmount === 0;
            const registrationStatus = isFree ? 'confirmed' : 'pending';
            const orderStatus = isFree ? 'paid' : 'pending';

            // Tickets for paid orders should be 'pending' until payment is confirmed.
            // Tickets for free orders can be 'valid' immediately.
            const ticketStatus = isFree ? 'valid' : 'pending';

            if (!registration) {
                const { data: newRegistration, error: regError } = await supabase
                    .from('registrations')
                    .insert({
                        event_id: eventId,
                        participant_id: participant!.id,
                        status: registrationStatus
                    })
                    .select()
                    .single();

                if (regError) throw regError;
                registration = newRegistration;
            }

            // 3. Create Order
            const { data: order, error: orderError } = await supabase
                .from('orders')
                .insert({
                    event_id: eventId,
                    user_id: user.id,
                    email: user.email,
                    status: orderStatus,
                    total_amount: totalAmount,
                    currency: tickets[0]?.currency || 'EUR',
                })
                .select()
                .single();

            if (orderError) throw orderError;

            // 4. Create Order Items & Tickets
            const orderItems = [];
            const newTickets = [];

            for (const ticket of tickets) {
                const qty = selectedQuantities[ticket.id] || 0;
                if (qty > 0) {
                    // Order Item
                    orderItems.push({
                        order_id: order.id,
                        ticket_type_id: ticket.id,
                        quantity: qty,
                        unit_price: ticket.price,
                        total_price: ticket.price * qty
                    });

                    // Create individual tickets
                    for (let i = 0; i < qty; i++) {
                        newTickets.push({
                            registration_id: registration!.id,
                            ticket_type_id: ticket.id,
                            order_id: order.id,
                            barcode: crypto.randomUUID(), // Generate unique barcode
                            status: ticketStatus
                        });
                    }
                }
            }

            const { error: itemsError } = await supabase
                .from('order_items')
                .insert(orderItems);

            if (itemsError) throw itemsError;

            const { error: ticketsError } = await supabase
                .from('tickets')
                .insert(newTickets);

            if (ticketsError) {
                // Handle specific error for invalid input value for enum ticket_status
                if (ticketsError.message?.includes('invalid input value for enum ticket_status')) {
                    throw new Error("Database migration missing: 'pending' status not supported for tickets. Please apply migration 20240121000001.");
                }
                throw ticketsError;
            }

            // 5. Completion
            if (isFree) {
                alert('Order successful! Tickets created.');
                navigate('/');
            } else {
                // SIMULATION: Call Edge Function to simulate payment success
                // This replaces the real payment provider flow for testing purposes.
                // Requires SIMULATE_PAYMENTS_ENABLED=true in Edge Function env.
                const { data: { session } } = await supabase.auth.getSession();

                if (!session) {
                    throw new Error("No active session found for payment simulation");
                }

                const { error: simError } = await supabase.functions.invoke('simulate-payment', {
                    body: { order_id: order.id },
                    headers: {
                        Authorization: `Bearer ${session.access_token}`
                    }
                });

                if (simError) {
                    console.error('Simulation failed:', simError);
                    alert(`Payment simulation failed: ${simError.message || 'Check console'}`);
                    return;
                }

                alert('Payment Simulated! Order Paid & Tickets Valid.');
                navigate('/');
            }

        } catch (err: any) {
            console.error('Checkout failed:', err);
            alert(`Checkout failed: ${err.message}`);
        } finally {
            setProcessing(false);
        }
    };

    const totalItems = Object.values(selectedQuantities).reduce((sum, qty) => sum + qty, 0);
    const totalPrice = tickets.reduce((sum, ticket) => {
        const qty = selectedQuantities[ticket.id] || 0;
        return sum + (ticket.price * qty);
    }, 0);

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#0047FF]" />
            </div>
        );
    }

    if (!event) {
        return (
            <div className="h-full flex items-center justify-center">
                <p className="text-gray-500">Event not found</p>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-white">
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-gray-200 z-10">
                <div className="flex items-center gap-4 px-5 py-4">
                    <button
                        onClick={() => navigate(-1)}
                        className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-gray-100"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <h1 className="text-lg font-semibold truncate">{event.name}</h1>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto pb-32">
                {/* Event Info */}
                <div className="px-5 py-6 border-b border-gray-200">
                    <div className="space-y-3">
                        <div className="flex items-start gap-3">
                            <Calendar className="w-5 h-5 text-gray-400 mt-0.5" />
                            <div>
                                <p className="font-medium">
                                    {new Date(event.start_time).toLocaleDateString('nl-NL', {
                                        weekday: 'long',
                                        day: 'numeric',
                                        month: 'long',
                                        year: 'numeric'
                                    })}
                                </p>
                                <p className="text-sm text-gray-500">
                                    {new Date(event.start_time).toLocaleTimeString('nl-NL', {
                                        hour: '2-digit',
                                        minute: '2-digit'
                                    })}
                                </p>
                            </div>
                        </div>

                        {event.location_name && (
                            <div className="flex items-start gap-3">
                                <MapPin className="w-5 h-5 text-gray-400 mt-0.5" />
                                <p className="font-medium">{event.location_name}</p>
                            </div>
                        )}

                        {event.description && (
                            <p className="text-gray-600 mt-4">{event.description}</p>
                        )}
                    </div>
                </div>

                {/* Tickets */}
                <div className="px-5 py-6">
                    <h2 className="text-lg font-semibold mb-4">Select Tickets</h2>

                    {tickets.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                            No tickets available
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {tickets.map(ticket => (
                                <div
                                    key={ticket.id}
                                    className="bg-white border border-gray-200 rounded-2xl p-4"
                                >
                                    <div className="flex items-start justify-between mb-3">
                                        <div className="flex-1">
                                            <h3 className="font-semibold">{ticket.name}</h3>
                                            <p className="text-lg font-bold text-[#0047FF] mt-1">
                                                {ticket.price === 0 ? 'Gratis' : `€${ticket.price.toFixed(2)}`}
                                            </p>
                                            {ticket.capacity_remaining !== null && (
                                                <p className="text-sm text-gray-500 mt-1">
                                                    {ticket.capacity_remaining} remaining
                                                </p>
                                            )}
                                        </div>

                                        {/* Quantity selector */}
                                        <div className="flex items-center gap-2 bg-gray-100 rounded-full px-2 py-1">
                                            <button
                                                onClick={() => updateQuantity(ticket.id, -1)}
                                                disabled={(selectedQuantities[ticket.id] || 0) === 0}
                                                className="w-8 h-8 rounded-full bg-white flex items-center justify-center disabled:opacity-30"
                                            >
                                                −
                                            </button>
                                            <span className="w-8 text-center font-semibold">
                                                {selectedQuantities[ticket.id] || 0}
                                            </span>
                                            <button
                                                onClick={() => updateQuantity(ticket.id, 1)}
                                                className="w-8 h-8 rounded-full bg-[#0047FF] text-white flex items-center justify-center"
                                            >
                                                +
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom Checkout Bar */}
            {totalItems > 0 && (
                <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-5 py-4 pb-safe">
                    <div className="flex items-center justify-between mb-3">
                        <div>
                            <p className="text-sm text-gray-600">{totalItems} ticket{totalItems > 1 ? 's' : ''}</p>
                            <p className="text-2xl font-bold text-[#0047FF]">
                                €{totalPrice.toFixed(2)}
                            </p>
                        </div>
                        <button
                            className="bg-[#0047FF] text-white px-8 py-3 rounded-full font-semibold flex items-center gap-2 disabled:opacity-70"
                            onClick={handleCheckout}
                            disabled={processing}
                        >
                            {processing && <Loader2 className="w-4 h-4 animate-spin" />}
                            {processing ? 'Processing...' : 'Checkout'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
