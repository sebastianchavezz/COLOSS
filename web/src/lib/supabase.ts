import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// =========================================
// STARTUP SANITY CHECKS
// =========================================

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
        '❌ Missing Supabase environment variables.\n' +
        'Ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in web/.env'
    )
}

// Check for common key format mistake: using new "sb_" format instead of legacy JWT
if (supabaseAnonKey.startsWith('sb_')) {
    console.error(
        '⚠️ VITE_SUPABASE_ANON_KEY appears to be in the new "sb_" format.\n' +
        'This codebase expects the legacy JWT format (starts with "eyJ...").\n' +
        'Go to Supabase Dashboard → Project Settings → API → Copy the "anon" key that starts with "eyJ".'
    )
    throw new Error('Invalid SUPABASE_ANON_KEY format. Expected JWT (eyJ...), got sb_ format.')
}

// Validate it looks like a JWT (3 base64 segments separated by dots)
const jwtParts = supabaseAnonKey.split('.')
if (jwtParts.length !== 3 || !supabaseAnonKey.startsWith('eyJ')) {
    console.error(
        '⚠️ VITE_SUPABASE_ANON_KEY does not appear to be a valid JWT.\n' +
        'Expected format: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ...\n' +
        'Go to Supabase Dashboard → Project Settings → API → Copy the "anon" public key.'
    )
    throw new Error('Invalid SUPABASE_ANON_KEY format. Expected a valid JWT.')
}

console.log('✅ Supabase client config:', {
    url: supabaseUrl,
    anonKeyStart: supabaseAnonKey.slice(0, 30) + '...',
})

// =========================================
// CREATE SINGLETON CLIENT
// Explicit options for auth persistence
// =========================================

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        persistSession: true,
        storage: window.sessionStorage, // Use sessionStorage instead of localStorage
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'coloss-auth',
    },
})

console.log('✅ Supabase client initialized')
