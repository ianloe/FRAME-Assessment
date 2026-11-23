import React, { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Copy, CheckSquare, ExternalLink, FileDown } from 'lucide-react';
import { apiFetch, ApiError, downloadFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/date';

interface SystemDetailData {
  aiSystem: {
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
    vendorOrInhouse: string;
    modelAndPlatform: string;
    dataClassification: string;
    regulatoryTags: string[];
    riskTier: string;
    targetMaturityLevel: number;
    aaefReference: string;
    aaefUrl: string;
  };
  assessments: Array<{
    id: string;
    title: string;
    status: string;
    scopeType: string;
    assessmentType: string;
    overallScore: number | null;
    assessmentDate: string;
  }>;
  actions: Array<{
    id: string;
    title: string;
    priority: string;
    status: string;
    dueDate: string | null;
  }>;
  checklists: Array<{
    id: string;
    section: string;
    title: string;
    itemsJson: Array<{
      code: string;
      sectionGroup: string;
      text: string;
      status: 'pending' | 'complete' | 'na';
      namedIndividual?: string;
      notes?: string;
    }>;
  }>;
}

export function SystemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session, openStepUp } = useAuth();
  const canEdit = session?.user.role === 'admin' || session?.user.role === 'user';

  const [showNewAssessment, setShowNewAssessment] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [scopeType, setScopeType] = useState<'full' | 'partial'>('full');
  const [selectedDims, setSelectedDims] = useState<string[]>([
    'FOCUS',
    'ROLES',
    'AUTHORITY',
    'METRICS',
    'EVALUATION'
  ]);
  const [assessmentType, setAssessmentType] = useState('pre_deployment');
  const [checklistSection, setChecklistSection] = useState<
    'pre_deployment' | 'operational_30d' | 'operational_90d' | 'quarterly'
  >('pre_deployment');
  const [showEditSys, setShowEditSys] = useState(false);
  const [editBuId, setEditBuId] = useState('');
  const [editDept, setEditDept] = useState('');
  const [editRisk, setEditRisk] = useState('');
  const [editStage, setEditStage] = useState('');

  const { data: orgData } = useQuery<{
    businessUnits: Array<{ id: string; organisationId: string; name: string }>;
  }>({
    queryKey: ['organisations'],
    queryFn: () => apiFetch('/api/organisations')
  });

  const { data, isLoading, refetch } = useQuery<SystemDetailData>({
    queryKey: ['ai-system', id],
    queryFn: () => apiFetch(`/api/ai-systems/${id}`),
    enabled: Boolean(id)
  });

  if (isLoading || !data) {
    return <div className="p-6 text-sm text-slate-500">Loading AI system details...</div>;
  }

  const sys = data.aiSystem;

  const handleCreateAssessment = async (e: React.FormEvent) => {
    e.preventDefault();
    const created = await apiFetch<{ id: string }>('/api/assessments', {
      method: 'POST',
      body: JSON.stringify({
        aiSystemId: sys.id,
        title: newTitle || `${sys.name} Assessment`,
        scopeType,
        selectedDimensions: scopeType === 'full' ? ['FOCUS', 'ROLES', 'AUTHORITY', 'METRICS', 'EVALUATION'] : selectedDims,
        assessmentType
      })
    });
    setShowNewAssessment(false);
    navigate(`/assessments/${created.id}`);
  };

  const handleCloneAssessment = async (sourceId: string, sourceTitle: string) => {
    const cloned = await apiFetch<{ id: string }>(`/api/assessments/${sourceId}/clone`, {
      method: 'POST',
      body: JSON.stringify({ title: `${sourceTitle} (Periodic Review)` })
    });
    navigate(`/assessments/${cloned.id}`);
  };

  const handleStartChecklist = async () => {
    await apiFetch(`/api/ai-systems/${sys.id}/checklists`, {
      method: 'POST',
      body: JSON.stringify({ section: checklistSection })
    });
    await refetch();
  };

  const handleToggleChecklistItem = async (
    runId: string,
    items: SystemDetailData['checklists'][number]['itemsJson'],
    code: string,
    nextStatus: 'pending' | 'complete' | 'na'
  ) => {
    const updated = items.map((item) => (item.code === code ? { ...item, status: nextStatus } : item));
    await apiFetch(`/api/checklists/${runId}`, {
      method: 'PUT',
      body: JSON.stringify({ itemsJson: updated })
    });
    await refetch();
  };

  const handleExportSystemPdf = async () => {
    try {
      await downloadFile(`/api/reports/systems/${sys.id}/pdf`, `frame-system-${sys.id.slice(0, 8)}.pdf`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') {
        openStepUp(() => void handleExportSystemPdf());
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{sys.name}</h1>
            <span className="rounded bg-slate-100 px-2.5 py-0.5 text-xs font-semibold uppercase dark:bg-slate-800">
              {sys.riskTier} risk
            </span>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
            {sys.description}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleExportSystemPdf}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
          >
            <FileDown className="h-4 w-4" />
            Export System PDF (A4)
          </button>
          {canEdit && (
            <>
              <button
                type="button"
                onClick={() => {
                  setEditBuId(sys.businessUnitId ?? '');
                  setEditDept(sys.department ?? '');
                  setEditRisk(sys.riskTier);
                  setEditStage(sys.lifecycleStage);
                  setShowEditSys(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
              >
                Edit Profile
              </button>
              <button
                type="button"
                onClick={() => setShowNewAssessment(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
              >
                <Plus className="h-4 w-4" />
                New Assessment
              </button>
            </>
          )}
        </div>
      </div>

      {/* Metadata & AAEF */}
      <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 text-sm sm:grid-cols-2 lg:grid-cols-3 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <span className="text-xs text-slate-500">Organisation & Business Unit</span>
          <p className="font-medium">
            {sys.organisationName}
            {sys.businessUnitName ? ` / ${sys.businessUnitName}` : ''}
          </p>
        </div>
        <div>
          <span className="text-xs text-slate-500">Department</span>
          <p className="font-medium">{sys.department || 'Not specified'}</p>
        </div>
        <div>
          <span className="text-xs text-slate-500">Lifecycle Stage</span>
          <p className="font-medium capitalize">{sys.lifecycleStage}</p>
        </div>
        <div>
          <span className="text-xs text-slate-500">Deployment Type</span>
          <p className="font-medium capitalize">{sys.deploymentType.replace('_', ' ')}</p>
        </div>
        <div>
          <span className="text-xs text-slate-500">Target Maturity Level</span>
          <p className="font-medium">{sys.targetMaturityLevel.toFixed(1)} / 4.0</p>
        </div>
        <div>
          <span className="text-xs text-slate-500">AAEF Cross-Reference</span>
          <p className="font-medium">
            {sys.aaefReference || 'Not linked'}
            {sys.aaefUrl && (
              <a
                href={sys.aaefUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-1.5 inline-flex items-center text-teal-700 hover:underline dark:text-teal-400"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </p>
        </div>
      </div>

      {/* Assessments */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-semibold">FRAME Assessments</h2>
        <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {data.assessments.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div>
                <Link
                  to={`/assessments/${a.id}`}
                  className="font-semibold text-teal-700 hover:underline dark:text-teal-400"
                >
                  {a.title}
                </Link>
                <p className="text-xs text-slate-500">
                  {formatDate(a.assessmentDate)} | Type: {a.assessmentType.replace('_', ' ')} | Scope:{' '}
                  {a.scopeType}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize dark:bg-slate-800">
                  {a.status.replace('_', ' ')}
                </span>
                <span className="font-bold">
                  {a.overallScore !== null ? `${a.overallScore.toFixed(2)} / 4` : 'Unscored'}
                </span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => handleCloneAssessment(a.id, a.title)}
                    className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-50 dark:border-slate-700"
                  >
                    <Copy className="h-3 w-3" />
                    Clone
                  </button>
                )}
              </div>
            </div>
          ))}
          {data.assessments.length === 0 && (
            <p className="py-4 text-sm text-slate-500">No assessments recorded for this system yet.</p>
          )}
        </div>
      </section>

      {/* Implementation Checklists */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <CheckSquare className="h-5 w-5 text-teal-700" />
            FRAME Implementation Checklists
          </h2>
          {canEdit && (
            <div className="flex gap-2">
              <select
                value={checklistSection}
                onChange={(e) => setChecklistSection(e.target.value as typeof checklistSection)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="pre_deployment">Section 1: Pre-Deployment</option>
                <option value="operational_30d">Section 2.1: 30-Day Check-In</option>
                <option value="operational_90d">Section 2.2: 90-Day Cycle Review</option>
                <option value="quarterly">Section 2.3: Quarterly Cycle Review</option>
              </select>
              <button
                type="button"
                onClick={handleStartChecklist}
                className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
              >
                Start Checklist
              </button>
            </div>
          )}
        </div>

        <div className="mt-4 space-y-4">
          {data.checklists.map((run) => {
            const doneCount = run.itemsJson.filter((i) => i.status !== 'pending').length;
            return (
              <div key={run.id} className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{run.title}</h3>
                  <span className="text-xs font-medium text-slate-500">
                    {doneCount} / {run.itemsJson.length} completed
                  </span>
                </div>
                <div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1">
                  {run.itemsJson.map((item) => (
                    <div
                      key={item.code}
                      className="flex items-center justify-between gap-3 rounded px-2 py-1 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    >
                      <span>
                        <strong className="mr-1.5">{item.code}</strong>
                        {item.text}
                      </span>
                      <select
                        disabled={!canEdit}
                        value={item.status}
                        onChange={(e) =>
                          handleToggleChecklistItem(
                            run.id,
                            run.itemsJson,
                            item.code,
                            e.target.value as 'pending' | 'complete' | 'na'
                          )
                        }
                        className="rounded border border-slate-300 px-2 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                      >
                        <option value="pending">Pending</option>
                        <option value="complete">Complete</option>
                        <option value="na">N/A</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {data.checklists.length === 0 && (
            <p className="text-sm text-slate-500">No implementation checklists started yet.</p>
          )}
        </div>
      </section>

      {/* Edit System Profile Modal */}
      {showEditSys && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <h2 className="text-lg font-bold">Edit AI System Profile</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await apiFetch(`/api/ai-systems/${sys.id}`, {
                  method: 'PUT',
                  body: JSON.stringify({
                    businessUnitId: editBuId || null,
                    department: editDept,
                    riskTier: editRisk,
                    lifecycleStage: editStage
                  })
                });
                setShowEditSys(false);
                await refetch();
              }}
              className="mt-4 space-y-3"
            >
              <div>
                <label className="block text-sm font-medium">Business Unit</label>
                <select
                  value={editBuId}
                  onChange={(e) => setEditBuId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                >
                  <option value="">Not assigned</option>
                  {(orgData?.businessUnits ?? [])
                    .filter((b) => b.organisationId === sys.organisationId)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium">Department</label>
                <input
                  type="text"
                  value={editDept}
                  onChange={(e) => setEditDept(e.target.value)}
                  placeholder="e.g. Customer Operations"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium">Risk Tier</label>
                  <select
                    value={editRisk}
                    onChange={(e) => setEditRisk(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium">Lifecycle Stage</label>
                  <select
                    value={editStage}
                    onChange={(e) => setEditStage(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                  >
                    <option value="idea">Idea</option>
                    <option value="pilot">Pilot</option>
                    <option value="production">Production</option>
                    <option value="retired">Retired</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEditSys(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Assessment Modal */}
      {showNewAssessment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <h2 className="text-lg font-bold">Start FRAME Assessment</h2>
            <form onSubmit={handleCreateAssessment} className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium">Assessment Title</label>
                <input
                  type="text"
                  required
                  placeholder={`Q4 2026 Review - ${sys.name}`}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Assessment Type</label>
                <select
                  value={assessmentType}
                  onChange={(e) => setAssessmentType(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                >
                  <option value="baseline">Baseline</option>
                  <option value="pre_deployment">Pre-deployment</option>
                  <option value="periodic_review">Periodic review</option>
                  <option value="post_incident">Post-incident</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium">Scope</label>
                <select
                  value={scopeType}
                  onChange={(e) => setScopeType(e.target.value as 'full' | 'partial')}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                >
                  <option value="full">Full (All 5 FRAME Dimensions)</option>
                  <option value="partial">Partial (Selected Dimensions)</option>
                </select>
              </div>
              {scopeType === 'partial' && (
                <div className="space-y-1 text-sm">
                  {['FOCUS', 'ROLES', 'AUTHORITY', 'METRICS', 'EVALUATION'].map((d) => (
                    <label key={d} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedDims.includes(d)}
                        onChange={(e) =>
                          setSelectedDims((prev) =>
                            e.target.checked ? [...prev, d] : prev.filter((x) => x !== d)
                          )
                        }
                      />
                      {d}
                    </label>
                  ))}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewAssessment(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
                >
                  Create Assessment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
