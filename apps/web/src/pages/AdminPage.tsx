import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, UserPlus, Building2, FileText, Lock, Activity, Sparkles } from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/date';
import type { PermissionRule, Role } from '@frame/shared';

export function AdminPage() {
  const { openStepUp } = useAuth();
  const [tab, setTab] = useState<
    'users' | 'orgs' | 'matrix' | 'questionnaires' | 'security' | 'ai_insights' | 'health'
  >('users');
  const [viewAsRole, setViewAsRole] = useState<Role>('admin');

  // AI Insights Admin state
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiAllowOverride, setAiAllowOverride] = useState(true);
  const [aiProvider, setAiProvider] = useState('openrouter');
  const [aiModel, setAiModel] = useState('openai/gpt-4o-mini');
  const [aiBaseUrl, setAiBaseUrl] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');

  // Direct user creation form (initial password, no email sent)
  const [directName, setDirectName] = useState('');
  const [directEmail, setDirectEmail] = useState('');
  const [directPassword, setDirectPassword] = useState('');
  const [directRole, setDirectRole] = useState<Role>('user');
  const [directReviewer, setDirectReviewer] = useState(false);
  const [directOrgId, setDirectOrgId] = useState('');
  const [directMustChange, setDirectMustChange] = useState(true);

  // Invite form
  const [invName, setInvName] = useState('');
  const [invEmail, setInvEmail] = useState('');
  const [invRole, setInvRole] = useState<Role>('user');
  const [invReviewer, setInvReviewer] = useState(false);
  const [invOrgId, setInvOrgId] = useState('');
  const [lastInviteUrl, setLastInviteUrl] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Org & BU form
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [buOrgId, setBuOrgId] = useState('');
  const [buName, setBuName] = useState('');
  const [buCode, setBuCode] = useState('');

  const { data: usersData, refetch: refetchUsers } = useQuery<{
    users: Array<{
      id: string;
      name: string;
      email: string;
      role: Role;
      isReviewer: boolean;
      isActive: boolean;
      lastLoginAt: string | null;
    }>;
    invitations: Array<{
      id: string;
      name: string;
      email: string;
      role: string;
      expiresAt: string;
      acceptedAt: string | null;
      revokedAt: string | null;
    }>;
  }>({
    queryKey: ['admin-users'],
    queryFn: () => apiFetch('/api/admin/users')
  });

  const { data: orgData, refetch: refetchOrgs } = useQuery<{
    organisations: Array<{ id: string; name: string; slug: string }>;
    businessUnits: Array<{ id: string; organisationId: string; name: string; code: string }>;
  }>({
    queryKey: ['organisations'],
    queryFn: () => apiFetch('/api/organisations')
  });

  const { data: matrixData } = useQuery<{ matrix: PermissionRule[] }>({
    queryKey: ['admin-matrix'],
    queryFn: () => apiFetch('/api/admin/permissions-matrix'),
    enabled: tab === 'matrix'
  });

  const { data: qvData, refetch: refetchQvs } = useQuery<{
    questionnaires: Array<{
      id: string;
      versionLabel: string;
      status: string;
      notes: string;
      createdAt: string;
    }>;
  }>({
    queryKey: ['questionnaires'],
    queryFn: () => apiFetch('/api/questionnaires'),
    enabled: tab === 'questionnaires'
  });

  const { data: policyData, refetch: refetchPolicy } = useQuery<{
    mfaRequiredForAll: boolean;
    passkeyRequiredForAdmins: boolean;
    idleTimeoutMinutes: number;
    absoluteTimeoutHours: number;
    maxFailedLoginAttempts: number;
    lockoutMinutes: number;
    passwordMinLength: number;
    invitationExpiryHours: number;
    stepUpWindowMinutes: number;
  }>({
    queryKey: ['admin-security-policy'],
    queryFn: () => apiFetch('/api/admin/security-policy'),
    enabled: tab === 'security'
  });

  const { data: healthData } = useQuery<{
    status: string;
    version: string;
    database: string;
    storageDriver: string;
    uptimeSeconds: number;
  }>({
    queryKey: ['admin-health'],
    queryFn: () => apiFetch('/api/admin/health'),
    enabled: tab === 'health'
  });

  const { data: adminAiData, refetch: refetchAdminAi } = useQuery<{
    enabled: boolean;
    allowUserOverride: boolean;
    provider: string;
    model: string;
    baseUrl: string;
    hasApiKey: boolean;
    keyHint: string;
  }>({
    queryKey: ['admin-ai-insights'],
    queryFn: () => apiFetch('/api/admin/ai-insights'),
    enabled: tab === 'ai_insights'
  });

  useEffect(() => {
    if (adminAiData) {
      setAiEnabled(adminAiData.enabled);
      setAiAllowOverride(adminAiData.allowUserOverride);
      setAiProvider(adminAiData.provider);
      setAiModel(adminAiData.model);
      setAiBaseUrl(adminAiData.baseUrl);
    }
  }, [adminAiData]);

  const [verifyChainResult, setVerifyChainResult] = useState<{
    valid: boolean;
    totalRows: number;
    reason?: string;
  } | null>(null);

  const handleCreateUserDirect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await apiFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          name: directName,
          email: directEmail,
          password: directPassword,
          role: directRole,
          isReviewer: directReviewer,
          mustChangePassword: directMustChange,
          organisationIds: directOrgId ? [directOrgId] : []
        })
      });
      setDirectName('');
      setDirectEmail('');
      setDirectPassword('');
      setDirectReviewer(false);
      setMessage('User created directly with initial password (no email sent).');
      await refetchUsers();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') {
        openStepUp(() => void handleCreateUserDirect(e));
      } else {
        setError((err as Error).message);
      }
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const res = await apiFetch<{ inviteUrl: string }>('/api/admin/invitations', {
        method: 'POST',
        body: JSON.stringify({
          name: invName,
          email: invEmail,
          role: invRole,
          isReviewer: invReviewer,
          organisationIds: invOrgId ? [invOrgId] : []
        })
      });
      setLastInviteUrl(res.inviteUrl);
      setInvName('');
      setInvEmail('');
      setMessage('Invitation created and email queued.');
      await refetchUsers();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') {
        openStepUp(() => void handleInvite(e));
      } else {
        setError((err as Error).message);
      }
    }
  };

  const handleResetMfa = async (userId: string) => {
    const reason = window.prompt('Enter mandatory audit reason for resetting MFA/passkeys:');
    if (!reason || reason.trim().length < 5) return;
    try {
      await apiFetch(`/api/admin/users/${userId}/reset-mfa`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
      setMessage('User MFA and passkeys reset (audited).');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') {
        openStepUp(() => void handleResetMfa(userId));
      } else {
        setError((err as Error).message);
      }
    }
  };

  const handleToggleActive = async (userId: string, isActive: boolean) => {
    try {
      await apiFetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !isActive })
      });
      await refetchUsers();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') {
        openStepUp(() => void handleToggleActive(userId, isActive));
      }
    }
  };

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/organisations', {
      method: 'POST',
      body: JSON.stringify({ name: orgName, slug: orgSlug })
    });
    setOrgName('');
    setOrgSlug('');
    await refetchOrgs();
  };

  const handleCloneQv = async (id: string) => {
    const label = window.prompt('New draft version label (e.g. FRAME v1.1):');
    if (!label) return;
    await apiFetch(`/api/questionnaires/${id}/clone`, {
      method: 'POST',
      body: JSON.stringify({ versionLabel: label })
    });
    await refetchQvs();
  };

  const handlePublishQv = async (id: string) => {
    await apiFetch(`/api/questionnaires/${id}/publish`, { method: 'POST', body: JSON.stringify({}) });
    await refetchQvs();
  };

  const handleRemoveDemoData = async () => {
    try {
      await apiFetch('/api/admin/demo-data', { method: 'DELETE' });
      setMessage('Demo data removed.');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') {
        openStepUp(() => void handleRemoveDemoData());
      }
    }
  };

  const tabs = [
    { id: 'users', label: 'Users & Invitations', icon: UserPlus },
    { id: 'orgs', label: 'Organisations', icon: Building2 },
    { id: 'matrix', label: 'View as Role Matrix', icon: ShieldCheck },
    { id: 'questionnaires', label: 'Questionnaires', icon: FileText },
    { id: 'security', label: 'Security Policy', icon: Lock },
    { id: 'ai_insights', label: 'AI Insights', icon: Sparkles },
    { id: 'health', label: 'Health & Integrity', icon: Activity }
  ] as const;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Administration</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Manage users, scopes, FRAME questionnaire versions, security policy, and system health.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${
                tab === t.id
                  ? 'bg-[#1e3a5f] text-white'
                  : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {message && (
        <div className="rounded-lg bg-slate-100 p-3 text-sm text-[#1e3a5f] dark:bg-teal-950/40 dark:text-blue-300">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {tab === 'users' && (
        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-lg font-semibold">Create User Directly (Initial Password, No Email)</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Creates an active user immediately with an initial password. They will enrol MFA on
              first sign-in.
            </p>
            <form onSubmit={handleCreateUserDirect} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <input
                type="text"
                required
                placeholder="Full name"
                value={directName}
                onChange={(e) => setDirectName(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
              <input
                type="email"
                required
                placeholder="Email address"
                value={directEmail}
                onChange={(e) => setDirectEmail(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
              <input
                type="password"
                required
                minLength={12}
                placeholder="Initial password (min 12 chars)"
                value={directPassword}
                onChange={(e) => setDirectPassword(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
              <select
                value={directRole}
                onChange={(e) => setDirectRole(e.target.value as Role)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="user">User</option>
                <option value="auditor">Auditor</option>
                <option value="admin">Admin</option>
              </select>
              <select
                value={directOrgId}
                onChange={(e) => setDirectOrgId(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="">Scope: All / None</option>
                {(orgData?.organisations ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#162d4a]"
              >
                Create User
              </button>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={directReviewer}
                  onChange={(e) => setDirectReviewer(e.target.checked)}
                />
                Grant Reviewer flag
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={directMustChange}
                  onChange={(e) => setDirectMustChange(e.target.checked)}
                />
                Require password change on next login
              </label>
            </form>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-lg font-semibold">Invite New User (Email Link)</h2>
            <form onSubmit={handleInvite} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <input
                type="text"
                required
                placeholder="Full name"
                value={invName}
                onChange={(e) => setInvName(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
              <input
                type="email"
                required
                placeholder="Email address"
                value={invEmail}
                onChange={(e) => setInvEmail(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
              <select
                value={invRole}
                onChange={(e) => setInvRole(e.target.value as Role)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="user">User</option>
                <option value="auditor">Auditor</option>
                <option value="admin">Admin</option>
              </select>
              <select
                value={invOrgId}
                onChange={(e) => setInvOrgId(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="">Scope: All / None</option>
                {(orgData?.organisations ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#162d4a]"
              >
                Send Invitation
              </button>
              <label className="flex items-center gap-2 text-xs sm:col-span-2">
                <input
                  type="checkbox"
                  checked={invReviewer}
                  onChange={(e) => setInvReviewer(e.target.checked)}
                />
                Grant Reviewer flag (may approve assessments authored by others)
              </label>
            </form>
            {lastInviteUrl && (
              <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800">
                <strong>One-time invitation link:</strong>{' '}
                <code className="break-all font-mono">{lastInviteUrl}</code>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-lg font-semibold">Users</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800">
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Email</th>
                    <th className="py-2 pr-4">Role</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(usersData?.users ?? []).map((u) => (
                    <tr key={u.id}>
                      <td className="py-2.5 pr-4 font-medium">{u.name}</td>
                      <td className="py-2.5 pr-4">{u.email}</td>
                      <td className="py-2.5 pr-4 capitalize">
                        {u.role}
                        {u.isReviewer && u.role === 'user' ? ' (Reviewer)' : ''}
                      </td>
                      <td className="py-2.5 pr-4">{u.isActive ? 'Active' : 'Disabled'}</td>
                      <td className="flex flex-wrap gap-2 py-2.5 text-xs">
                        <button
                          type="button"
                          onClick={() => handleToggleActive(u.id, u.isActive)}
                          className="rounded border border-slate-300 px-2 py-1 dark:border-slate-700"
                        >
                          {u.isActive ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResetMfa(u.id)}
                          className="rounded border border-slate-300 px-2 py-1 dark:border-slate-700"
                        >
                          Reset MFA
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            apiFetch(`/api/admin/users/${u.id}/force-logout`, { method: 'POST' })
                          }
                          className="rounded border border-slate-300 px-2 py-1 dark:border-slate-700"
                        >
                          Force Sign-Out
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {tab === 'orgs' && (
        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-lg font-semibold">Create Organisation</h2>
            <form onSubmit={handleCreateOrg} className="mt-3 flex flex-wrap gap-3">
              <input
                type="text"
                required
                placeholder="Organisation Name"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
              <input
                type="text"
                required
                placeholder="slug-name"
                value={orgSlug}
                onChange={(e) => setOrgSlug(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
              <button
                type="submit"
                className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-semibold text-white"
              >
                Create
              </button>
            </form>
            <ul className="mt-4 divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {(orgData?.organisations ?? []).map((o) => (
                <li key={o.id} className="py-2">
                  <strong>{o.name}</strong> <span className="text-xs text-slate-500">({o.slug})</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-lg font-semibold">Business Units</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const targetOrg = buOrgId || orgData?.organisations[0]?.id;
                if (!targetOrg) return;
                await apiFetch(`/api/organisations/${targetOrg}/business-units`, {
                  method: 'POST',
                  body: JSON.stringify({ name: buName, code: buCode })
                });
                setBuName('');
                setBuCode('');
                await refetchOrgs();
              }}
              className="mt-3 flex flex-wrap gap-3"
            >
              <select
                value={buOrgId || orgData?.organisations[0]?.id || ''}
                onChange={(e) => setBuOrgId(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                {(orgData?.organisations ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                required
                placeholder="Business Unit Name"
                value={buName}
                onChange={(e) => setBuName(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
              <input
                type="text"
                placeholder="Code (e.g. RB-01)"
                value={buCode}
                onChange={(e) => setBuCode(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
              <button
                type="submit"
                className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-semibold text-white"
              >
                Add Business Unit
              </button>
            </form>
            <ul className="mt-4 divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {(orgData?.businessUnits ?? []).map((bu) => (
                <li key={bu.id} className="py-2">
                  <strong>{bu.name}</strong>{' '}
                  {bu.code && <span className="text-xs text-slate-500">({bu.code})</span>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {tab === 'matrix' && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Live RBAC Permissions Matrix</h2>
              <p className="text-xs text-slate-500">
                Generated directly from server permission definitions so documentation never drifts
                from code.
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span>Highlight role:</span>
              <select
                value={viewAsRole}
                onChange={(e) => setViewAsRole(e.target.value as Role)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="admin">Admin</option>
                <option value="user">User</option>
                <option value="auditor">Auditor</option>
              </select>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                  <th className="py-2 pr-4">Capability</th>
                  <th className={`px-3 py-2 ${viewAsRole === 'admin' ? 'bg-slate-100 dark:bg-teal-950/40' : ''}`}>
                    Admin
                  </th>
                  <th className={`px-3 py-2 ${viewAsRole === 'user' ? 'bg-slate-100 dark:bg-teal-950/40' : ''}`}>
                    User
                  </th>
                  <th className={`px-3 py-2 ${viewAsRole === 'auditor' ? 'bg-slate-100 dark:bg-teal-950/40' : ''}`}>
                    Auditor
                  </th>
                  <th className="py-2 pl-4">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {(matrixData?.matrix ?? []).map((row) => (
                  <tr key={row.permission}>
                    <td className="py-2 pr-4 font-medium">{row.label}</td>
                    <td className={`px-3 py-2 ${viewAsRole === 'admin' ? 'bg-slate-100/50 font-semibold dark:bg-teal-950/20' : ''}`}>
                      {row.admin}
                    </td>
                    <td className={`px-3 py-2 ${viewAsRole === 'user' ? 'bg-slate-100/50 font-semibold dark:bg-teal-950/20' : ''}`}>
                      {row.user}
                    </td>
                    <td className={`px-3 py-2 ${viewAsRole === 'auditor' ? 'bg-slate-100/50 font-semibold dark:bg-teal-950/20' : ''}`}>
                      {row.auditor}
                    </td>
                    <td className="py-2 pl-4 text-slate-500">{row.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'questionnaires' && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-lg font-semibold">FRAME Questionnaire Versions</h2>
          <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
            {(qvData?.questionnaires ?? []).map((q) => (
              <div key={q.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <p className="font-semibold">
                    {q.versionLabel}{' '}
                    <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs uppercase dark:bg-slate-800">
                      {q.status}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {q.notes} | Created {formatDateTime(q.createdAt)}
                  </p>
                </div>
                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => handleCloneQv(q.id)}
                    className="rounded border border-slate-300 px-3 py-1.5 dark:border-slate-700"
                  >
                    Clone to Draft
                  </button>
                  {q.status === 'draft' && (
                    <button
                      type="button"
                      onClick={() => handlePublishQv(q.id)}
                      className="rounded bg-[#1e3a5f] px-3 py-1.5 font-medium text-white"
                    >
                      Publish
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === 'security' && policyData && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-lg font-semibold">Security & MFA Policy</h2>
          <p className="mt-1 text-xs text-slate-500">
            MFA cannot be disabled for Administrator accounts.
          </p>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <span className="text-xs text-slate-500">MFA Required for All Users</span>
              <p className="font-semibold">{policyData.mfaRequiredForAll ? 'Yes (Enabled)' : 'Optional'}</p>
            </div>
            <div>
              <span className="text-xs text-slate-500">Passkey Required for Admins</span>
              <p className="font-semibold">{policyData.passkeyRequiredForAdmins ? 'Yes' : 'No'}</p>
            </div>
            <div>
              <span className="text-xs text-slate-500">Session Idle Timeout</span>
              <p className="font-semibold">{policyData.idleTimeoutMinutes} minutes</p>
            </div>
            <div>
              <span className="text-xs text-slate-500">Session Absolute Timeout</span>
              <p className="font-semibold">{policyData.absoluteTimeoutHours} hours</p>
            </div>
            <div>
              <span className="text-xs text-slate-500">Failed Login Lockout</span>
              <p className="font-semibold">
                {policyData.maxFailedLoginAttempts} attempts ({policyData.lockoutMinutes} min base)
              </p>
            </div>
            <div>
              <span className="text-xs text-slate-500">Invitation Expiry</span>
              <p className="font-semibold">{policyData.invitationExpiryHours} hours</p>
            </div>
          </div>
          <button
            type="button"
            onClick={async () => {
              try {
                await apiFetch('/api/admin/security-policy', {
                  method: 'PUT',
                  body: JSON.stringify({
                    ...policyData,
                    passkeyRequiredForAdmins: !policyData.passkeyRequiredForAdmins
                  })
                });
                await refetchPolicy();
              } catch (err) {
                if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') {
                  openStepUp();
                }
              }
            }}
            className="mt-4 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium dark:border-slate-700"
          >
            Toggle Passkey Required for Admins
          </button>
        </section>
      )}

      {tab === 'ai_insights' && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="h-5 w-5 text-[#1e3a5f]" />
            AI Insights Configuration
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Configure the default LLM provider for generating FRAME governance insights across AI
            systems. API keys are encrypted at rest with AES-256-GCM.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError('');
              setMessage('');
              try {
                await apiFetch('/api/admin/ai-insights', {
                  method: 'PUT',
                  body: JSON.stringify({
                    enabled: aiEnabled,
                    allowUserOverride: aiAllowOverride,
                    provider: aiProvider,
                    model: aiModel,
                    baseUrl: aiBaseUrl,
                    apiKey: aiApiKey || undefined
                  })
                });
                setAiApiKey('');
                setMessage('AI Insights configuration saved.');
                await refetchAdminAi();
              } catch (err) {
                if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') {
                  openStepUp();
                } else {
                  setError((err as Error).message);
                }
              }
            }}
            className="mt-4 grid gap-4 sm:grid-cols-2"
          >
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={aiEnabled}
                onChange={(e) => setAiEnabled(e.target.checked)}
              />
              Enable AI Insights globally
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={aiAllowOverride}
                onChange={(e) => setAiAllowOverride(e.target.checked)}
              />
              Allow users to configure their own LLM provider/key in My Security
            </label>
            <div>
              <label className="block text-xs font-medium">LLM Provider</label>
              <select
                value={aiProvider}
                onChange={(e) => {
                  const p = e.target.value;
                  setAiProvider(p);
                  const defaults: Record<string, string> = {
                    openrouter: 'openai/gpt-4o-mini',
                    gemini: 'gemini-2.5-flash',
                    openai: 'gpt-4o-mini',
                    anthropic: 'claude-3-5-sonnet-latest',
                    'agnes-ai': 'agnes-default',
                    deepseek: 'deepseek-chat',
                    custom: 'local-model'
                  };
                  setAiModel(defaults[p] ?? '');
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
              <label className="block text-xs font-medium">Model Identifier</label>
              <input
                type="text"
                required
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-medium">Base URL (optional / required for custom)</label>
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
                API Key {adminAiData?.hasApiKey ? `(saved: ${adminAiData.keyHint})` : ''}
              </label>
              <input
                type="password"
                placeholder={adminAiData?.hasApiKey ? 'Leave blank to keep existing key' : 'Enter API key'}
                value={aiApiKey}
                onChange={(e) => setAiApiKey(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#162d4a]"
              >
                Save AI Insights Configuration
              </button>
            </div>
          </form>
        </section>
      )}

      {tab === 'health' && (
        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-lg font-semibold">System Health & Audit Chain</h2>
            {healthData && (
              <div className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
                <div>
                  <span className="text-xs text-slate-500">Status</span>
                  <p className="font-semibold capitalize">{healthData.status}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-500">Database</span>
                  <p className="font-semibold capitalize">{healthData.database}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-500">Storage Driver</span>
                  <p className="font-semibold capitalize">{healthData.storageDriver}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-500">Uptime</span>
                  <p className="font-semibold">{healthData.uptimeSeconds}s</p>
                </div>
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={async () => {
                  const res = await apiFetch<{ valid: boolean; totalRows: number; reason?: string }>(
                    '/api/audit-logs/verify',
                    { method: 'POST' }
                  );
                  setVerifyChainResult(res);
                }}
                className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-xs font-semibold text-white"
              >
                Verify Audit Log Hash Chain
              </button>
              <button
                type="button"
                onClick={handleRemoveDemoData}
                className="rounded-lg border border-red-300 px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-50"
              >
                Remove Demo Data
              </button>
            </div>
            {verifyChainResult && (
              <p className="mt-3 text-xs font-medium">
                {verifyChainResult.valid
                  ? `Hash chain valid across ${verifyChainResult.totalRows} entries.`
                  : `Hash chain INVALID: ${verifyChainResult.reason}`}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
