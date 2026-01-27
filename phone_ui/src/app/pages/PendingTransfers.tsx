import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, X, Loader2, Mail } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/app/context/AuthContext";

interface PendingTransfer {
    id: string;
    event_name: string;
    ticket_name: string;
    from_email: string;
    created_at: string;
}

export function PendingTransfers() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [transfers, setTransfers] = useState<PendingTransfer[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    useEffect(() => {
        if (!user) {
            setLoading(false);
            return;
        }

        fetchTransfers();
    }, [user]);

    const fetchTransfers = async () => {
        try {
            const { data, error } = await supabase
                .from('ticket_transfers')
                .select(`
                    id,
                    created_at,
                    ticket:tickets(
                        id,
                        ticket_type:ticket_types(
                            name,
                            event:events(
                                name
                            )
                        )
                    ),
                    from_user:auth.users!ticket_transfers_from_user_id_fkey(email)
                `)
                .eq('to_email', user!.email)
                .eq('status', 'pending')
                .order('created_at', { ascending: false });

            if (error) throw error;

            // Transform data
            const mapped: PendingTransfer[] = (data || []).map((t: any) => ({
                id: t.id,
                event_name: t.ticket?.ticket_type?.event?.name || 'Unknown Event',
                ticket_name: t.ticket?.ticket_type?.name || 'Unknown Ticket',
                from_email: t.from_user?.email || 'Unknown',
                created_at: t.created_at
            }));

            setTransfers(mapped);
        } catch (err) {
            console.error('Error fetching transfers:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleAccept = async (transferId: string) => {
        setActionLoading(transferId);
        try {
            const { error } = await supabase.rpc('accept_ticket_transfer', {
                _transfer_id: transferId
            });

            if (error) throw error;

            // Remove from list
            setTransfers(prev => prev.filter(t => t.id !== transferId));
            alert('Transfer accepted! Check My Tickets.');
        } catch (err: any) {
            console.error('Accept error:', err);
            alert(`Failed to accept: ${err.message}`);
        } finally {
            setActionLoading(null);
        }
    };

    const handleReject = async (transferId: string) => {
        setActionLoading(transferId);
        try {
            const { error } = await supabase.rpc('reject_ticket_transfer', {
                _transfer_id: transferId
            });

            if (error) throw error;

            // Remove from list
            setTransfers(prev => prev.filter(t => t.id !== transferId));
        } catch (err: any) {
            console.error('Reject error:', err);
            alert(`Failed to reject: ${err.message}`);
        } finally {
            setActionLoading(null);
        }
    };

    if (!user) {
        return (
            <div className="h-full flex flex-col items-center justify-center p-6 text-center">
                <Mail className="w-12 h-12 text-gray-300 mb-4" />
                <h2 className="text-lg font-semibold text-gray-900 mb-2">Sign in required</h2>
                <p className="text-gray-500 mb-6">Please sign in to view transfer requests.</p>
                <button
                    onClick={() => navigate('/login')}
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
                <div className="flex items-center gap-4 px-5 py-4">
                    <button
                        onClick={() => navigate('/tickets')}
                        className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-gray-100"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <h1 className="text-lg font-semibold">Pending Transfers</h1>
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-5 pb-24">
                {transfers.length === 0 ? (
                    <div className="text-center py-12">
                        <Mail className="mx-auto h-12 w-12 text-gray-300" />
                        <h3 className="mt-2 text-sm font-medium text-gray-900">No pending transfers</h3>
                        <p className="mt-1 text-sm text-gray-500">Transfer requests will appear here.</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {transfers.map(transfer => (
                            <div
                                key={transfer.id}
                                className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm"
                            >
                                <div className="mb-4">
                                    <h3 className="font-semibold text-gray-900">{transfer.event_name}</h3>
                                    <p className="text-sm text-gray-600">{transfer.ticket_name}</p>
                                    <p className="text-xs text-gray-500 mt-2">
                                        From: {transfer.from_email}
                                    </p>
                                    <p className="text-xs text-gray-400">
                                        {new Date(transfer.created_at).toLocaleDateString('en-US', {
                                            month: 'short',
                                            day: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit'
                                        })}
                                    </p>
                                </div>

                                <div className="flex gap-3">
                                    <button
                                        onClick={() => handleAccept(transfer.id)}
                                        disabled={actionLoading === transfer.id}
                                        className="flex-1 bg-green-600 text-white py-2 rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                                    >
                                        {actionLoading === transfer.id ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <Check className="w-4 h-4" />
                                        )}
                                        Accept
                                    </button>
                                    <button
                                        onClick={() => handleReject(transfer.id)}
                                        disabled={actionLoading === transfer.id}
                                        className="flex-1 bg-red-600 text-white py-2 rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                                    >
                                        {actionLoading === transfer.id ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <X className="w-4 h-4" />
                                        )}
                                        Reject
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
