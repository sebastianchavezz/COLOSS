import React from 'react'

interface Column<T> {
    header: string
    accessor: (item: T) => React.ReactNode
    className?: string
}

interface DataTableProps<T> {
    data: T[]
    columns: Column<T>[]
    onRowClick?: (item: T) => void
    keyExtractor: (item: T) => string
    emptyMessage?: string
}

export function DataTable<T>({
    data,
    columns,
    onRowClick,
    keyExtractor,
    emptyMessage = 'No data found'
}: DataTableProps<T>) {
    if (data.length === 0) {
        return (
            <div className="text-center py-8 text-gray-500 bg-white rounded-lg border border-gray-200">
                {emptyMessage}
            </div>
        )
    }

    return (
        <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                    <tr>
                        {columns.map((col, idx) => (
                            <th
                                key={idx}
                                scope="col"
                                className={`px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider ${col.className || ''}`}
                            >
                                {col.header}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {data.map((item) => (
                        <tr
                            key={keyExtractor(item)}
                            onClick={() => onRowClick && onRowClick(item)}
                            className={onRowClick ? 'cursor-pointer hover:bg-gray-50 transition-colors' : ''}
                        >
                            {columns.map((col, idx) => (
                                <td
                                    key={idx}
                                    className={`px-6 py-4 whitespace-nowrap text-sm text-gray-900 ${col.className || ''}`}
                                >
                                    {col.accessor(item)}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
