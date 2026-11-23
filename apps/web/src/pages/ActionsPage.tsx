import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/date';

interface ActionRow {
  id: string;
  aiSystemId: string;
  aiSystemName: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  dueDate: string | null;
  closureNotes: string;
}

export function ActionsPage() {
  const { session } = useAuth();
  const canEdit = session?.user.role === 'admin' || session?.user.role === 'user';
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading, refetch } = useQuery<{ actions: ActionRow[] }>({
    queryKey: ['actions'],
    queryFn: () => apiFetch('/api/actions')
  });

  const handleStatusChange = async (id: string, status: string) => {
    await apiFetch(`/api/actions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    await refetch();
  };

  const filtered = (data?.actions ?? []).filter(
    (a) => !statusFilter || a.status === statusFilter
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Remediation Actions Register</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Track governance actions arising from FRAME assessments and cycle reviews.
          </p>
        </div>
        <select
          aria-label="Filter actions by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
          <option value="overdue">Overdue</option>
        </select>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading actions...</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((act) => (
            <div
              key={act.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="max-w-2xl">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold uppercase dark:bg-slate-800">
                    {act.priority}
                  </span>
                  <span className="text-xs text-slate-500">{act.aiSystemName}</span>
                </div>
                <h2 className="mt-1 font-semibold">{act.title}</h2>
                {act.description && (
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    {act.description}
                  </p>
                )}
                <p className="mt-1 text-xs text-slate-500">Due: {formatDate(act.dueDate)}</p>
              </div>

              <select
                disabled={!canEdit}
                value={act.status}
                onChange={(e) => handleStatusChange(act.id, e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm capitalize dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="completed">Completed</option>
                <option value="overdue">Overdue</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
              No remediation actions match the current filter.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
