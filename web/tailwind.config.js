/** @type {import('tailwindcss').Config} */
export default {
    darkMode: 'class',
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                'sans': ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
                'heading': ['Panchang', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
                'panchang': ['Panchang', 'sans-serif'],
                'albert': ['"Albert Sans"', 'sans-serif'],
                'elegant': ['"Cormorant Garamond"', 'Georgia', 'serif'],
            },
            colors: {
                // Semantic colors using CSS variables (best practice for dark mode)
                background: {
                    DEFAULT: 'rgb(var(--background) / <alpha-value>)',
                    secondary: 'rgb(var(--background-secondary) / <alpha-value>)',
                    tertiary: 'rgb(var(--background-tertiary) / <alpha-value>)',
                },
                foreground: {
                    DEFAULT: 'rgb(var(--foreground) / <alpha-value>)',
                    secondary: 'rgb(var(--foreground-secondary) / <alpha-value>)',
                    muted: 'rgb(var(--foreground-muted) / <alpha-value>)',
                },
                card: {
                    DEFAULT: 'rgb(var(--card) / <alpha-value>)',
                    foreground: 'rgb(var(--card-foreground) / <alpha-value>)',
                },
                border: {
                    DEFAULT: 'rgb(var(--border) / <alpha-value>)',
                    secondary: 'rgb(var(--border-secondary) / <alpha-value>)',
                },
                input: {
                    DEFAULT: 'rgb(var(--input) / <alpha-value>)',
                    border: 'rgb(var(--input-border) / <alpha-value>)',
                },
                primary: {
                    DEFAULT: 'rgb(var(--primary) / <alpha-value>)',
                    foreground: 'rgb(var(--primary-foreground) / <alpha-value>)',
                },
                secondary: {
                    DEFAULT: 'rgb(var(--secondary) / <alpha-value>)',
                    foreground: 'rgb(var(--secondary-foreground) / <alpha-value>)',
                },
                muted: {
                    DEFAULT: 'rgb(var(--muted) / <alpha-value>)',
                    foreground: 'rgb(var(--muted-foreground) / <alpha-value>)',
                },
                accent: {
                    DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
                    foreground: 'rgb(var(--accent-foreground) / <alpha-value>)',
                },
                destructive: {
                    DEFAULT: 'rgb(var(--destructive) / <alpha-value>)',
                    foreground: 'rgb(var(--destructive-foreground) / <alpha-value>)',
                },
                success: {
                    DEFAULT: 'rgb(var(--success) / <alpha-value>)',
                    foreground: 'rgb(var(--success-foreground) / <alpha-value>)',
                },
                warning: {
                    DEFAULT: 'rgb(var(--warning) / <alpha-value>)',
                    foreground: 'rgb(var(--warning-foreground) / <alpha-value>)',
                },
                ring: 'rgb(var(--ring) / <alpha-value>)',
                // Legacy COLOSS colors (keep for backwards compatibility)
                'coloss': {
                    'blue': '#0052ff',
                    'dark': '#2c3446',
                    'light': '#EDEDED',
                    'offwhite': '#f5f5f5',
                    'gray-light': '#e8eaed',
                    'muted-gray': '#8a8f99',
                }
            },
            borderRadius: {
                lg: 'var(--radius)',
                md: 'calc(var(--radius) - 2px)',
                sm: 'calc(var(--radius) - 4px)',
            },
        },
    },
    plugins: [],
}
