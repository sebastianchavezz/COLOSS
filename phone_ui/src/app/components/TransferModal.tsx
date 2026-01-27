import { useState } from "react";
import { X, Send, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface TransferModalProps {
    ticketId: string;
    ticketName: string;
    eventName: string;
    onClose: () => void;
    onSuccess: () => void;
}

export function TransferModal({ ticketId, ticketName, eventName, onClose, onSuccess }: TransferModalProps) {
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!email.trim() || !email.includes('@')) {
            setError("Please enter a valid email address");
            return;
        }

        setLoading(true);

        try {
            // Get current user
            const { data: { user }, error: userError } = await supabase.auth.getUser();
            if (userError || !user) {
                throw new Error('You must be logged in');
            }

            // Get ticket details with participant info
            const { data: ticketData, error: ticketError } = await supabase
                .from('tickets')
                .select(`
                    id,
                    ticket_type_id,
                    registration_id,
                    registrations!inner(
                        participant_id,
                        participants!inner(user_id)
                    )
                `)
                .eq('id', ticketId)
                .single();

            if (ticketError || !ticketData) {
                throw new Error('Ticket not found');
            }

            const participantId = (ticketData.registrations as any).participant_id;

            // Get event and org info
            const { data: ticketTypeData, error: ttError } = await supabase
                .from('ticket_types')
                .select('event_id, events!inner(org_id)')
                .eq('id', ticketData.ticket_type_id)
                .single();

            if (ttError || !ticketTypeData) {
                throw new Error('Event not found');
            }

            const eventId = ticketTypeData.event_id;
            const orgId = (ticketTypeData.events as any).org_id;

            // Generate a simple token hash for now (in production, use crypto)
            const tokenHash = crypto.randomUUID();

            // Create transfer
            const { error: insertError } = await supabase
                .from('ticket_transfers')
                .insert({
                    org_id: orgId,
                    event_id: eventId,
                    ticket_instance_id: ticketId,
                    from_participant_id: participantId,
                    to_email: email.trim().toLowerCase(),
                    transfer_token_hash: tokenHash,
                    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
                    status: 'pending'
                });

            if (insertError) throw insertError;

            onSuccess();
            onClose();
        } catch (err: any) {
            console.error('Transfer error:', err);
            setError(err.message || 'Failed to initiate transfer');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50">
            <div className="bg-white rounded-t-3xl w-full max-w-lg p-6 pb-8 animate-slide-up">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-semibold">Transfer Ticket</h2>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Ticket Info */}
                <div className="bg-gray-50 rounded-xl p-4 mb-6">
                    <p className="text-sm text-gray-500 mb-1">Transferring</p>
                    <p className="font-semibold text-gray-900">{eventName}</p>
                    <p className="text-sm text-gray-600">{ticketName}</p>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                            Recipient Email
                        </label>
                        <input
                            type="email"
                            id="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="recipient@example.com"
                            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            disabled={loading}
                            required
                        />
                    </div>

                    {error && (
                        <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                            <p className="text-sm text-red-800">{error}</p>
                        </div>
                    )}

                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                        <p className="text-sm text-blue-800">
                            The recipient will receive an email notification and can accept or reject this transfer.
                            Your ticket will remain valid until they accept.
                        </p>
                    </div>

                    <button
                        type="submit"
                        disabled={loading || !email.trim()}
                        className="w-full bg-[#0047FF] text-white py-3 rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-600 transition-colors"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Sending...
                            </>
                        ) : (
                            <>
                                <Send className="w-5 h-5" />
                                Send Transfer Request
                            </>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
}
