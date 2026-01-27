import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, Mail, Lock, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

import { authHelpers } from "@/lib/auth-helpers";

export function Login() {
    const navigate = useNavigate();
    const location = useLocation();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [isSignUp, setIsSignUp] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [mode, setMode] = useState<'magic_link' | 'password'>('magic_link');

    // Where to redirect after login (default to home)
    const from = location.state?.from?.pathname || "/";

    const handleGoogleLogin = async () => {
        try {
            setLoading(true);
            authHelpers.saveReturnTo(from);
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: `${window.location.origin}/auth/callback`,
                },
            });
            if (error) throw error;
        } catch (error: any) {
            setError(error.message);
            setLoading(false);
        }
    };

    const handleMagicLinkLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setLoading(true);
            authHelpers.saveReturnTo(from);
            const { error } = await supabase.auth.signInWithOtp({
                email,
                options: {
                    emailRedirectTo: `${window.location.origin}/auth/callback`,
                },
            });
            if (error) throw error;
            setMessage("Check your email for the login link!");
        } catch (error: any) {
            setError(error.message);
        } finally {
            setLoading(false);
        }
    };

    const handlePasswordAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            if (isSignUp) {
                const { error } = await supabase.auth.signUp({
                    email,
                    password,
                });
                if (error) throw error;
                setMessage("Account created! Please check your email to confirm.");
            } else {
                const { error } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });
                if (error) throw error;
                navigate(from, { replace: true });
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="h-full flex flex-col bg-white p-6">
            {/* Header */}
            <div className="flex items-center mb-8">
                <button
                    onClick={() => navigate(-1)}
                    className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center -ml-2"
                >
                    <ArrowLeft className="w-5 h-5 text-gray-600" />
                </button>
            </div>

            <div className="flex-1 flex flex-col justify-center max-w-sm mx-auto w-full">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">
                        {isSignUp ? "Create Account" : "Welcome Back"}
                    </h1>
                    <p className="text-gray-500">
                        {isSignUp
                            ? "Sign up to purchase tickets and manage your events."
                            : "Sign in to continue to checkout."}
                    </p>
                </div>

                {/* Google Login */}
                <button
                    onClick={handleGoogleLogin}
                    disabled={loading}
                    className="w-full py-3.5 bg-white border border-gray-200 text-gray-700 rounded-2xl font-semibold text-lg hover:bg-gray-50 active:scale-[0.98] transition-all flex items-center justify-center gap-2 mb-6"
                >
                    <svg className="h-5 w-5" viewBox="0 0 24 24">
                        <path
                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                            fill="#4285F4"
                        />
                        <path
                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                            fill="#34A853"
                        />
                        <path
                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                            fill="#FBBC05"
                        />
                        <path
                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                            fill="#EA4335"
                        />
                    </svg>
                    Continue with Google
                </button>

                <div className="relative mb-6">
                    <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-gray-200" />
                    </div>
                    <div className="relative flex justify-center text-sm">
                        <span className="px-2 bg-white text-gray-500">Or continue with email</span>
                    </div>
                </div>

                <form onSubmit={mode === 'magic_link' ? handleMagicLinkLogin : handlePasswordAuth} className="space-y-4">
                    <div className="space-y-4">
                        <div className="relative">
                            <Mail className="absolute left-4 top-3.5 w-5 h-5 text-gray-400" />
                            <input
                                type="email"
                                placeholder="Email address"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full pl-12 pr-4 py-3.5 bg-gray-50 rounded-2xl border-none focus:ring-2 focus:ring-[#0047FF] outline-none transition-all"
                                required
                            />
                        </div>

                        {mode === 'password' && (
                            <div className="relative">
                                <Lock className="absolute left-4 top-3.5 w-5 h-5 text-gray-400" />
                                <input
                                    type="password"
                                    placeholder="Password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full pl-12 pr-4 py-3.5 bg-gray-50 rounded-2xl border-none focus:ring-2 focus:ring-[#0047FF] outline-none transition-all"
                                    required
                                />
                            </div>
                        )}
                    </div>

                    {error && (
                        <div className="p-4 bg-red-50 text-red-600 text-sm rounded-2xl">
                            {error}
                        </div>
                    )}

                    {message && (
                        <div className="p-4 bg-green-50 text-green-600 text-sm rounded-2xl">
                            {message}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-4 bg-[#0047FF] text-white rounded-2xl font-semibold text-lg shadow-lg shadow-blue-500/30 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                    >
                        {loading && <Loader2 className="w-5 h-5 animate-spin" />}
                        {mode === 'magic_link' ? 'Send Magic Link' : (isSignUp ? "Sign Up" : "Sign In")}
                    </button>
                </form>

                <div className="mt-8 text-center space-y-4">
                    <button
                        type="button"
                        onClick={() => {
                            setMode(mode === 'magic_link' ? 'password' : 'magic_link');
                            setError(null);
                            setMessage(null);
                        }}
                        className="text-[#0047FF] font-semibold hover:underline"
                    >
                        {mode === 'magic_link' ? 'Use password instead' : 'Use magic link instead'}
                    </button>

                    {mode === 'password' && (
                        <p className="text-gray-500">
                            {isSignUp ? "Already have an account?" : "Don't have an account?"}
                            <button
                                onClick={() => setIsSignUp(!isSignUp)}
                                className="ml-2 text-[#0047FF] font-semibold hover:underline"
                            >
                                {isSignUp ? "Sign In" : "Sign Up"}
                            </button>
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
