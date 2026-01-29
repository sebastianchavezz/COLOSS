/**
 * PublicHeader - Consistent header for public/consumer pages
 */

import { Link } from 'react-router-dom'
import { User } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

export function PublicHeader() {
    const { user } = useAuth()

    return (
        <header className="bg-white border-b border-gray-200">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
                <Link to="/" className="text-xl font-bold tracking-tight">
                    COLOSS
                </Link>

                <nav className="flex items-center gap-6">
                    <Link
                        to="/events"
                        className="text-sm text-gray-600 hover:text-black"
                    >
                        Events
                    </Link>

                    {user ? (
                        <Link
                            to="/my"
                            className="flex items-center gap-2 text-sm font-medium text-black"
                        >
                            <User className="h-4 w-4" />
                            Mijn Account
                        </Link>
                    ) : (
                        <Link
                            to="/login"
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-black rounded-lg hover:bg-gray-800"
                        >
                            Inloggen
                        </Link>
                    )}
                </nav>
            </div>
        </header>
    )
}

export default PublicHeader
