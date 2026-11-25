import React, { createContext, useContext, useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, setCsrfToken } from './api';
import type { Role } from '@frame/shared';

export interface AuthSession {
  user: {
    id: string;
    name: string;
    email: string;
    role: Role;
    isReviewer: boolean;
    mustChangePassword: boolean;
  };
  csrfToken: string;
  mfaVerified: boolean;
  hasTotpEnrolled: boolean;
  hasMfaEnrolled: boolean;
  hasPasskeyEnrolled: boolean;
  mfaMandatory: boolean;
  passkeyRequiredForAdmin: boolean;
  stepUpValid: boolean;
}

interface AuthContextValue {
  session: AuthSession | null;
  isLoading: boolean;
  refetchSession: () => Promise<void>;
  logout: () => Promise<void>;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  openStepUp: (onSuccess?: () => void) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('frame_theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpCallback, setStepUpCallback] = useState<(() => void) | null>(null);
  const [stepUpPassword, setStepUpPassword] = useState('');
  const [stepUpCode, setStepUpCode] = useState('');
  const [stepUpError, setStepUpError] = useState('');
  const [stepUpBusy, setStepUpBusy] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('frame_theme', theme);
  }, [theme]);

  const { data, isLoading, refetch } = useQuery<AuthSession | null>({
    queryKey: ['auth-me'],
    queryFn: async () => {
      try {
        const res = await apiFetch<AuthSession>('/api/auth/me');
        setCsrfToken(res.csrfToken);
        return res;
      } catch {
        return null;
      }
    },
    retry: false,
    staleTime: 30_000
  });

  const refetchSession = async () => {
    await refetch();
  };

  const logout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setCsrfToken('');
    queryClient.setQueryData(['auth-me'], null);
    queryClient.clear();
  };

  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));

  const openStepUp = (onSuccess?: () => void) => {
    setStepUpPassword('');
    setStepUpCode('');
    setStepUpError('');
    setStepUpCallback(() => onSuccess ?? null);
    setStepUpOpen(true);
  };

  const handleStepUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStepUpError('');
    setStepUpBusy(true);
    try {
      await apiFetch('/api/auth/step-up/verify', {
        method: 'POST',
        body: JSON.stringify({ password: stepUpPassword, totpCode: stepUpCode || undefined })
      });
      await refetch();
      setStepUpOpen(false);
      if (stepUpCallback) {
        stepUpCallback();
        setStepUpCallback(null);
      }
    } catch (err) {
      setStepUpError((err as Error).message);
    } finally {
      setStepUpBusy(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session: data ?? null,
        isLoading,
        refetchSession,
        logout,
        theme,
        toggleTheme,
        openStepUp
      }}
    >
      {children}
      {stepUpOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="stepup-title"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <h2 id="stepup-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Confirm your identity
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              This sensitive action requires step-up re-authentication.
            </p>
            <form onSubmit={handleStepUpSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={stepUpPassword}
                  onChange={(e) => setStepUpPassword(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Authenticator code (if TOTP is enrolled)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="6-digit code"
                  value={stepUpCode}
                  onChange={(e) => setStepUpCode(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              {stepUpError && (
                <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                  {stepUpError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setStepUpOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={stepUpBusy}
                  className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#162d4a] disabled:opacity-50"
                >
                  {stepUpBusy ? 'Verifying...' : 'Verify'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
