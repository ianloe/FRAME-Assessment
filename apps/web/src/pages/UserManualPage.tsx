import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Printer, Search, ArrowUpRight } from 'lucide-react';

interface ManualSection {
  id: string;
  number: string;
  title: string;
  audience: string;
  route?: string;
  summary: string;
  steps: string[];
  notes?: string[];
}

const SECTIONS: ManualSection[] = [
  {
    id: 'getting-started',
    number: '01',
    title: 'Getting Started, Passkeys & Multi-Factor Authentication',
    audience: 'All Users',
    route: '/security',
    summary:
      'Access to the FRAME Assessment Platform is invite-only (or created directly by an Administrator with an initial password). Every account requires strong authentication before accessing governance data.',
    steps: [
      'Sign in at /login using your email and password, or click Sign in with a passkey if you have already registered a Passkey on this domain.',
      'On your first sign-in, enrol a Passkey (Touch ID, Face ID, Windows Hello, or hardware security key) or an Authenticator App (TOTP) and store your 10 single-use recovery codes securely.',
      'Open My Security from the sidebar to enrol both a Passkey and a TOTP Authenticator App, regenerate recovery codes, change your password, or revoke active sessions.',
      'Use the sun/moon toggle in the top bar to switch between light and dark mode, and the bell icon to view governance notifications.'
    ],
    notes: [
      'WebAuthn passkeys are bound to the exact domain where they were registered (for example frame.ianloehome.net vs localhost). Register a passkey on each domain you use.',
      'Sensitive actions (user invites, security policy edits, and report exports) require step-up re-authentication.'
    ]
  },
  {
    id: 'executive-dashboard',
    number: '02',
    title: 'Executive Governance Command Centre',
    audience: 'All Roles (Scope-Aware)',
    route: '/',
    summary:
      'Provides a consolidated portfolio view across AI systems in your authorised scope, including average maturity across the five FRAME dimensions, maturity trend over time, and a system-by-dimension heatmap.',
    steps: [
      'Filter the portfolio by Organisation, Risk Tier, or Lifecycle Stage using the top filter bar.',
      'Review the 5-dimension Radar Chart (Focus, Roles, Authority, Metrics, Evaluation) against the Level 3 (Defined) production target.',
      'Click any AI system in the Heatmap or KPI tiles to drill down into its detailed governance record.',
      'Click Export Portfolio CSV to download a portfolio-wide summary (step-up authentication required).'
    ]
  },
  {
    id: 'ai-system-register',
    number: '03',
    title: 'AI System Register & Organisational Filtering',
    audience: 'Admin & User (Read-Only for Auditor)',
    route: '/systems',
    summary:
      'Central inventory of all AI deployments governed under FRAME, including Business Unit, Department, lifecycle stage, deployment type, risk tier, target maturity, and AAEF cross-reference.',
    steps: [
      'Click Register AI System to add a new AI deployment with its Organisation, Business Unit, Department, Risk Tier, Target Maturity Level, and optional AAEF reference.',
      'Use the filter bar to filter by Business Unit, Department, Risk Tier, Lifecycle Stage, Completeness (0%, 1-99%, 100%), Assessment Status, or free-text search.',
      'Use Import CSV for bulk onboarding with row-by-row validation preview, or Export CSV to download the filtered inventory.',
      'Open any AI system card to view or edit its profile, generate an A4 PDF Governance Dossier, run FRAME Implementation Checklists, or start a new assessment.'
    ]
  },
  {
    id: 'assessment-wizard',
    number: '04',
    title: 'FRAME Assessment Capture & Scoring',
    audience: 'Admin & User',
    route: '/assessments',
    summary:
      'Guided 5-dimension assessment wizard covering Focus (F1-F7), Roles (R1-R8), Authority (A1-A8), Metrics (M1-M8), and Evaluation (E1-E9) with transparent score derivation.',
    steps: [
      'Open an AI System and click New Assessment. Choose Full (all 5 dimensions) or Partial (selected dimensions) and select the assessment type (Baseline, Pre-deployment, Periodic review, Post-incident).',
      'Use the left dimension navigator to move across Focus, Roles, Authority, Metrics, and Evaluation. Responses autosave with optimistic locking to prevent concurrent edit conflicts.',
      'For each indicator, review the FRAME guidance, practitioner tip, expected evidence, and level descriptors (1 Initial to 4 Optimising), then select a rating (or N/A with justification), confidence, and rationale.',
      'Attach evidence files (PDF, images, CSV, DOCX) or links and post threaded comments per indicator. Review the live score derivation panel, then click Submit for Review.'
    ],
    notes: [
      'Use Clone on an existing assessment to start the next periodic review with prior responses pre-filled and change highlighting enabled.'
    ]
  },
  {
    id: 'review-workflow',
    number: '05',
    title: 'Four-Eyes Review & Approval Workflow',
    audience: 'Admin & Reviewer Users',
    route: '/assessments',
    summary:
      'Enforces independent governance sign-off: the author of an assessment cannot approve their own submission.',
    steps: [
      'Once an assessment is Submitted, an Admin or a User with the Reviewer flag (other than the original assessor) opens the assessment.',
      'Review indicator ratings, rationales, and attached evidence across all dimensions.',
      'Enter a review decision reason and click Approve & Lock Snapshot (creating an immutable point-in-time record) or Request Changes to return it to the assessor.'
    ]
  },
  {
    id: 'checklists-actions',
    number: '06',
    title: 'Implementation Checklists & Remediation Actions',
    audience: 'Admin & User',
    route: '/actions',
    summary:
      'Tracks the FRAME Section 1 Pre-Deployment and Section 2 Operational checklists per AI system alongside a centralised Remediation Actions register.',
    steps: [
      'On an AI System detail page, select a checklist template (Pre-Deployment, 30-Day Check-In, 90-Day Cycle Review, or Quarterly Review) and click Start Checklist.',
      'Mark each checklist item Complete or N/A as governance artefacts are verified.',
      'Inside an assessment, click Generate Remediation Actions from Low Scores (< 3) to automatically create draft actions for gaps, then track status and due dates under Actions.'
    ]
  },
  {
    id: 'ai-insights',
    number: '07',
    title: 'AI Governance Insights & LLM Configuration',
    audience: 'All Users (Config by Admin / Permitted Users)',
    route: '/systems',
    summary:
      'Synthesises FRAME scores, open remediation actions, and audit findings into structured Markdown governance briefings using your configured LLM provider.',
    steps: [
      'Administrators configure the global LLM provider under Administration -> AI Insights (supporting OpenRouter, Google Gemini, OpenAI, Anthropic, Agnes-AI, DeepSeek, and Custom OpenAI-Compatible endpoints). API keys are encrypted at rest.',
      'When enabled by Admin policy, individual users can configure their own personal LLM provider and API key under My Security -> My AI Insights LLM Configuration.',
      'Generate insights for a single system on its AI System Detail page, or across up to 15 filtered systems from the AI System Register using the AI Insights button.'
    ]
  },
  {
    id: 'auditor-workspace',
    number: '08',
    title: 'Auditor Workspace, Findings & Audit Pack Exports',
    audience: 'Auditor & Admin',
    route: '/auditor',
    summary:
      'Provides Auditors with strict read-only visibility across all in-scope AI systems, assessments, evidence, and the tamper-evident SHA-256 hash-chained Audit Log.',
    steps: [
      'Browse any in-scope AI system, assessment, or approved snapshot. Auditor write attempts on assessment data are blocked server-side and all views are audit logged.',
      'In Auditor Workspace, record independent Audit Findings and Observations with severity levels; system owners can record Management Responses.',
      'Click Verify Hash Chain Integrity to recompute and validate the SHA-256 chain across every audit log row.',
      'From any assessment, export A4 PDF, A4 DOCX, CSV, JSON, or a full Audit Pack (ZIP) containing the PDF report, evidence files, response history, audit log extract, and SHA-256 manifest.json.'
    ]
  },
  {
    id: 'administration',
    number: '09',
    title: 'Administration, User Creation & MailHog',
    audience: 'Administrators',
    route: '/admin',
    summary:
      'Manage organisations, business units, user accounts, RBAC permissions matrix, versioned FRAME questionnaires, security policy, and system health.',
    steps: [
      'Under Users & Invitations, either Create User Directly (Initial Password, No Email) for immediate onboarding, or Invite New User (Email Link) to send a 72-hour single-use invitation.',
      'In local Docker development, outgoing invitation and password reset emails are captured by MailHog at http://localhost:8025 rather than sent externally.',
      'Under View as Role Matrix, inspect the live RBAC permissions table generated directly from server permission definitions.',
      'Under Questionnaires, clone FRAME v1.0 to a draft version to customise indicator weights or scoring thresholds, then publish when ready.'
    ]
  }
];

export function UserManualPage() {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.summary.toLowerCase().includes(q) ||
        s.audience.toLowerCase().includes(q) ||
        s.steps.some((st) => st.toLowerCase().includes(q)) ||
        (s.notes ?? []).some((n) => n.toLowerCase().includes(q))
    );
  }, [query]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white">
            <BookOpen className="h-6 w-6 text-[#1e3a5f] dark:text-blue-400" />
            FRAME Platform User Manual
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Role-by-role operational guide for Practitioners, Reviewers, Auditors, and Administrators.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 print:hidden"
        >
          <Printer className="h-4 w-4" />
          Print Manual
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-md print:hidden">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search manual topics..."
          className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
      </div>

      {/* Quick Jump Pills */}
      <div className="flex flex-wrap gap-2 print:hidden">
        {filtered.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:border-[#1e3a5f] hover:text-[#1e3a5f] dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
          >
            {s.number}. {s.title}
          </a>
        ))}
      </div>

      {/* Sections */}
      <div className="space-y-5">
        {filtered.map((section) => (
          <section
            key={section.id}
            id={section.id}
            className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-[#1e3a5f] px-2 py-0.5 font-mono text-xs font-bold text-white dark:bg-blue-600">
                    {section.number}
                  </span>
                  <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {section.audience}
                  </span>
                </div>
                <h2 className="mt-2 text-lg font-bold text-slate-900 dark:text-white">
                  {section.title}
                </h2>
              </div>
              {section.route && (
                <Link
                  to={section.route}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-[#1e3a5f] hover:bg-slate-50 dark:border-slate-700 dark:text-blue-400 dark:hover:bg-slate-800 print:hidden"
                >
                  Open page
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>

            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{section.summary}</p>

            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-800 dark:text-slate-200">
              {section.steps.map((step, i) => (
                <li key={i} className="leading-relaxed">
                  {step}
                </li>
              ))}
            </ol>

            {section.notes && section.notes.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/60 p-3.5 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
                <p className="font-semibold">Notes</p>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {section.notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        ))}

        {filtered.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
            No manual sections matched &ldquo;{query}&rdquo;.
          </div>
        )}
      </div>
    </div>
  );
}
