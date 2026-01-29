// ResultCard component

interface ResultCardProps {
    result: {
        success: boolean
        reason: string
        message?: string
        checked_in_at?: string
        ticket_instance_id?: string
    } | null
}

export function ResultCard({ result }: ResultCardProps) {
    if (!result) return null

    let bgColor = 'bg-gray-50'
    let borderColor = 'border-gray-200'
    let textColor = 'text-gray-800'
    let icon = '?'

    if (result.success) {
        if (result.reason === 'ok') {
            bgColor = 'bg-green-50'
            borderColor = 'border-green-200'
            textColor = 'text-green-800'
            icon = '✓'
        } else if (result.reason === 'already_checked_in') {
            bgColor = 'bg-yellow-50'
            borderColor = 'border-yellow-200'
            textColor = 'text-yellow-800'
            icon = '⚠️'
        }
    } else {
        bgColor = 'bg-red-50'
        borderColor = 'border-red-200'
        textColor = 'text-red-800'
        icon = '✗'
    }

    return (
        <div className={`mt-4 p-4 rounded-lg border ${bgColor} ${borderColor} ${textColor}`}>
            <div className="flex items-start">
                <div className="flex-shrink-0 text-2xl mr-3">{icon}</div>
                <div>
                    <h3 className="font-bold text-lg capitalize">
                        {result.reason.replace(/_/g, ' ')}
                    </h3>
                    {result.message && (
                        <p className="mt-1 text-sm opacity-90">{result.message}</p>
                    )}
                    {result.checked_in_at && (
                        <p className="mt-2 text-xs opacity-75">
                            Time: {new Date(result.checked_in_at).toLocaleString()}
                        </p>
                    )}
                </div>
            </div>
        </div>
    )
}
