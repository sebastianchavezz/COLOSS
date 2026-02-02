/**
 * Global Theme Toggle
 *
 * Fixed position theme toggle button that appears on all pages.
 * Positioned in the top-right corner.
 */

import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../contexts/ThemeContext'

export function GlobalThemeToggle() {
    const { theme, toggleTheme } = useTheme()

    return (
        <button
            onClick={toggleTheme}
            className="fixed top-4 right-4 z-50 p-2.5 rounded-full
                       bg-card border border-border shadow-lg
                       transition-all duration-200
                       hover:scale-110 hover:shadow-xl
                       focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            title={theme === 'light' ? 'Donkere modus' : 'Lichte modus'}
            aria-label={theme === 'light' ? 'Schakel naar donkere modus' : 'Schakel naar lichte modus'}
        >
            {theme === 'light' ? (
                <Moon className="h-5 w-5 text-foreground-secondary" />
            ) : (
                <Sun className="h-5 w-5 text-yellow-400" />
            )}
        </button>
    )
}
