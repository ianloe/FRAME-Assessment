import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { startRegistration } from '@simplewebauthn/browser';
import { KeyRound, Trash2, RefreshCw, Smartphone, Sparkles } from 'lucide-react';
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

const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  openrouter: 'openai/gpt-4o-mini',
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-latest',
  'agnes-ai': 'agnes-default',
  deepseek: 'deepseek-chat',
  custom: 'local-model'
};

export function SecurityProfilePage() {
  const { session, openStepUp, refetchSession } = useAuth();
  const [passkeyName, setPasskeyName] = useState('My Security Key');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [newRecoveryCodes, setNewRecoveryCodes] = useState<string[] | null>(null);

  // TOTP Enrolment state
  const [totpSetup, setTotpSetup] = useState<{ manualKey: string; qrDataUrl: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');

  // Personal AI Insights LLM override state
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiProvider, setAiProvider] = useState('openrouter');
  const [aiModel, setAiModel] = useState('openai/gpt-4o-mini');
  const [aiBaseUrl, setAiBaseUrl] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');

  const { data: passkeysData, refetch: refetchPasskeys } = useQuery<{ passkeys: PasskeyItem[] }>({
    queryKey: ['my-passkeys'],
    queryFn: () => apiFetch('/api/auth/passkeys')
  });

  const { data: sessionsData, refetch: refetchSessions } = useQuery<{ sessions: SessionItem[] }>({
    queryKey: ['my-sessions'],
    queryFn: () => apiFetch('/api/auth/sessions')
  });

  const { data: aiCfgData, refetch: refetchAiCfg } = useQuery<{
    globalEnabled: boolean;
    allowUserOverride: boolean;
    userConfig: {
      enabled: boolean;
      provider: string;
      model: string;
      baseUrl: string;
      hasApiKey: boolean;
      keyHint: string;
    };
  }>({
    queryKey: ['user-ai-config'],
    queryFn: () => apiFetch('/api/ai-insights/config')
  });

  useEffect(() => {
    if (aiCfgData?.userConfig) {
      setAiEnabled(aiCfgData.userConfig.enabled);
      setAiProvider(aiCfgData.userConfig.provider);
      setAiModel(aiCfgData.userConfig.model);
      setAiBaseUrl(aiCfgData.userConfig.baseUrl);
    }
  }, [aiCfgData]);

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

  const startTotpSetup = async () => {
    setError('');
    setMessage('');
    try {
      const res = await apiFetch<{ manualKey: string; qrDataUrl: string }>(
        '/api/auth/mfa/totp/setup',
        { method: 'POST' }
      );
      setTotpSetup(res);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const verifyTotpSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await apiFetch<{ recoveryCodes: string[] }>('/api/auth/mfa/totp/verify-setup', {
        method: 'POST',
        body: JSON.stringify({ code: totpCode })
      });
      setTotpSetup(null);
      setTotpCode('');
      setNewRecoveryCodes(res.recoveryCodes);
      setMessage('Authenticator App (TOTP) enrolled. Please save your recovery codes below.');
      await refetchSession();
    } catch (err) {
      setError((err as Error).message);
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

  const savePersonalAiConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await apiFetch('/api/ai-insights/user-config', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: aiEnabled,
          provider: aiProvider,
          model: aiModel,
          baseUrl: aiBaseUrl,
          apiKey: aiApiKey || undefined
        })
      });
      setAiApiKey('');
      setMessage('Personal AI Insights LLM configuration saved.');
      await refetchAiCfg();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Security & Sessions</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Manage your passkeys, authenticator app (TOTP), recovery codes, password, sessions, and
          personal LLM configuration.
        </p>
      </div>

      {message && (
        <div className="rounded-lg border border-teal-200 bg-slate-100 p-3 text-sm text-[#1e3a5f] dark:border-teal-900 dark:bg-teal-950/40 dark:text-blue-300">
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
          <KeyRound className="h-5 w-5 text-[#1e3a5f]" />
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
            className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#162d4a]"
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

      {/* Authenticator App (TOTP) */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Smartphone className="h-5 w-5 text-[#1e3a5f]" />
              Authenticator App (TOTP)
            </h2>
            <p className="text-xs text-slate-500">
              Status:{' '}
              <strong className={session?.hasTotpEnrolled ? 'text-[#1e3a5f] dark:text-blue-400' : ''}>
                {session?.hasTotpEnrolled ? 'Enrolled' : 'Not enrolled'}
              </strong>{' '}
              (You can use both Passkeys and an Authenticator App.)
            </p>
          </div>
          {!totpSetup && (
            <button
              type="button"
              onClick={startTotpSetup}
              className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#162d4a]"
            >
              {session?.hasTotpEnrolled ? 'Reconfigure TOTP' : 'Enrol Authenticator App'}
            </button>
          )}
        </div>

        {totpSetup && (
          <form onSubmit={verifyTotpSetup} className="mt-4 space-y-3">
            <div className="flex flex-col items-center gap-2 rounded-lg bg-slate-50 p-4 dark:bg-slate-800">
              <img src={totpSetup.qrDataUrl} alt="TOTP QR code" className="h-40 w-40 rounded bg-white p-1" />
              <p className="text-xs text-slate-500">
                Manual key: <code className="font-mono font-semibold">{totpSetup.manualKey}</code>
              </p>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                required
                inputMode="numeric"
                pattern="\d{6}"
                placeholder="Enter 6-digit code"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
              <button
                type="submit"
                className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#162d4a]"
              >
                Verify & Activate
              </button>
              <button
                type="button"
                onClick={() => setTotpSetup(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
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

      {/* Personal AI Insights LLM Configuration (when allowed by Admin) */}
      {(aiCfgData?.allowUserOverride || session?.user.role === 'admin') && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="h-5 w-5 text-[#1e3a5f]" />
            My AI Insights LLM Configuration
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Configure your personal LLM provider (OpenRouter, Gemini, OpenAI, Anthropic, Agnes-AI,
            DeepSeek, or a custom OpenAI-compatible endpoint). API keys are encrypted at rest.
          </p>
          <form onSubmit={savePersonalAiConfig} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={aiEnabled}
                onChange={(e) => setAiEnabled(e.target.checked)}
              />
              Use my personal LLM configuration for AI Insights
            </label>
            <div>
              <label className="block text-xs font-medium">Provider</label>
              <select
                value={aiProvider}
                onChange={(e) => {
                  const p = e.target.value;
                  setAiProvider(p);
                  setAiModel(PROVIDER_DEFAULT_MODELS[p] ?? '');
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="openrouter">OpenRouter</option>
                <option value="gemini">Google Gemini</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="agnes-ai">Agnes-AI</option>
                <option value="deepseek">DeepSeek</option>
                <option value="custom">Custom OpenAI-Compatible LLM</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium">Model</label>
              <input
                type="text"
                required
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-medium">Custom Base URL (optional / for custom)</label>
              <input
                type="url"
                placeholder="https://..."
                value={aiBaseUrl}
                onChange={(e) => setAiBaseUrl(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-medium">
                API Key {aiCfgData?.userConfig.hasApiKey ? `(saved: ${aiCfgData.userConfig.keyHint})` : ''}
              </label>
              <input
                type="password"
                placeholder={aiCfgData?.userConfig.hasApiKey ? 'Leave blank to keep existing key' : 'Enter API key'}
                value={aiApiKey}
                onChange={(e) => setAiApiKey(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#162d4a]"
              >
                Save Personal LLM Settings
              </button>
            </div>
          </form>
        </section>
      )}

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
              className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#162d4a]"
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
