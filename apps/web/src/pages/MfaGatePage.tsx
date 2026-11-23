import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { startRegistration } from '@simplewebauthn/browser';
import { KeyRound, Smartphone, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';

export function MfaGatePage() {
  const { session, refetchSession, logout } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');
  const [code, setCode] = useState('');
  const [setupData, setSetupData] = useState<{
    manualKey: string;
    qrDataUrl: string;
  } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [passkeyName, setPasskeyName] = useState('Work Device Passkey');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!session) return null;

  const startTotpEnrol = async () => {
    setError('');
    setBusy(true);
    try {
      const res = await apiFetch<{ manualKey: string; qrDataUrl: string }>(
        '/api/auth/mfa/totp/setup',
        { method: 'POST' }
      );
      setSetupData(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verifyTotpEnrol = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await apiFetch<{ recoveryCodes: string[] }>('/api/auth/mfa/totp/verify-setup', {
        method: 'POST',
        body: JSON.stringify({ code })
      });
      setRecoveryCodes(res.recoveryCodes);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const enrolPasskey = async () => {
    setError('');
    setBusy(true);
    try {
      const options = await apiFetch('/api/auth/passkey/register/options', { method: 'POST' });
      const attResp = await startRegistration({ optionsJSON: options as never });
      await apiFetch('/api/auth/passkey/register/verify', {
        method: 'POST',
        body: JSON.stringify({ response: attResp, friendlyName: passkeyName })
      });
      await refetchSession();
      navigate('/');
    } catch (err) {
      setError((err as Error).message || 'Passkey registration failed.');
    } finally {
      setBusy(false);
    }
  };

  const verifyMfaLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'totp') {
        await apiFetch('/api/auth/mfa/totp/verify', {
          method: 'POST',
          body: JSON.stringify({ code })
        });
      } else {
        await apiFetch('/api/auth/mfa/recovery/verify', {
          method: 'POST',
          body: JSON.stringify({ code })
        });
      }
      await refetchSession();
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (recoveryCodes) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4 dark:bg-slate-950">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            Save your recovery codes
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Store these 10 single-use recovery codes securely. They will not be shown again.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-sm dark:border-slate-700 dark:bg-slate-800">
            {recoveryCodes.map((rc) => (
              <div key={rc} className="text-center">
                {rc}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={async () => {
              await refetchSession();
              navigate('/');
            }}
            className="mt-6 w-full rounded-lg bg-[#1e3a5f] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#162d4a]"
          >
            I have saved my recovery codes, continue to dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4 dark:bg-slate-950">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-[#1e3a5f]" />
            <h1 className="text-xl font-bold">
              {session.hasMfaEnrolled ? 'Two-Factor Verification' : 'Enrol Multi-Factor Authentication'}
            </h1>
          </div>
          <button
            type="button"
            onClick={logout}
            className="text-xs text-slate-500 underline hover:text-slate-700"
          >
            Sign out
          </button>
        </div>

        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Signed in as <span className="font-medium">{session.user.email}</span>
        </p>

        {error && (
          <div role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {!session.hasMfaEnrolled ? (
          <div className="mt-6 space-y-6">
            {/* Option A: Passkey */}
            <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <div className="flex items-center gap-2 font-semibold">
                <KeyRound className="h-4 w-4 text-[#1e3a5f]" />
                Option 1: Register a Passkey (Recommended)
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Use Touch ID, Face ID, Windows Hello, or a hardware security key.
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={passkeyName}
                  onChange={(e) => setPasskeyName(e.target.value)}
                  placeholder="Passkey friendly name"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={enrolPasskey}
                  className="rounded-lg bg-[#1e3a5f] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#162d4a] disabled:opacity-50"
                >
                  Register Passkey
                </button>
              </div>
            </div>

            {/* Option B: TOTP */}
            <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <div className="flex items-center gap-2 font-semibold">
                <Smartphone className="h-4 w-4 text-[#1e3a5f]" />
                Option 2: Authenticator App (TOTP)
              </div>
              {!setupData ? (
                <button
                  type="button"
                  onClick={startTotpEnrol}
                  disabled={busy}
                  className="mt-3 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  Generate QR code
                </button>
              ) : (
                <form onSubmit={verifyTotpEnrol} className="mt-3 space-y-3">
                  <div className="flex flex-col items-center gap-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
                    <img src={setupData.qrDataUrl} alt="TOTP QR code" className="h-40 w-40 rounded bg-white p-1" />
                    <p className="text-xs text-slate-500">
                      Manual key: <code className="font-mono font-semibold">{setupData.manualKey}</code>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      inputMode="numeric"
                      pattern="\d{6}"
                      placeholder="Enter 6-digit code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                    />
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#162d4a]"
                    >
                      Verify & Activate
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={verifyMfaLogin} className="mt-6 space-y-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setMode('totp');
                  setCode('');
                }}
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium ${
                  mode === 'totp'
                    ? 'bg-[#1e3a5f] text-white'
                    : 'border border-slate-300 dark:border-slate-700'
                }`}
              >
                Authenticator Code
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('recovery');
                  setCode('');
                }}
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium ${
                  mode === 'recovery'
                    ? 'bg-[#1e3a5f] text-white'
                    : 'border border-slate-300 dark:border-slate-700'
                }`}
              >
                Recovery Code
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium">
                {mode === 'totp' ? '6-digit authenticator code' : 'Single-use recovery code'}
              </label>
              <input
                type="text"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={mode === 'totp' ? '123456' : 'XXXXX-XXXXX'}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-[#1e3a5f] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#162d4a] disabled:opacity-50"
            >
              {busy ? 'Verifying...' : 'Verify'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
