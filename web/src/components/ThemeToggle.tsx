/**
 * Theme Toggle Component
 *
 * A button to toggle between light and dark themes.
 * Shows sun/moon icon based on current theme.
 */

import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../contexts/ThemeContext'

interface ThemeToggleProps {
    className?: string
}

export function ThemeToggle({ className = '' }: ThemeToggleProps) {
    const { theme, toggleTheme } = useTheme()

    return (
        <button
            onClick={toggleTheme}
            className={`p-2 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-neutral-800 ${className}`}
            title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        >
            {theme === 'light' ? (
                <Moon className="h-5 w-5 text-gray-600 dark:text-gray-300" />
            ) : (
                <Sun className="h-5 w-5 text-yellow-500" />
            )}
        </button>
    )
}
