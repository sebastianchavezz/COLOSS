import { useNavigate, useLocation } from "react-router-dom";
import { Compass, Ticket, User } from "lucide-react";

export function BottomNav() {
    const navigate = useNavigate();
    const location = useLocation();

    const isActive = (path: string) => location.pathname === path;

    return (
        <nav className="absolute bottom-0 left-0 right-0 bg-white border-t border-[rgba(0,0,0,0.08)] pb-7 z-20">
            <div className="flex items-center justify-around px-8 pt-3">
                <button
                    onClick={() => navigate('/')}
                    className="flex flex-col items-center gap-1"
                >
                    <div className="w-6 h-6 flex items-center justify-center">
                        {isActive('/') ? (
                            <div className="w-5 h-5 bg-[#0047FF] rounded-full flex items-center justify-center">
                                <Compass className="w-3 h-3 text-white" />
                            </div>
                        ) : (
                            <Compass className="w-6 h-6 text-[#8a8a8a]" />
                        )}
                    </div>
                    <span className={`text-xs ${isActive('/') ? 'text-[#0047FF]' : 'text-[#8a8a8a]'}`}>
                        Discover
                    </span>
                </button>

                <button
                    onClick={() => navigate('/tickets')}
                    className="flex flex-col items-center gap-1"
                >
                    <div className="w-6 h-6 flex items-center justify-center">
                        {isActive('/tickets') ? (
                            <div className="w-5 h-5 bg-[#0047FF] rounded-full flex items-center justify-center">
                                <Ticket className="w-3 h-3 text-white" />
                            </div>
                        ) : (
                            <Ticket className="w-6 h-6 text-[#8a8a8a]" />
                        )}
                    </div>
                    <span className={`text-xs ${isActive('/tickets') ? 'text-[#0047FF]' : 'text-[#8a8a8a]'}`}>
                        My Tickets
                    </span>
                </button>

                <button
                    onClick={() => navigate('/profile')} // Placeholder
                    className="flex flex-col items-center gap-1"
                >
                    <div className="w-6 h-6 flex items-center justify-center">
                        <User className="w-6 h-6 text-[#8a8a8a]" />
                    </div>
                    <span className="text-xs text-[#8a8a8a]">Profile</span>
                </button>
            </div>
        </nav>
    );
}
