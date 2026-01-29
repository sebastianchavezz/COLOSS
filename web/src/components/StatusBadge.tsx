// StatusBadge component

interface StatusBadgeProps {
    status: string
    className?: string
}

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
    let colorClass = 'bg-gray-100 text-gray-800'

    switch (status.toLowerCase()) {
        case 'accepted':
        case 'checked_in':
        case 'paid':
        case 'issued':
            colorClass = 'bg-green-100 text-green-800'
            break
        case 'pending':
        case 'draft':
            colorClass = 'bg-yellow-100 text-yellow-800'
            break
        case 'cancelled':
        case 'voided':
        case 'rejected':
            colorClass = 'bg-red-100 text-red-800'
            break
        case 'expired':
            colorClass = 'bg-gray-100 text-gray-800'
            break
        default:
            colorClass = 'bg-gray-100 text-gray-800'
    }

    return (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass} ${className}`}>
            {status}
        </span>
    )
}
