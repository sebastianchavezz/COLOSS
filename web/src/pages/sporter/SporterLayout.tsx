/**
 * SporterLayout - Layout wrapper for sporter/consumer pages
 *
 * Minimal layout with navigation for:
 * - Dashboard
 * - Mijn Tickets
 * - Profiel
 */

import { Link, Outlet, useLocation, Navigate } from 'react-router-dom'
import { Ticket, User, Home, LogOut, Calendar, MessageSquare } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'

const navItems = [
    { to: '/my', icon: Home, label: 'Dashboard', exact: true },
    { to: '/my/tickets', icon: Ticket, label: 'Mijn Tickets' },
    { to: '/my/messages', icon: MessageSquare, label: 'Berichten' },
    { to: '/my/profile', icon: User, label: 'Profiel' },
]

export function SporterLayout() {
    const { user, signOut, loading } = useAuth()
    const location = useLocation()

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black"></div>
            </div>
        )
    }

    if (!user) {
        return <Navigate to="/login" state={{ from: location }} replace />
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="bg-white border-b border-gray-200">
                <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
                    <Link to="/" className="text-xl font-bold tracking-tight">
                        COLOSS
                    </Link>
                    <div className="flex items-center gap-4">
                        <Link
                            to="/events"
                            className="text-sm text-gray-600 hover:text-black flex items-center gap-1"
                        >
                            <Calendar className="h-4 w-4" />
                            Events
                        </Link>
                        <button
                            onClick={() => signOut()}
                            className="text-sm text-gray-600 hover:text-black flex items-center gap-1"
                        >
                            <LogOut className="h-4 w-4" />
                            Uitloggen
                        </button>
                    </div>
                </div>
            </header>

            {/* Navigation */}
            <nav className="bg-white border-b border-gray-100">
                <div className="max-w-5xl mx-auto px-4">
                    <div className="flex gap-1">
                        {navItems.map((item) => {
                            const isActive = item.exact
                                ? location.pathname === item.to
                                : location.pathname.startsWith(item.to)
                            return (
                                <Link
                                    key={item.to}
                                    to={item.to}
                                    className={`
                                        flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px
                                        ${isActive
                                            ? 'border-black text-black'
                                            : 'border-transparent text-gray-500 hover:text-black hover:border-gray-300'
                                        }
                                    `}
                                >
                                    <item.icon className="h-4 w-4" />
                                    {item.label}
                                </Link>
                            )
                        })}
                    </div>
                </div>
            </nav>

            {/* Content */}
            <main className="max-w-5xl mx-auto px-4 py-8">
                <Outlet />
            </main>
        </div>
    )
}

export default SporterLayout
