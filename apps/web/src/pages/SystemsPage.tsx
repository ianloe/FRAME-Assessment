import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Download, Upload, Search, RotateCcw, Sparkles } from 'lucide-react';
import { apiFetch, ApiError, downloadFile } from '../lib/api';
import { useAuth } from '../lib/auth';

interface AISystem {
  id: string;
  organisationId: string;
  organisationName: string;
  businessUnitId: string | null;
  businessUnitName: string;
  department: string;
  name: string;
  description: string;
  lifecycleStage: string;
  deploymentType: string;
  riskTier: string;
  targetMaturityLevel: number;
  regulatoryTags: string[];
  aaefReference: string;
  latestAssessmentStatus: string;
  latestOverallScore: number | null;
  completenessPercent: number;
  isDemo: boolean;
}

export function SystemsPage() {
  const { session, openStepUp } = useAuth();
  const canEdit = session?.user.role === 'admin' || session?.user.role === 'user';

  const [search, setSearch] = useState('');
  const [businessUnitId, setBusinessUnitId] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [riskTierFilter, setRiskTierFilter] = useState('');
  const [lifecycleFilter, setLifecycleFilter] = useState('');
  const [completenessFilter, setCompletenessFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResult, setAiResult] = useState<{ provider: string; model: string; insights: string } | null>(
    null
  );
  const [aiErr, setAiErr] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [csvText, setCsvText] = useState(
    'name,description,department,lifecycleStage,deploymentType,riskTier,targetMaturityLevel,aaefReference\n'
  );
  const [importPreview, setImportPreview] = useState<Array<{
    rowNumber: number;
    valid: boolean;
    data: unknown;
    errors: string[];
  }> | null>(null);

  const [form, setForm] = useState({
    organisationId: '',
    businessUnitId: '',
    department: '',
    name: '',
    description: '',
    lifecycleStage: 'pilot',
    deploymentType: 'copilot',
    vendorOrInhouse: 'in_house',
    riskTier: 'medium',
    targetMaturityLevel: 3,
    aaefReference: '',
    aaefUrl: ''
  });
  const [error, setError] = useState('');

  const { data: orgData } = useQuery<{
    organisations: Array<{ id: string; name: string }>;
    businessUnits: Array<{ id: string; organisationId: string; name: string; code: string }>;
  }>({
    queryKey: ['organisations'],
    queryFn: () => apiFetch('/api/organisations')
  });

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (businessUnitId) params.set('businessUnitId', businessUnitId);
  if (departmentFilter) params.set('department', departmentFilter);
  if (riskTierFilter) params.set('riskTier', riskTierFilter);
  if (lifecycleFilter) params.set('lifecycleStage', lifecycleFilter);
  if (completenessFilter) params.set('completeness', completenessFilter);
  if (statusFilter) params.set('assessmentStatus', statusFilter);

  const { data, isLoading, refetch } = useQuery<{ aiSystems: AISystem[] }>({
    queryKey: [
      'ai-systems',
      search,
      businessUnitId,
      departmentFilter,
      riskTierFilter,
      lifecycleFilter,
      completenessFilter,
      statusFilter
    ],
    queryFn: () => apiFetch(`/api/ai-systems?${params.toString()}`)
  });

  const resetFilters = () => {
    setSearch('');
    setBusinessUnitId('');
    setDepartmentFilter('');
    setRiskTierFilter('');
    setLifecycleFilter('');
    setCompletenessFilter('');
    setStatusFilter('');
  };

  const selectedOrgId = form.organisationId || orgData?.organisations[0]?.id || '';
  const availableBus = (orgData?.businessUnits ?? []).filter(
    (bu) => !selectedOrgId || bu.organisationId === selectedOrgId
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (!selectedOrgId) {
        setError('Please create an organisation in Administration first.');
        return;
      }
      await apiFetch('/api/ai-systems', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          organisationId: selectedOrgId,
          businessUnitId: form.businessUnitId || null
        })
      });
      setShowCreate(false);
      setForm({
        organisationId: '',
        businessUnitId: '',
        department: '',
        name: '',
        description: '',
        lifecycleStage: 'pilot',
        deploymentType: 'copilot',
        vendorOrInhouse: 'in_house',
        riskTier: 'medium',
        targetMaturityLevel: 3,
        aaefReference: '',
        aaefUrl: ''
      });
      await refetch();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleExportCsv = async () => {
    try {
      await downloadFile('/api/ai-systems/export/csv', 'frame-ai-systems.csv');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') {
        openStepUp(() => void handleExportCsv());
      }
    }
  };

  const handlePreviewCsv = async () => {
    const orgId = orgData?.organisations[0]?.id;
    if (!orgId) return;
    const res = await apiFetch<{ rows: typeof importPreview }>('/api/ai-systems/import-preview', {
      method: 'POST',
      body: JSON.stringify({ csvText, organisationId: orgId })
    });
    setImportPreview(res.rows);
  };

  const handleCommitImport = async () => {
    if (!importPreview) return;
    const validItems = importPreview.filter((r) => r.valid && r.data).map((r) => r.data);
    if (validItems.length === 0) return;
    await apiFetch('/api/ai-systems/import', {
      method: 'POST',
      body: JSON.stringify({ items: validItems })
    });
    setShowImport(false);
    setImportPreview(null);
    await refetch();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">AI System Register</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Inventory of AI deployments governed under FRAME and linked to AAEF evaluations.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setAiErr('');
              setShowAiModal(true);
            }}
            disabled={(data?.aiSystems ?? []).length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#1e3a5f] bg-slate-100 px-3 py-2 text-sm font-medium text-[#1e3a5f] hover:bg-slate-200 disabled:opacity-50 dark:bg-teal-950/40 dark:text-blue-300"
          >
            <Sparkles className="h-4 w-4" />
            AI Insights ({(data?.aiSystems ?? []).length})
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
          {canEdit && (
            <>
              <button
                type="button"
                onClick={() => setShowImport(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
              >
                <Upload className="h-4 w-4" />
                Import CSV
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#162d4a]"
              >
                <Plus className="h-4 w-4" />
                Register AI System
              </button>
            </>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="search"
            placeholder="Search name, dept, AAEF..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </div>

        <select
          aria-label="Filter by Business Unit"
          value={businessUnitId}
          onChange={(e) => setBusinessUnitId(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
        >
          <option value="">All Business Units</option>
          {(orgData?.businessUnits ?? []).map((bu) => (
            <option key={bu.id} value={bu.id}>
              {bu.name} {bu.code ? `(${bu.code})` : ''}
            </option>
          ))}
        </select>

        <input
          type="text"
          aria-label="Filter by Department"
          placeholder="Filter by Department..."
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
        />

        <select
          aria-label="Filter by Risk Tier"
          value={riskTierFilter}
          onChange={(e) => setRiskTierFilter(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
        >
          <option value="">All Risk Tiers</option>
          <option value="low">Low risk</option>
          <option value="medium">Medium risk</option>
          <option value="high">High risk</option>
          <option value="critical">Critical risk</option>
        </select>

        <select
          aria-label="Filter by Lifecycle Stage"
          value={lifecycleFilter}
          onChange={(e) => setLifecycleFilter(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
        >
          <option value="">All Lifecycle Stages</option>
          <option value="idea">Idea</option>
          <option value="pilot">Pilot</option>
          <option value="production">Production</option>
          <option value="retired">Retired</option>
        </select>

        <select
          aria-label="Filter by Completeness"
          value={completenessFilter}
          onChange={(e) => setCompletenessFilter(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
        >
          <option value="">All Completeness</option>
          <option value="not_started">Not started (0%)</option>
          <option value="in_progress">In progress (1% to 99%)</option>
          <option value="complete">Complete (100%)</option>
        </select>

        <select
          aria-label="Filter by Assessment Status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
        >
          <option value="">All Assessment Statuses</option>
          <option value="none">No assessment</option>
          <option value="draft">Draft</option>
          <option value="in_progress">In progress</option>
          <option value="submitted">Submitted</option>
          <option value="approved">Approved</option>
        </select>

        <button
          type="button"
          onClick={resetFilters}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset filters
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading AI systems...</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {(data?.aiSystems ?? []).map((sys) => (
            <Link
              key={sys.id}
              to={`/systems/${sys.id}`}
              className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 transition hover:border-[#1e3a5f] dark:border-slate-800 dark:bg-slate-900"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold text-slate-900 dark:text-white">{sys.name}</h2>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize dark:bg-slate-800">
                    {sys.riskTier}
                  </span>
                </div>
                {(sys.businessUnitName || sys.department) && (
                  <p className="mt-1 text-xs font-medium text-[#1e3a5f] dark:text-blue-400">
                    {[sys.businessUnitName, sys.department].filter(Boolean).join(' / ')}
                  </p>
                )}
                <p className="mt-2 line-clamp-2 text-xs text-slate-600 dark:text-slate-400">
                  {sys.description}
                </p>
              </div>

              <div className="mt-4 space-y-3">
                <div>
                  <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                    <span>
                      Assessment: <strong className="capitalize">{sys.latestAssessmentStatus.replace('_', ' ')}</strong>
                    </span>
                    <span>
                      {sys.latestOverallScore !== null
                        ? `Score ${sys.latestOverallScore.toFixed(2)}/4 | `
                        : ''}
                      {sys.completenessPercent}% complete
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-[#0072B2]"
                      style={{ width: `${sys.completenessPercent}%` }}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 text-xs">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[#1e3a5f] capitalize dark:bg-teal-950/60 dark:text-blue-300">
                    {sys.lifecycleStage}
                  </span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 capitalize dark:bg-slate-800">
                    {sys.deploymentType.replace('_', ' ')}
                  </span>
                  {sys.aaefReference && (
                    <span className="rounded bg-indigo-50 px-2 py-0.5 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300">
                      {sys.aaefReference}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
          {(data?.aiSystems ?? []).length === 0 && (
            <div className="col-span-full rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
              No AI systems match the current filters.
            </div>
          )}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <h2 className="text-lg font-bold">Register AI System</h2>
            <form onSubmit={handleCreate} className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium">Organisation</label>
                  <select
                    value={selectedOrgId}
                    onChange={(e) =>
                      setForm({ ...form, organisationId: e.target.value, businessUnitId: '' })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                  >
                    {(orgData?.organisations ?? []).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium">Business Unit</label>
                  <select
                    value={form.businessUnitId}
                    onChange={(e) => setForm({ ...form, businessUnitId: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                  >
                    <option value="">Not assigned</option>
                    {availableBus.map((bu) => (
                      <option key={bu.id} value={bu.id}>
                        {bu.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium">System Name</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium">Department</label>
                  <input
                    type="text"
                    placeholder="e.g. Customer Operations"
                    value={form.department}
                    onChange={(e) => setForm({ ...form, department: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium">Description</label>
                <textarea
                  required
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium">Lifecycle Stage</label>
                  <select
                    value={form.lifecycleStage}
                    onChange={(e) => setForm({ ...form, lifecycleStage: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                  >
                    <option value="idea">Idea</option>
                    <option value="pilot">Pilot</option>
                    <option value="production">Production</option>
                    <option value="retired">Retired</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium">Deployment Type</label>
                  <select
                    value={form.deploymentType}
                    onChange={(e) => setForm({ ...form, deploymentType: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                  >
                    <option value="assistant">Assistant</option>
                    <option value="copilot">Copilot</option>
                    <option value="autonomous_agent">Autonomous Agent</option>
                    <option value="multi_agent">Multi-Agent</option>
                    <option value="predictive_model">Predictive Model</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium">Risk Tier</label>
                  <select
                    value={form.riskTier}
                    onChange={(e) => setForm({ ...form, riskTier: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium">Target Maturity (1-4)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    max="4"
                    value={form.targetMaturityLevel}
                    onChange={(e) => setForm({ ...form, targetMaturityLevel: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium">AAEF Cross-Reference (optional)</label>
                <input
                  type="text"
                  placeholder="e.g. AAEF-CS-001 (Profile: Assisted Responder)"
                  value={form.aaefReference}
                  onChange={(e) => setForm({ ...form, aaefReference: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#162d4a]"
                >
                  Create System
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Multi-system AI Insights Modal */}
      {showAiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <Sparkles className="h-5 w-5 text-[#1e3a5f]" />
                Portfolio AI Governance Insights
              </h2>
              <button
                type="button"
                onClick={() => setShowAiModal(false)}
                className="rounded border border-slate-300 px-3 py-1 text-xs dark:border-slate-700"
              >
                Close
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Analyses up to 15 systems from your current filtered view ({Math.min(15, (data?.aiSystems ?? []).length)} selected).
            </p>
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="Optional focus (e.g. Compare high-risk systems and top remediation priorities)..."
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
              <button
                type="button"
                disabled={aiBusy}
                onClick={async () => {
                  setAiErr('');
                  setAiBusy(true);
                  try {
                    const ids = (data?.aiSystems ?? []).slice(0, 15).map((s) => s.id);
                    const res = await apiFetch<{
                      provider: string;
                      model: string;
                      insights: string;
                    }>('/api/ai-insights/generate', {
                      method: 'POST',
                      body: JSON.stringify({ aiSystemIds: ids, focusPrompt: aiPrompt || undefined })
                    });
                    setAiResult(res);
                  } catch (err) {
                    setAiErr((err as Error).message);
                  } finally {
                    setAiBusy(false);
                  }
                }}
                className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#162d4a] disabled:opacity-50"
              >
                {aiBusy ? 'Generating...' : 'Generate'}
              </button>
            </div>
            {aiErr && <p className="mt-3 text-xs text-red-600">{aiErr}</p>}
            {aiResult && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/50">
                <p className="mb-2 text-xs text-slate-500">
                  Generated by {aiResult.provider} ({aiResult.model})
                </p>
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                  {aiResult.insights}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <h2 className="text-lg font-bold">Bulk Import AI Systems (CSV)</h2>
            <textarea
              rows={6}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              className="mt-3 w-full rounded-lg border border-slate-300 p-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800"
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={handlePreviewCsv}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium dark:border-slate-700"
              >
                Validate Preview
              </button>
              {importPreview && (
                <button
                  type="button"
                  onClick={handleCommitImport}
                  className="rounded-lg bg-[#1e3a5f] px-3 py-1.5 text-sm font-medium text-white"
                >
                  Import Valid Rows ({importPreview.filter((r) => r.valid).length})
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowImport(false)}
                className="ml-auto rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700"
              >
                Close
              </button>
            </div>
            {importPreview && (
              <ul className="mt-3 space-y-1 text-xs">
                {importPreview.map((r) => (
                  <li key={r.rowNumber} className={r.valid ? 'text-[#1e3a5f]' : 'text-red-600'}>
                    Row {r.rowNumber}: {r.valid ? 'Valid' : r.errors.join(', ')}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
