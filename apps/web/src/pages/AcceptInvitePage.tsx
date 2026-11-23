import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refetchSession } = useAuth();
  const token = params.get('token') ?? '';

  const [inviteInfo, setInviteInfo] = useState<{ name: string; email: string; role: string } | null>(
    null
  );
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [strength, setStrength] = useState<{
    acceptable: boolean;
    score: number;
    feedback: string[];
  } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('Missing invitation token.');
      return;
    }
    apiFetch<{ name: string; email: string; role: string }>(
      `/api/auth/invite/inspect?token=${encodeURIComponent(token)}`
    )
      .then(setInviteInfo)
      .catch((err) => setError((err as Error).message));
  }, [token]);

  useEffect(() => {
    if (!password) {
      setStrength(null);
      return;
    }
    const timer = setTimeout(() => {
      apiFetch<{ acceptable: boolean; score: number; feedback: string[] }>(
        '/api/auth/password/check-strength',
        {
          method: 'POST',
          body: JSON.stringify({
            password,
            hints: inviteInfo ? [inviteInfo.name, inviteInfo.email] : []
          })
        }
      )
        .then(setStrength)
        .catch(() => undefined);
    }, 200);
    return () => clearTimeout(timer);
  }, [password, inviteInfo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/api/auth/invite/accept', {
        method: 'POST',
        body: JSON.stringify({ token, password })
      });
      await refetchSession();
      navigate('/mfa');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-xl font-bold">Accept Invitation</h1>
        {inviteInfo ? (
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Welcome, <span className="font-medium">{inviteInfo.name}</span> ({inviteInfo.email}). Role:{' '}
            <span className="capitalize">{inviteInfo.role}</span>.
          </p>
        ) : null}

        {error && (
          <div role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {inviteInfo && (
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label className="block text-sm font-medium">Set password (minimum 12 characters)</label>
              <input
                type="password"
                required
                minLength={12}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
              {strength && (
                <div className="mt-2 space-y-1 text-xs">
                  <div className="flex gap-1">
                    {[0, 1, 2, 3].map((idx) => (
                      <div
                        key={idx}
                        className={`h-1.5 flex-1 rounded ${
                          idx < strength.score
                            ? strength.acceptable
                              ? 'bg-teal-600'
                              : 'bg-amber-500'
                            : 'bg-slate-200 dark:bg-slate-700'
                        }`}
                      />
                    ))}
                  </div>
                  {strength.feedback.map((f) => (
                    <p key={f} className="text-amber-700 dark:text-amber-400">
                      {f}
                    </p>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium">Confirm password</label>
              <input
                type="password"
                required
                minLength={12}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>

            <button
              type="submit"
              disabled={busy || !strength?.acceptable}
              className="w-full rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
            >
              {busy ? 'Activating account...' : 'Set password and continue to MFA setup'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
