/** @type {import('tailwindcss').Config} */
export default {
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
            },
            colors: {
                'coloss': {
                    'blue': '#0052ff',
                    'dark': '#2c3446',
                    'light': '#EDEDED',
                    'offwhite': '#f5f5f5',
                    'gray-light': '#e8eaed',
                    'muted-gray': '#8a8f99',
                }
            }
        },
    },
    plugins: [],
}
