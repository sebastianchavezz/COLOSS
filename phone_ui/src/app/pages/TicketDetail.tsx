import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Calendar, MapPin, Share2, ArrowRightLeft } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { TransferModal } from "@/app/components/TransferModal";

export function TicketDetail() {
    const navigate = useNavigate();
    const { state } = useLocation();
    const ticket = state?.ticket;
    const [showTransferModal, setShowTransferModal] = useState(false);

    if (!ticket) {
        return (
            <div className="h-full flex items-center justify-center">
                <p>Ticket not found</p>
                <button onClick={() => navigate('/tickets')} className="text-blue-500 ml-2">Go back</button>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-gray-50">
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-gray-200 z-10">
                <div className="flex items-center justify-between px-5 py-4">
                    <button
                        onClick={() => navigate(-1)}
                        className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-gray-100"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <h1 className="text-lg font-semibold">Ticket</h1>
                    <button className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-gray-100">
                        <Share2 className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Ticket Card */}
            <div className="flex-1 overflow-y-auto p-5">
                <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
                    {/* Event Header */}
                    <div className="bg-[#0047FF] p-6 text-white text-center">
                        <h2 className="text-xl font-bold mb-2">{ticket.event_name}</h2>
                        <div className="flex items-center justify-center gap-2 text-blue-100 text-sm">
                            <Calendar className="w-4 h-4" />
                            <span>
                                {new Date(ticket.starts_at).toLocaleDateString('en-US', {
                                    weekday: 'long',
                                    month: 'long',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                })}
                            </span>
                        </div>
                    </div>

                    {/* QR Code Section */}
                    <div className="p-8 flex flex-col items-center border-b border-dashed border-gray-200 relative">
                        {/* Cutout Circles */}
                        <div className="absolute -left-3 bottom-[-12px] w-6 h-6 bg-gray-50 rounded-full" />
                        <div className="absolute -right-3 bottom-[-12px] w-6 h-6 bg-gray-50 rounded-full" />

                        {ticket.status === 'valid' ? (
                            <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                                <QRCodeSVG value={ticket.barcode} size={200} level="H" />
                            </div>
                        ) : (
                            <div className="w-[200px] h-[200px] bg-gray-100 rounded-xl flex items-center justify-center text-center p-4">
                                <div>
                                    <p className="font-semibold text-gray-900 mb-1">Payment Pending</p>
                                    <p className="text-xs text-gray-500">QR code will appear after payment confirmation</p>
                                </div>
                            </div>
                        )}

                        <p className="mt-4 text-sm font-mono text-gray-400 tracking-widest">
                            {ticket.barcode.slice(0, 8).toUpperCase()}
                        </p>
                    </div>

                    {/* Details */}
                    <div className="p-6 space-y-4">
                        <div>
                            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Ticket Type</p>
                            <p className="font-semibold text-gray-900">{ticket.ticket_name}</p>
                        </div>

                        <div>
                            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Location</p>
                            <div className="flex items-start gap-2">
                                <MapPin className="w-4 h-4 text-gray-400 mt-0.5" />
                                <p className="font-medium text-gray-900">{ticket.location_name || 'TBA'}</p>
                            </div>
                        </div>

                        <div>
                            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Attendee</p>
                            <p className="font-medium text-gray-900">Me</p>
                        </div>

                        {/* Transfer Button - Only show for valid tickets */}
                        {ticket.status === 'valid' && (
                            <div className="pt-4 border-t border-gray-200">
                                <button
                                    onClick={() => setShowTransferModal(true)}
                                    className="w-full flex items-center justify-center gap-2 px-6 py-3 border-2 border-[#0047FF] text-[#0047FF] rounded-xl font-semibold hover:bg-blue-50 transition-colors"
                                >
                                    <ArrowRightLeft className="w-5 h-5" />
                                    Transfer Ticket
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Transfer Modal */}
            {showTransferModal && (
                <TransferModal
                    ticketId={ticket.ticket_id}
                    ticketName={ticket.ticket_name}
                    eventName={ticket.event_name}
                    onClose={() => setShowTransferModal(false)}
                    onSuccess={() => {
                        // Redirect back to My Tickets after successful transfer
                        navigate('/tickets');
                    }}
                />
            )}
        </div>
    );
}
