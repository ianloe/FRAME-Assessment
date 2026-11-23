import React, { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';

export function ForgotPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const res = await apiFetch<{ message: string }>('/api/auth/password/forgot', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
    setMessage(res.message);
  };

  const handleCompleteReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/api/auth/password/reset', {
        method: 'POST',
        body: JSON.stringify({ token, password })
      });
      navigate('/login');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-xl font-bold">{token ? 'Reset Password' : 'Forgot Password'}</h1>

        {message && (
          <p className="mt-4 rounded-lg bg-teal-50 p-3 text-sm text-teal-800 dark:bg-teal-950/40 dark:text-teal-300">
            {message}
          </p>
        )}
        {error && (
          <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}

        {token ? (
          <form onSubmit={handleCompleteReset} className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium">New password (min 12 characters)</label>
              <input
                type="password"
                required
                minLength={12}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white"
            >
              Reset password
            </button>
          </form>
        ) : (
          <form onSubmit={handleRequestReset} className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium">Email address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white"
            >
              Send reset link
            </button>
          </form>
        )}

        <div className="mt-4 text-xs">
          <Link to="/login" className="text-teal-700 hover:underline dark:text-teal-400">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
