import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

export default function AuthDebug() {
    const { session, user } = useAuth()
    const [isOpen, setIsOpen] = useState(false)

    if (!import.meta.env.DEV) return null

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-4 right-4 bg-gray-800 text-white p-2 rounded-full text-xs opacity-50 hover:opacity-100 z-50"
            >
                Auth Debug
            </button>
        )
    }

    return (
        <div className="fixed bottom-4 right-4 w-96 bg-gray-900 text-white p-4 rounded-lg shadow-xl z-50 text-xs font-mono overflow-auto max-h-[50vh]">
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
                            <span className="text-gray-500">User ID:</span><br />
                            {user.id}
                        </div>
                        <div>
                            <span className="text-gray-500">Email:</span><br />
                            {user.email}
                        </div>
                        <div>
                            <span className="text-gray-500">Role:</span><br />
                            {user.role}
                        </div>
                        <div>
                            <span className="text-gray-500">Last Sign In:</span><br />
                            {user.last_sign_in_at}
                        </div>
                    </>
                )}

                <div className="pt-2 border-t border-gray-700">
                    <div className="text-gray-500 mb-1">Session Token (first 20 chars):</div>
                    <div className="break-all text-gray-400">
                        {session?.access_token?.substring(0, 20)}...
                    </div>
                </div>
            </div>
        </div>
    )
}
