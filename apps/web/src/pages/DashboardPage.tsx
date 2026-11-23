import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from 'recharts';
import { Download, CheckCircle2, AlertTriangle, ArrowUpRight } from 'lucide-react';
import { apiFetch, ApiError, downloadFile } from '../lib/api';
import { useAuth } from '../lib/auth';

interface DashboardResponse {
  summary: {
    totalAiSystems: number;
    totalAssessments: number;
    assessmentsByStatus: Record<string, number>;
    overdueReviews: number;
    openActions: number;
    evidenceNearingExpiry: number;
  };
  portfolioDimensionAverages: Array<{
    dimensionCode: string;
    dimensionName: string;
    averageScore: number;
  }>;
  heatmap: Array<{
    aiSystemId: string;
    name: string;
    riskTier: string;
    overallScore: number | null;
    dimensions: Record<string, number | null>;
  }>;
  trend: Array<{
    date: string;
    title: string;
    aiSystemName: string;
    overallScore: number;
  }>;
}

function scoreCellClass(score: number | null): string {
  if (score === null) return 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';
  if (score < 2.0) return 'bg-red-100 text-red-900 dark:bg-red-950/60 dark:text-red-200';
  if (score < 3.0) return 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200';
  if (score < 3.5) return 'bg-teal-100 text-teal-900 dark:bg-teal-950/60 dark:text-teal-200';
  return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200';
}

export function DashboardPage() {
  const { session, openStepUp } = useAuth();
  const [riskTier, setRiskTier] = useState('');
  const [lifecycleStage, setLifecycleStage] = useState('');
  const [organisationId, setOrganisationId] = useState('');

  const { data: orgData } = useQuery<{
    organisations: Array<{ id: string; name: string }>;
  }>({
    queryKey: ['organisations'],
    queryFn: () => apiFetch('/api/organisations')
  });

  const params = new URLSearchParams();
  if (riskTier) params.set('riskTier', riskTier);
  if (lifecycleStage) params.set('lifecycleStage', lifecycleStage);
  if (organisationId) params.set('organisationId', organisationId);

  const { data, isLoading } = useQuery<DashboardResponse>({
    queryKey: ['dashboard', riskTier, lifecycleStage, organisationId],
    queryFn: () => apiFetch(`/api/dashboard?${params.toString()}`)
  });

  const handleExportPortfolio = async () => {
    try {
      await downloadFile('/api/reports/portfolio/csv', 'frame-portfolio-report.csv');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') {
        openStepUp(() => void handleExportPortfolio());
      }
    }
  };

  if (isLoading || !data) {
    return <div className="p-6 text-sm text-slate-500">Loading governance portfolio...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Executive Governance Command Centre
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Evidence-based portfolio view across FRAME governance maturity, assessments, and
            remediation actions.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportPortfolio}
          className="inline-flex items-center gap-2 rounded-lg bg-[#1e3a5f] px-3.5 py-2 text-sm font-medium text-white hover:bg-[#162d4a] dark:bg-blue-600 dark:hover:bg-blue-700"
        >
          <Download className="h-4 w-4" />
          Export Portfolio CSV
        </button>
      </div>

      {/* First-run Admin Onboarding Checklist */}
      {session?.user.role === 'admin' && data.summary.totalAiSystems === 0 && (
        <div className="rounded-xl border border-teal-200 bg-slate-100/70 p-5 dark:border-teal-900 dark:bg-teal-950/30">
          <h2 className="font-semibold text-teal-900 dark:text-teal-200">
            First-Run Administrator Onboarding Checklist
          </h2>
          <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#1e3a5f]" />
              <span>MFA enrolled for Administrator account</span>
            </li>
            <li className="flex items-center gap-2">
              <Link to="/admin" className="text-[#1e3a5f] underline dark:text-blue-300">
                1. Create Organisation & Business Units in Administration
              </Link>
            </li>
            <li className="flex items-center gap-2">
              <Link to="/admin" className="text-[#1e3a5f] underline dark:text-blue-300">
                2. Invite Users, Reviewers, and Auditors
              </Link>
            </li>
            <li className="flex items-center gap-2">
              <Link to="/systems" className="text-[#1e3a5f] underline dark:text-blue-300">
                3. Register your first AI System and start a FRAME assessment
              </Link>
            </li>
          </ul>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <select
          aria-label="Filter by organisation"
          value={organisationId}
          onChange={(e) => setOrganisationId(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
        >
          <option value="">All organisations</option>
          {(orgData?.organisations ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by risk tier"
          value={riskTier}
          onChange={(e) => setRiskTier(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
        >
          <option value="">All risk tiers</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>

        <select
          aria-label="Filter by lifecycle stage"
          value={lifecycleStage}
          onChange={(e) => setLifecycleStage(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
        >
          <option value="">All lifecycle stages</option>
          <option value="idea">Idea</option>
          <option value="pilot">Pilot</option>
          <option value="production">Production</option>
          <option value="retired">Retired</option>
        </select>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Link
          to="/systems"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-slate-300 dark:border-slate-800 dark:bg-[#111827]"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>AI Systems</span>
            <ArrowUpRight className="h-3.5 w-3.5 text-slate-400" />
          </div>
          <p className="tabular-nums mt-1.5 text-2xl font-bold text-slate-900 dark:text-white">
            {data.summary.totalAiSystems}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">Registered in scope</p>
        </Link>
        <Link
          to="/assessments"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-slate-300 dark:border-slate-800 dark:bg-[#111827]"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Total Assessments</span>
            <ArrowUpRight className="h-3.5 w-3.5 text-slate-400" />
          </div>
          <p className="tabular-nums mt-1.5 text-2xl font-bold text-slate-900 dark:text-white">
            {data.summary.totalAssessments}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">5-Dimension Envelope</p>
        </Link>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
          <p className="text-xs font-medium text-slate-500">Approved</p>
          <p className="tabular-nums mt-1.5 text-2xl font-bold text-[#009E73]">
            {data.summary.assessmentsByStatus.approved ?? 0}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">Locked governance snapshots</p>
        </div>
        <Link
          to="/actions"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-slate-300 dark:border-slate-800 dark:bg-[#111827]"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Open Actions</span>
            <ArrowUpRight className="h-3.5 w-3.5 text-slate-400" />
          </div>
          <p className="tabular-nums mt-1.5 text-2xl font-bold text-slate-900 dark:text-white">
            {data.summary.openActions}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">Remediation tracker</p>
        </Link>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
          <p className="flex items-center gap-1 text-xs font-medium text-slate-500">
            <AlertTriangle className="h-3.5 w-3.5 text-[#E69F00]" />
            Overdue Reviews
          </p>
          <p className="tabular-nums mt-1.5 text-2xl font-bold text-[#D55E00]">
            {data.summary.overdueReviews}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">Requiring immediate oversight</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-base font-semibold">Portfolio Maturity by FRAME Dimension</h2>
          <p className="text-xs text-slate-500">Target for production deployments: 3.00 (Defined)</p>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={data.portfolioDimensionAverages}>
                <PolarGrid />
                <PolarAngleAxis dataKey="dimensionName" />
                <PolarRadiusAxis domain={[0, 4]} tickCount={5} />
                <Radar
                  name="Portfolio Average"
                  dataKey="averageScore"
                  stroke="#0072B2"
                  fill="#0072B2"
                  fillOpacity={0.3}
                />
                <Tooltip />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-base font-semibold">Maturity Trend Over Time</h2>
          <p className="text-xs text-slate-500">Overall FRAME score across assessment dates</p>
          <div className="mt-4 h-72">
            {data.trend.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                No scored assessments yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.trend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis domain={[0, 4]} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="overallScore"
                    name="Overall Score"
                    stroke="#0072B2"
                    strokeWidth={2.5}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Heatmap */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-semibold">AI Systems by Dimension Heatmap</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800">
                <th className="py-2 pr-4">AI System</th>
                <th className="px-3 py-2">Risk</th>
                <th className="px-3 py-2">Focus</th>
                <th className="px-3 py-2">Roles</th>
                <th className="px-3 py-2">Authority</th>
                <th className="px-3 py-2">Metrics</th>
                <th className="px-3 py-2">Evaluation</th>
                <th className="px-3 py-2">Overall</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.heatmap.map((row) => (
                <tr key={row.aiSystemId}>
                  <td className="py-2.5 pr-4 font-medium">
                    <Link
                      to={`/systems/${row.aiSystemId}`}
                      className="text-[#1e3a5f] hover:underline dark:text-blue-400"
                    >
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 capitalize">{row.riskTier}</td>
                  {(['FOCUS', 'ROLES', 'AUTHORITY', 'METRICS', 'EVALUATION'] as const).map((code) => {
                    const val = row.dimensions[code];
                    return (
                      <td key={code} className="px-2 py-2">
                        <span
                          className={`inline-block w-14 rounded px-2 py-0.5 text-center text-xs font-semibold ${scoreCellClass(val)}`}
                        >
                          {val !== null ? val.toFixed(2) : 'N/A'}
                        </span>
                      </td>
                    );
                  })}
                  <td className="px-2 py-2">
                    <span
                      className={`inline-block w-14 rounded px-2 py-0.5 text-center text-xs font-bold ${scoreCellClass(row.overallScore)}`}
                    >
                      {row.overallScore !== null ? row.overallScore.toFixed(2) : 'N/A'}
                    </span>
                  </td>
                </tr>
              ))}
              {data.heatmap.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-500">
                    No AI systems match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
