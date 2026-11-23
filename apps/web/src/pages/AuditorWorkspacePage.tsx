import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Plus } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/date';

interface AuditFindingRow {
  id: string;
  aiSystemId: string;
  aiSystemName: string;
  title: string;
  observation: string;
  severity: string;
  status: string;
  managementResponse: string;
  createdAt: string;
}

interface AuditLogRow {
  id: string;
  seq: number;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  rowHash: string;
  createdAt: string;
}

export function AuditorWorkspacePage() {
  const { session } = useAuth();
  const isAuditor = session?.user.role === 'auditor';

  const [aiSystemId, setAiSystemId] = useState('');
  const [title, setTitle] = useState('');
  const [observation, setObservation] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [responseDrafts, setResponseDrafts] = useState<Record<string, string>>({});
  const [verifyResult, setVerifyResult] = useState<{
    valid: boolean;
    totalRows: number;
    reason?: string;
  } | null>(null);

  const { data: sysData } = useQuery<{ aiSystems: Array<{ id: string; name: string }> }>({
    queryKey: ['ai-systems'],
    queryFn: () => apiFetch('/api/ai-systems')
  });

  const { data: findingsData, refetch: refetchFindings } = useQuery<{
    findings: AuditFindingRow[];
  }>({
    queryKey: ['audit-findings'],
    queryFn: () => apiFetch('/api/audit-findings')
  });

  const { data: logsData } = useQuery<{ logs: AuditLogRow[] }>({
    queryKey: ['audit-logs'],
    queryFn: () => apiFetch('/api/audit-logs?limit=100')
  });

  const handleCreateFinding = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetSys = aiSystemId || sysData?.aiSystems[0]?.id;
    if (!targetSys) return;
    await apiFetch('/api/audit-findings', {
      method: 'POST',
      body: JSON.stringify({ aiSystemId: targetSys, title, observation, severity })
    });
    setTitle('');
    setObservation('');
    await refetchFindings();
  };

  const handleRespond = async (id: string) => {
    const managementResponse = responseDrafts[id]?.trim();
    if (!managementResponse) return;
    await apiFetch(`/api/audit-findings/${id}/respond`, {
      method: 'POST',
      body: JSON.stringify({ managementResponse, status: 'responded' })
    });
    await refetchFindings();
  };

  const handleVerifyChain = async () => {
    const res = await apiFetch<{ valid: boolean; totalRows: number; reason?: string }>(
      '/api/audit-logs/verify',
      { method: 'POST' }
    );
    setVerifyResult(res);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Auditor Workspace</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Read-only oversight of FRAME assessments, independent Audit Findings, and tamper-evident
          audit log verification.
        </p>
      </div>

      {/* Add Finding (Auditor Only) */}
      {isAuditor && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Plus className="h-5 w-5 text-teal-700" />
            Record Audit Finding or Observation
          </h2>
          <form onSubmit={handleCreateFinding} className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium">AI System</label>
              <select
                value={aiSystemId || sysData?.aiSystems[0]?.id || ''}
                onChange={(e) => setAiSystemId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                {(sysData?.aiSystems ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium">Severity</label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium">Finding Title</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium">Observation</label>
              <textarea
                rows={3}
                required
                value={observation}
                onChange={(e) => setObservation(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
              >
                Record Finding
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Findings List */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-semibold">Audit Findings & Observations</h2>
        <div className="mt-3 space-y-3">
          {(findingsData?.findings ?? []).map((f) => (
            <div key={f.id} className="rounded-lg border border-slate-200 p-4 text-sm dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{f.title}</span>
                <div className="flex gap-2 text-xs">
                  <span className="rounded bg-amber-100 px-2 py-0.5 font-medium uppercase text-amber-900">
                    {f.severity}
                  </span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 capitalize dark:bg-slate-800">
                    {f.status.replace('_', ' ')}
                  </span>
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                System: {f.aiSystemName} | Recorded: {formatDateTime(f.createdAt)}
              </p>
              <p className="mt-2 text-slate-700 dark:text-slate-300">{f.observation}</p>
              {f.managementResponse ? (
                <div className="mt-3 rounded bg-slate-50 p-3 text-xs dark:bg-slate-800">
                  <strong>Management Response:</strong> {f.managementResponse}
                </div>
              ) : (
                !isAuditor && (
                  <div className="mt-3 flex gap-2">
                    <input
                      type="text"
                      placeholder="Add management response..."
                      value={responseDrafts[f.id] ?? ''}
                      onChange={(e) =>
                        setResponseDrafts((prev) => ({ ...prev, [f.id]: e.target.value }))
                      }
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                    />
                    <button
                      type="button"
                      onClick={() => handleRespond(f.id)}
                      className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white"
                    >
                      Respond
                    </button>
                  </div>
                )
              )}
            </div>
          ))}
          {(findingsData?.findings ?? []).length === 0 && (
            <p className="text-sm text-slate-500">No audit findings recorded.</p>
          )}
        </div>
      </section>

      {/* Audit Log & Integrity Check */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Tamper-Evident Audit Log</h2>
          <button
            type="button"
            onClick={handleVerifyChain}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-teal-800"
          >
            <ShieldCheck className="h-4 w-4" />
            Verify Hash Chain Integrity
          </button>
        </div>

        {verifyResult && (
          <div
            className={`mt-3 rounded-lg p-3 text-xs font-medium ${
              verifyResult.valid
                ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300'
            }`}
          >
            {verifyResult.valid
              ? `Integrity check PASSED across ${verifyResult.totalRows} audit log entries.`
              : `Integrity check FAILED: ${verifyResult.reason}`}
          </div>
        )}

        <div className="mt-4 max-h-96 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                <th className="py-2 pr-3">Seq</th>
                <th className="py-2 pr-3">Timestamp</th>
                <th className="py-2 pr-3">Role</th>
                <th className="py-2 pr-3">Action</th>
                <th className="py-2 pr-3">Entity</th>
                <th className="py-2">Row Hash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {(logsData?.logs ?? []).map((l) => (
                <tr key={l.id}>
                  <td className="py-2 pr-3 font-mono">{l.seq}</td>
                  <td className="py-2 pr-3">{formatDateTime(l.createdAt)}</td>
                  <td className="py-2 pr-3 capitalize">{l.actorRole}</td>
                  <td className="py-2 pr-3 font-medium">{l.action}</td>
                  <td className="py-2 pr-3">{l.entityType}</td>
                  <td className="py-2 font-mono text-[10px] text-slate-500">
                    {l.rowHash.slice(0, 16)}...
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
