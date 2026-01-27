import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Ticket, Calendar, MapPin, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/app/context/AuthContext";

interface MyTicket {
    ticket_id: string;
    barcode: string;
    status: 'valid' | 'pending';
    created_at: string;
    ticket_name: string;
    price: number;
    currency: string;
    event_id: string;
    event_name: string;
    starts_at: string;
    location_name: string;
}

export function MyTickets() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [tickets, setTickets] = useState<MyTicket[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) {
            setLoading(false);
            return;
        }

        async function fetchTickets() {
            try {
                // Use the new view
                const { data, error } = await supabase
                    .from('my_tickets_view')
                    .select('*')
                    .eq('owner_user_id', user!.id)
                    .order('created_at', { ascending: false });

                if (error) throw error;
                setTickets(data || []);
            } catch (err) {
                console.error('Error fetching tickets:', err);
            } finally {
                setLoading(false);
            }
        }

        fetchTickets();
    }, [user]);

    if (!user) {
        return (
            <div className="h-full flex flex-col items-center justify-center p-6 text-center">
                <Ticket className="w-12 h-12 text-gray-300 mb-4" />
                <h2 className="text-lg font-semibold text-gray-900 mb-2">Sign in to view tickets</h2>
                <p className="text-gray-500 mb-6">You need to be signed in to see your purchased tickets.</p>
                <button
                    onClick={() => navigate('/login', { state: { from: { pathname: '/tickets' } } })}
                    className="bg-[#0047FF] text-white px-6 py-3 rounded-full font-semibold"
                >
                    Sign In
                </button>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-[#0047FF]" />
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-white">
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-gray-200 z-10">
                <div className="flex items-center justify-between px-5 py-4">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => navigate('/')}
                            className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-gray-100"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                        <h1 className="text-lg font-semibold">My Tickets</h1>
                    </div>
                    <button
                        onClick={() => navigate('/transfers/pending')}
                        className="text-sm text-[#0047FF] font-medium hover:underline"
                    >
                        Pending
                    </button>
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-5 pb-24">
                {tickets.length === 0 ? (
                    <div className="text-center py-12">
                        <Ticket className="mx-auto h-12 w-12 text-gray-300" />
                        <h3 className="mt-2 text-sm font-medium text-gray-900">No tickets yet</h3>
                        <p className="mt-1 text-sm text-gray-500">Tickets you purchase will appear here.</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {tickets.map(ticket => (
                            <div
                                key={ticket.ticket_id}
                                onClick={() => navigate(`/tickets/${ticket.ticket_id}`, { state: { ticket } })}
                                className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm active:scale-[0.98] transition-transform cursor-pointer"
                            >
                                <div className="flex justify-between items-start mb-3">
                                    <div>
                                        <h3 className="font-semibold text-gray-900">{ticket.event_name}</h3>
                                        <p className="text-sm text-gray-500">{ticket.ticket_name}</p>
                                    </div>
                                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${ticket.status === 'valid'
                                        ? 'bg-green-100 text-green-700'
                                        : 'bg-yellow-100 text-yellow-700'
                                        }`}>
                                        {ticket.status.toUpperCase()}
                                    </span>
                                </div>

                                <div className="space-y-2 text-sm text-gray-600">
                                    <div className="flex items-center gap-2">
                                        <Calendar className="w-4 h-4" />
                                        <span>
                                            {new Date(ticket.starts_at).toLocaleDateString('en-US', {
                                                weekday: 'short',
                                                month: 'short',
                                                day: 'numeric'
                                            })}
                                        </span>
                                    </div>
                                    {ticket.location_name && (
                                        <div className="flex items-center gap-2">
                                            <MapPin className="w-4 h-4" />
                                            <span className="truncate">{ticket.location_name}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
