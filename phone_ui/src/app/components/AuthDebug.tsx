import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

export function AuthDebug() {
    const { session, user } = useAuth()
    const [isOpen, setIsOpen] = useState(false)

    if (!import.meta.env.DEV) return null

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-20 right-4 bg-gray-800 text-white p-2 rounded-full text-xs opacity-50 hover:opacity-100 z-50"
            >
                Auth Debug
            </button>
        )
    }

    return (
        <div className="fixed bottom-20 right-4 w-64 bg-gray-900 text-white p-4 rounded-lg shadow-xl z-50 text-xs font-mono overflow-auto max-h-[40vh]">
            <div className="flex justify-between items-center mb-2">
                <h3 className="font-bold text-green-400">Auth Debug</h3>
                <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-white">✕</button>
            </div>

            <div className="space-y-2">
                <div>
                    <span className="text-gray-500">Status:</span>{' '}
                    <span className={session ? 'text-green-400' : 'text-red-400'}>
                        {session ? 'Authenticated' : 'Signed Out'}
                    </span>
                </div>

                {user && (
                    <>
                        <div>
                            <span className="text-gray-500">Email:</span><br />
                            {user.email}
                        </div>
                        <div>
                            <span className="text-gray-500">Role:</span><br />
                            {user.role}
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
