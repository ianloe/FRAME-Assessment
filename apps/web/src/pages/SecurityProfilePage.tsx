import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { startRegistration } from '@simplewebauthn/browser';
import { KeyRound, Trash2, RefreshCw } from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/date';

interface PasskeyItem {
  id: string;
  friendlyName: string;
  deviceType: string;
  backedUp: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

interface SessionItem {
  id: string;
  ipAddress: string;
  userAgent: string;
  authMethod: string;
  lastActiveAt: string;
  createdAt: string;
  isCurrent: boolean;
}

export function SecurityProfilePage() {
  const { openStepUp, refetchSession } = useAuth();
  const [passkeyName, setPasskeyName] = useState('My Security Key');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [newRecoveryCodes, setNewRecoveryCodes] = useState<string[] | null>(null);

  const { data: passkeysData, refetch: refetchPasskeys } = useQuery<{ passkeys: PasskeyItem[] }>({
    queryKey: ['my-passkeys'],
    queryFn: () => apiFetch('/api/auth/passkeys')
  });

  const { data: sessionsData, refetch: refetchSessions } = useQuery<{ sessions: SessionItem[] }>({
    queryKey: ['my-sessions'],
    queryFn: () => apiFetch('/api/auth/sessions')
  });

  const addPasskey = async () => {
    setError('');
    setMessage('');
    try {
      const options = await apiFetch('/api/auth/passkey/register/options', { method: 'POST' });
      const att = await startRegistration({ optionsJSON: options as never });
      await apiFetch('/api/auth/passkey/register/verify', {
        method: 'POST',
        body: JSON.stringify({ response: att, friendlyName: passkeyName })
      });
      setMessage('Passkey registered.');
      await refetchPasskeys();
      await refetchSession();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const revokePasskey = async (id: string) => {
    setError('');
    try {
      await apiFetch(`/api/auth/passkeys/${id}`, { method: 'DELETE' });
      await refetchPasskeys();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') {
        openStepUp(() => void revokePasskey(id));
      } else {
        setError((err as Error).message);
      }
    }
  };

  const regenerateRecovery = async () => {
    setError('');
    try {
      const res = await apiFetch<{ recoveryCodes: string[] }>('/api/auth/mfa/recovery/regenerate', {
        method: 'POST'
      });
      setNewRecoveryCodes(res.recoveryCodes);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') {
        openStepUp(() => void regenerateRecovery());
      } else {
        setError((err as Error).message);
      }
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await apiFetch('/api/auth/password/change', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword })
      });
      setCurrentPassword('');
      setNewPassword('');
      setMessage('Password updated successfully.');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Security & Sessions</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Manage your passkeys, recovery codes, password, and active sessions.
        </p>
      </div>

      {message && (
        <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Passkeys */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <KeyRound className="h-5 w-5 text-teal-700" />
          Passkeys (WebAuthn / FIDO2)
        </h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <input
            type="text"
            value={passkeyName}
            onChange={(e) => setPasskeyName(e.target.value)}
            placeholder="Friendly name"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
          <button
            type="button"
            onClick={addPasskey}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
          >
            Add Passkey
          </button>
        </div>

        <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
          {(passkeysData?.passkeys ?? []).map((pk) => (
            <li key={pk.id} className="flex items-center justify-between py-3 text-sm">
              <div>
                <p className="font-medium">{pk.friendlyName}</p>
                <p className="text-xs text-slate-500">
                  Registered {formatDateTime(pk.createdAt)} | Last used:{' '}
                  {pk.lastUsedAt ? formatDateTime(pk.lastUsedAt) : 'Never'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => revokePasskey(pk.id)}
                className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Revoke
              </button>
            </li>
          ))}
          {(passkeysData?.passkeys ?? []).length === 0 && (
            <li className="py-3 text-sm text-slate-500">No passkeys registered yet.</li>
          )}
        </ul>
      </section>

      {/* Recovery Codes */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Recovery Codes</h2>
            <p className="text-xs text-slate-500">
              Regenerating invalidates any previously generated unused recovery codes.
            </p>
          </div>
          <button
            type="button"
            onClick={regenerateRecovery}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            <RefreshCw className="h-4 w-4" />
            Regenerate 10 codes
          </button>
        </div>
        {newRecoveryCodes && (
          <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-4 font-mono text-sm dark:bg-slate-800">
            {newRecoveryCodes.map((c) => (
              <div key={c}>{c}</div>
            ))}
          </div>
        )}
      </section>

      {/* Change Password */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-semibold">Change Password</h2>
        <form onSubmit={changePassword} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium">Current password</label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">New password (min 12 chars)</label>
            <input
              type="password"
              required
              minLength={12}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
            >
              Update password
            </button>
          </div>
        </form>
      </section>

      {/* Active Sessions */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-semibold">Active Sessions</h2>
        <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
          {(sessionsData?.sessions ?? []).map((s) => (
            <li key={s.id} className="flex items-center justify-between py-3 text-sm">
              <div>
                <p className="font-medium">
                  {s.authMethod.toUpperCase()} session {s.isCurrent ? '(Current)' : ''}
                </p>
                <p className="text-xs text-slate-500">
                  IP: {s.ipAddress || 'Unknown'} | Last active: {formatDateTime(s.lastActiveAt)}
                </p>
              </div>
              {!s.isCurrent && (
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch(`/api/auth/sessions/${s.id}`, { method: 'DELETE' });
                    await refetchSessions();
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-50 dark:border-slate-700"
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
