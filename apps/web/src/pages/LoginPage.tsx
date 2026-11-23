import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { startAuthentication } from '@simplewebauthn/browser';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';

export function LoginPage() {
  const navigate = useNavigate();
  const { refetchSession } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await apiFetch<{
        mfaVerified: boolean;
        requiresMfaEnrolment: boolean;
      }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      await refetchSession();
      if (!res.mfaVerified) {
        navigate('/mfa');
      } else {
        navigate('/');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setError('');
    setBusy(true);
    try {
      const options = await apiFetch<{ challenge: string }>('/api/auth/passkey/login/options', {
        method: 'POST'
      });
      const assertion = await startAuthentication({ optionsJSON: options as never });
      await apiFetch('/api/auth/passkey/login/verify', {
        method: 'POST',
        body: JSON.stringify({ response: assertion, challenge: options.challenge })
      });
      await refetchSession();
      navigate('/');
    } catch (err) {
      setError((err as Error).message || 'Passkey sign-in failed or was cancelled.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-6 flex items-center gap-3">
          <img
            src="/frame-logo.png"
            alt="FRAME logo"
            className="h-11 w-11 rounded-xl object-contain"
          />
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              FRAME Assessment Platform
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Enterprise AI Governance Sign-In
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handlePasskeyLogin}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-teal-700 bg-teal-50 px-4 py-2.5 text-sm font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-50 dark:border-teal-600 dark:bg-teal-950/50 dark:text-teal-300 dark:hover:bg-teal-950"
        >
          <KeyRound className="h-4 w-4" />
          Sign in with a passkey
        </button>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
          <span className="text-xs font-medium uppercase text-slate-400">or with password</span>
          <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
        </div>

        <form onSubmit={handlePasswordLogin} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Email address
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
          >
            {busy ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <div className="mt-5 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5 text-teal-600" />
            Invite-only access
          </span>
          <Link to="/forgot-password" className="text-teal-700 hover:underline dark:text-teal-400">
            Forgot password?
          </Link>
        </div>
      </div>
    </div>
  );
}
