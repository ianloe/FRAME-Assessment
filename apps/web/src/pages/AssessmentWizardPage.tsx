import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer
} from 'recharts';
import {
  FileDown,
  Send,
  CheckCircle2,
  XCircle,
  Paperclip,
  MessageSquare,
  Info,
  Sparkles
} from 'lucide-react';
import { apiFetch, ApiError, downloadFile, getCsrfToken } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatDateTime } from '../lib/date';
import type { AssessmentScoreResult } from '@frame/shared';

interface QuestionRow {
  id: string;
  code: string;
  text: string;
  guidance: string;
  helpText: string;
  evidenceExpectations: string;
  weight: number;
  applicabilityCondition: string | null;
}

interface DimensionRow {
  id: string;
  code: string;
  name: string;
  description: string;
  levelDescriptorsJson: Record<string, string>;
  questions: QuestionRow[];
}

interface ResponseRow {
  id: string;
  questionId: string;
  rating: number | null;
  rationale: string;
  confidence: 'low' | 'medium' | 'high';
  isNa: boolean;
  naJustification: string;
  version: number;
}

interface AssessmentDetailBundle {
  assessment: {
    id: string;
    title: string;
    status: string;
    assessorId: string | null;
    reviewerId: string | null;
    clonedFromId: string | null;
    narrativeSummary: string;
    assessmentDate: string;
  };
  aiSystem: {
    id: string;
    name: string;
    riskTier: string;
    targetMaturityLevel: number;
  };
  dimensions: DimensionRow[];
  responses: ResponseRow[];
  priorResponses: ResponseRow[];
  evidence: Array<{
    id: string;
    responseId: string | null;
    kind: string;
    title: string;
    evidenceType: string;
    url: string | null;
    sha256Hash: string | null;
  }>;
  comments: Array<{
    id: string;
    questionId: string;
    authorId: string | null;
    body: string;
    createdAt: string;
  }>;
  reviews: Array<{
    id: string;
    decision: string;
    reason: string;
    createdAt: string;
  }>;
  scoreResult: AssessmentScoreResult;
  users: Array<{ id: string; name: string; role: string }>;
}

export function AssessmentWizardPage() {
  const { id } = useParams<{ id: string }>();
  const { session, openStepUp } = useAuth();

  const [activeDimCode, setActiveDimCode] = useState<string>('FOCUS');
  const [narrative, setNarrative] = useState('');
  const [submitGaps, setSubmitGaps] = useState<Array<{ code: string; reason: string }>>([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [reviewReason, setReviewReason] = useState('');
  const [commentTextByQ, setCommentTextByQ] = useState<Record<string, string>>({});
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');

  const { data, isLoading, refetch } = useQuery<AssessmentDetailBundle>({
    queryKey: ['assessment', id],
    queryFn: () => apiFetch(`/api/assessments/${id}`),
    enabled: Boolean(id)
  });

  if (isLoading || !data) {
    return <div className="p-6 text-sm text-slate-500">Loading FRAME assessment...</div>;
  }

  const isLocked = data.assessment.status === 'approved' || data.assessment.status === 'archived';
  const canEdit =
    !isLocked && (session?.user.role === 'admin' || session?.user.role === 'user');
  const isAuthor = data.assessment.assessorId === session?.user.id;
  const canReview =
    !isAuthor &&
    ['submitted', 'in_review'].includes(data.assessment.status) &&
    (session?.user.role === 'admin' || (session?.user.role === 'user' && session.user.isReviewer));

  const currentDim =
    data.dimensions.find((d) => d.code === activeDimCode) ?? data.dimensions[0];

  const respMap = new Map(data.responses.map((r) => [r.questionId, r]));
  const priorMap = new Map(data.priorResponses.map((r) => [r.questionId, r]));
  const userMap = new Map(data.users.map((u) => [u.id, u.name]));

  const saveResponse = async (
    questionId: string,
    patch: Partial<{
      rating: number | null;
      rationale: string;
      confidence: 'low' | 'medium' | 'high';
      isNa: boolean;
      naJustification: string;
    }>
  ) => {
    setErrorMessage('');
    const existing = respMap.get(questionId);
    try {
      await apiFetch(`/api/assessments/${data.assessment.id}/responses`, {
        method: 'PUT',
        body: JSON.stringify({
          questionId,
          rating: patch.rating !== undefined ? patch.rating : existing?.rating ?? null,
          rationale: patch.rationale !== undefined ? patch.rationale : existing?.rationale ?? '',
          confidence: patch.confidence ?? existing?.confidence ?? 'medium',
          isNa: patch.isNa !== undefined ? patch.isNa : existing?.isNa ?? false,
          naJustification:
            patch.naJustification !== undefined
              ? patch.naJustification
              : existing?.naJustification ?? '',
          expectedVersion: existing?.version
        })
      });
      setStatusMessage('Saved');
      await refetch();
    } catch (err) {
      setErrorMessage((err as Error).message);
    }
  };

  const handleSubmit = async () => {
    setErrorMessage('');
    setSubmitGaps([]);
    try {
      await apiFetch(`/api/assessments/${data.assessment.id}/submit`, {
        method: 'POST',
        body: JSON.stringify({
          narrativeSummary: narrative || data.assessment.narrativeSummary
        })
      });
      setStatusMessage('Assessment submitted for review.');
      await refetch();
    } catch (err) {
      if (err instanceof ApiError && err.details && typeof err.details === 'object' && 'gaps' in err.details) {
        setSubmitGaps((err.details as { gaps: Array<{ code: string; reason: string }> }).gaps);
      }
      setErrorMessage((err as Error).message);
    }
  };

  const handleReview = async (decision: 'approved' | 'changes_requested') => {
    setErrorMessage('');
    try {
      await apiFetch(`/api/assessments/${data.assessment.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason: reviewReason || `Marked ${decision}` })
      });
      setReviewReason('');
      await refetch();
    } catch (err) {
      setErrorMessage((err as Error).message);
    }
  };

  const handleExport = async (format: 'pdf' | 'docx' | 'csv' | 'json' | 'audit-pack') => {
    const ext = format === 'audit-pack' ? 'zip' : format;
    try {
      await downloadFile(
        `/api/reports/assessments/${data.assessment.id}/${format}`,
        `frame-assessment-${data.assessment.id.slice(0, 8)}.${ext}`
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') {
        openStepUp(() => void handleExport(format));
      } else {
        setErrorMessage((err as Error).message);
      }
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, responseId?: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMessage('');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('title', file.name);
    fd.append('evidenceType', 'report');
    if (responseId) fd.append('responseId', responseId);

    const res = await fetch(`/api/assessments/${data.assessment.id}/evidence/file`, {
      method: 'POST',
      headers: { 'X-CSRF-Token': getCsrfToken() },
      body: fd,
      credentials: 'include'
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setErrorMessage(body.error ?? 'Upload failed');
      return;
    }
    await refetch();
  };

  const handleAddLink = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch(`/api/assessments/${data.assessment.id}/evidence/link`, {
      method: 'POST',
      body: JSON.stringify({ title: linkTitle, url: linkUrl, evidenceType: 'policy' })
    });
    setLinkTitle('');
    setLinkUrl('');
    await refetch();
  };

  const handleAddComment = async (questionId: string) => {
    const body = commentTextByQ[questionId]?.trim();
    if (!body) return;
    await apiFetch(`/api/assessments/${data.assessment.id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ questionId, body })
    });
    setCommentTextByQ((prev) => ({ ...prev, [questionId]: '' }));
    await refetch();
  };

  const handleSuggestActions = async () => {
    const res = await apiFetch<{
      suggestions: Array<{
        aiSystemId: string;
        assessmentId: string;
        questionId: string;
        title: string;
        description: string;
        priority: string;
      }>;
    }>(`/api/actions/suggest/${data.assessment.id}`, { method: 'POST' });

    for (const s of res.suggestions) {
      await apiFetch('/api/actions', {
        method: 'POST',
        body: JSON.stringify(s)
      });
    }
    setStatusMessage(`Created ${res.suggestions.length} suggested remediation action(s).`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Link to={`/systems/${data.aiSystem.id}`} className="hover:underline">
              {data.aiSystem.name}
            </Link>
            <span>/</span>
            <span>{formatDate(data.assessment.assessmentDate)}</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold">{data.assessment.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-slate-200 px-2 py-0.5 font-semibold uppercase dark:bg-slate-800">
              {data.assessment.status.replace('_', ' ')}
            </span>
            {statusMessage && <span className="text-teal-700 dark:text-teal-400">{statusMessage}</span>}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleExport('pdf')}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
          >
            <FileDown className="h-3.5 w-3.5" />
            PDF (A4)
          </button>
          <button
            type="button"
            onClick={() => handleExport('docx')}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
          >
            <FileDown className="h-3.5 w-3.5" />
            DOCX (A4)
          </button>
          <button
            type="button"
            onClick={() => handleExport('csv')}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
          >
            CSV
          </button>
          <button
            type="button"
            onClick={() => handleExport('audit-pack')}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
          >
            Audit Pack (ZIP)
          </button>
        </div>
      </div>

      {errorMessage && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <p className="font-semibold">{errorMessage}</p>
          {submitGaps.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs">
              {submitGaps.map((g) => (
                <li key={g.code}>
                  <strong>{g.code}:</strong> {g.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Score Summary & Derivation */}
      <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 lg:grid-cols-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="space-y-2 lg:col-span-2">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-3xl font-bold text-teal-700 dark:text-teal-400">
              {data.scoreResult.overallScore !== null
                ? `${data.scoreResult.overallScore.toFixed(2)} / 4.00`
                : 'Not yet scored'}
            </span>
            {data.scoreResult.band && (
              <span className="rounded-full bg-teal-50 px-3 py-0.5 text-xs font-semibold text-teal-800 dark:bg-teal-950/60 dark:text-teal-300">
                {data.scoreResult.band.label}
              </span>
            )}
            <span className="text-xs text-slate-500">
              Target: {data.scoreResult.targetMaturityLevel.toFixed(1)}
            </span>
          </div>
          {data.scoreResult.band && (
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {data.scoreResult.band.guidance}
            </p>
          )}
          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
            <p className="flex items-center gap-1 font-semibold">
              <Info className="h-3.5 w-3.5 text-teal-700" />
              How this score was derived:
            </p>
            <p className="mt-1">{data.scoreResult.derivationSummary}</p>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={handleSuggestActions}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:border-slate-700"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-600" />
              Generate Remediation Actions from Low Scores (&lt; 3)
            </button>
          )}
        </div>

        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart
              data={data.scoreResult.dimensions.map((d) => ({
                dimension: d.dimensionName,
                score: d.score ?? 0
              }))}
            >
              <PolarGrid />
              <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11 }} />
              <PolarRadiusAxis domain={[0, 4]} tickCount={5} />
              <Radar dataKey="score" stroke="#0f766e" fill="#0f766e" fillOpacity={0.35} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Reviewer Four-Eyes Panel */}
      {canReview && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-5 dark:border-amber-900 dark:bg-amber-950/20">
          <h2 className="font-semibold">Independent Governance Review (Four-Eyes Enforced)</h2>
          <div className="mt-3 flex flex-wrap gap-3">
            <input
              type="text"
              placeholder="Review decision rationale (required)..."
              value={reviewReason}
              onChange={(e) => setReviewReason(e.target.value)}
              className="min-w-[260px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
            <button
              type="button"
              onClick={() => handleReview('changes_requested')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              <XCircle className="h-4 w-4" />
              Request Changes
            </button>
            <button
              type="button"
              onClick={() => handleReview('approved')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
            >
              <CheckCircle2 className="h-4 w-4" />
              Approve & Lock Snapshot
            </button>
          </div>
        </div>
      )}

      {/* Main Wizard: Left Navigator + Questions */}
      <div className="grid gap-6 lg:grid-cols-4">
        <aside className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="px-2 pb-2 text-xs font-semibold uppercase text-slate-500">
              FRAME Dimensions
            </h2>
            <nav className="space-y-1">
              {data.dimensions.map((dim) => {
                const answered = dim.questions.filter((q) => respMap.has(q.id)).length;
                const dimScore = data.scoreResult.dimensions.find(
                  (d) => d.dimensionCode === dim.code
                )?.score;
                return (
                  <button
                    key={dim.id}
                    type="button"
                    onClick={() => setActiveDimCode(dim.code)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                      currentDim?.code === dim.code
                        ? 'bg-teal-50 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span>{dim.name}</span>
                    <span className="text-xs text-slate-500">
                      {answered}/{dim.questions.length}
                      {dimScore !== null && dimScore !== undefined ? ` (${dimScore.toFixed(1)})` : ''}
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>

          {canEdit && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <label className="block text-xs font-semibold uppercase text-slate-500">
                Narrative Summary
              </label>
              <textarea
                rows={4}
                defaultValue={data.assessment.narrativeSummary}
                onChange={(e) => setNarrative(e.target.value)}
                className="mt-2 w-full rounded-lg border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                placeholder="Executive summary of assessment findings..."
              />
              <button
                type="button"
                onClick={handleSubmit}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
              >
                <Send className="h-4 w-4" />
                Submit for Review
              </button>
            </div>
          )}
        </aside>

        {/* Active Dimension Questions */}
        {currentDim && (
          <div className="space-y-4 lg:col-span-3">
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-lg font-bold">{currentDim.name}</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {currentDim.description}
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {(['1', '2', '3', '4'] as const).map((lvl) => (
                  <div
                    key={lvl}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs dark:border-slate-800 dark:bg-slate-800/50"
                  >
                    <p className="font-semibold text-teal-800 dark:text-teal-300">
                      Level {lvl} ({['Initial', 'Developing', 'Defined', 'Optimising'][Number(lvl) - 1]})
                    </p>
                    <p className="mt-1 text-slate-600 dark:text-slate-400">
                      {currentDim.levelDescriptorsJson[lvl]}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {currentDim.questions.map((q) => {
              const r = respMap.get(q.id);
              const prior = priorMap.get(q.id);
              const changedFromPrior =
                prior && r && (prior.rating !== r.rating || prior.isNa !== r.isNa);
              const qComments = data.comments.filter((c) => c.questionId === q.id);

              return (
                <div
                  key={q.id}
                  className={`rounded-xl border bg-white p-5 dark:bg-slate-900 ${
                    changedFromPrior
                      ? 'border-amber-400 dark:border-amber-600'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <span className="inline-block rounded bg-teal-50 px-2 py-0.5 text-xs font-bold text-teal-800 dark:bg-teal-950 dark:text-teal-300">
                        {q.code}
                      </span>
                      {changedFromPrior && (
                        <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          Changed from prior ({prior.isNa ? 'N/A' : prior.rating})
                        </span>
                      )}
                      <h3 className="mt-1 font-semibold">{q.text}</h3>
                    </div>
                    <span className="text-xs text-slate-500">Weight: {q.weight}</span>
                  </div>

                  <div className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-400">
                    <p>
                      <strong>Guidance:</strong> {q.guidance}
                    </p>
                    {q.helpText && (
                      <p>
                        <strong>Practitioner tip:</strong> {q.helpText}
                      </p>
                    )}
                    {q.evidenceExpectations && (
                      <p>
                        <strong>Expected evidence:</strong> {q.evidenceExpectations}
                      </p>
                    )}
                  </div>

                  {/* Rating & N/A */}
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {[1, 2, 3, 4].map((val) => {
                      const active = !r?.isNa && r?.rating === val;
                      return (
                        <button
                          key={val}
                          type="button"
                          disabled={!canEdit}
                          onClick={() => saveResponse(q.id, { rating: val, isNa: false })}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                            active
                              ? 'border-teal-700 bg-teal-700 text-white'
                              : 'border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'
                          }`}
                        >
                          {val} - {['Initial', 'Developing', 'Defined', 'Optimising'][val - 1]}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => saveResponse(q.id, { isNa: !r?.isNa, rating: null })}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                        r?.isNa
                          ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900'
                          : 'border-slate-300 hover:bg-slate-50 dark:border-slate-700'
                      }`}
                    >
                      N/A
                    </button>

                    <select
                      aria-label={`Confidence for ${q.code}`}
                      disabled={!canEdit}
                      value={r?.confidence ?? 'medium'}
                      onChange={(e) =>
                        saveResponse(q.id, {
                          confidence: e.target.value as 'low' | 'medium' | 'high'
                        })
                      }
                      className="ml-auto rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                    >
                      <option value="low">Low confidence</option>
                      <option value="medium">Medium confidence</option>
                      <option value="high">High confidence</option>
                    </select>
                  </div>

                  {/* Rationale / N/A Justification */}
                  <div className="mt-3">
                    {r?.isNa ? (
                      <input
                        type="text"
                        disabled={!canEdit}
                        defaultValue={r.naJustification}
                        onBlur={(e) => saveResponse(q.id, { naJustification: e.target.value, isNa: true })}
                        placeholder="Justification for N/A (required)..."
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                      />
                    ) : (
                      <textarea
                        rows={2}
                        disabled={!canEdit}
                        defaultValue={r?.rationale ?? ''}
                        onBlur={(e) => saveResponse(q.id, { rationale: e.target.value })}
                        placeholder="Rationale and evidence notes (required for ratings >= 3)..."
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                      />
                    )}
                  </div>

                  {/* Per-question evidence & comments */}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
                    {canEdit && r && (
                      <label className="inline-flex cursor-pointer items-center gap-1 text-teal-700 hover:underline dark:text-teal-400">
                        <Paperclip className="h-3.5 w-3.5" />
                        Attach evidence file
                        <input
                          type="file"
                          className="hidden"
                          onChange={(e) => handleFileUpload(e, r.id)}
                        />
                      </label>
                    )}
                    <span className="text-slate-500">
                      {qComments.length} comment(s)
                    </span>
                  </div>

                  {qComments.length > 0 && (
                    <div className="mt-2 space-y-1.5 rounded-lg bg-slate-50 p-2.5 text-xs dark:bg-slate-800/60">
                      {qComments.map((c) => (
                        <div key={c.id}>
                          <span className="font-semibold">
                            {c.authorId ? userMap.get(c.authorId) ?? 'User' : 'User'}:
                          </span>{' '}
                          <span>{c.body}</span>
                          <span className="ml-2 text-[10px] text-slate-400">
                            {formatDateTime(c.createdAt)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {canEdit && (
                    <div className="mt-2 flex gap-2">
                      <input
                        type="text"
                        placeholder="Add a comment..."
                        value={commentTextByQ[q.id] ?? ''}
                        onChange={(e) =>
                          setCommentTextByQ((prev) => ({ ...prev, [q.id]: e.target.value }))
                        }
                        className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-800"
                      />
                      <button
                        type="button"
                        onClick={() => handleAddComment(q.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50 dark:border-slate-700"
                      >
                        <MessageSquare className="h-3 w-3" />
                        Post
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Evidence Register for Assessment */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="font-semibold">Assessment Evidence Index</h3>
              <ul className="mt-3 divide-y divide-slate-100 text-xs dark:divide-slate-800">
                {data.evidence.map((ev) => (
                  <li key={ev.id} className="flex items-center justify-between py-2">
                    <div>
                      <span className="font-medium">{ev.title}</span>{' '}
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
                        {ev.evidenceType}
                      </span>
                      {ev.sha256Hash && (
                        <span className="ml-2 font-mono text-[10px] text-slate-400">
                          SHA-256: {ev.sha256Hash.slice(0, 12)}...
                        </span>
                      )}
                    </div>
                    {ev.kind === 'file' ? (
                      <a
                        href={`/api/evidence/${ev.id}/download`}
                        className="text-teal-700 underline dark:text-teal-400"
                      >
                        Download
                      </a>
                    ) : (
                      <a
                        href={ev.url ?? '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="text-teal-700 underline dark:text-teal-400"
                      >
                        Open link
                      </a>
                    )}
                  </li>
                ))}
                {data.evidence.length === 0 && (
                  <li className="py-2 text-slate-500">No evidence attached yet.</li>
                )}
              </ul>

              {canEdit && (
                <form onSubmit={handleAddLink} className="mt-4 flex flex-wrap gap-2">
                  <input
                    type="text"
                    required
                    placeholder="Evidence link title"
                    value={linkTitle}
                    onChange={(e) => setLinkTitle(e.target.value)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                  />
                  <input
                    type="url"
                    required
                    placeholder="https://..."
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white"
                  >
                    Add Link
                  </button>
                </form>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
