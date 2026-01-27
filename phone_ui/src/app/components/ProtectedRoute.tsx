import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Loader2 } from 'lucide-react'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { session, loading } = useAuth()
    const location = useLocation()

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center bg-white">
                <Loader2 className="h-8 w-8 animate-spin text-[#0047FF]" />
            </div>
        )
    }

    if (!session) {
        return <Navigate to="/login" state={{ from: location }} replace />
    }

    return <>{children}</>
}
