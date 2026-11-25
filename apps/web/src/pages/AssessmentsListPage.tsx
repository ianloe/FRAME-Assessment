import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { formatDate } from '../lib/date';

interface AssessmentSummary {
  id: string;
  aiSystemId: string;
  aiSystemName: string;
  riskTier: string;
  title: string;
  scopeType: string;
  assessmentType: string;
  status: string;
  overallScore: number | null;
  assessmentDate: string;
}

export function AssessmentsListPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const { data, isLoading } = useQuery<{ assessments: AssessmentSummary[] }>({
    queryKey: ['assessments', statusFilter],
    queryFn: () =>
      apiFetch(`/api/assessments${statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : ''}`)
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">FRAME Assessments</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Active, submitted, and approved governance assessments across your scope.
          </p>
        </div>
        <select
          aria-label="Filter assessments by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="in_progress">In progress</option>
          <option value="submitted">Submitted</option>
          <option value="in_review">In review</option>
          <option value="changes_requested">Changes requested</option>
          <option value="approved">Approved</option>
        </select>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading assessments...</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800">
                <th className="px-4 py-3">Assessment</th>
                <th className="px-4 py-3">AI System</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {(data?.assessments ?? []).map((a) => (
                <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3 font-medium">
                    <Link
                      to={`/assessments/${a.id}`}
                      className="text-[#1e3a5f] hover:underline dark:text-blue-400"
                    >
                      {a.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{a.aiSystemName}</td>
                  <td className="px-4 py-3 capitalize">{a.assessmentType.replace('_', ' ')}</td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize dark:bg-slate-800">
                      {a.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-semibold">
                    {a.overallScore !== null ? `${a.overallScore.toFixed(2)} / 4` : 'Unscored'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(a.assessmentDate)}</td>
                </tr>
              ))}
              {(data?.assessments ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No assessments found. Open an AI system to start a new assessment.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
