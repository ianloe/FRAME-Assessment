export interface MaturityLevelDefinition {
  level: number;
  label: string;
  description: string;
}

export const FRAME_MATURITY_LEVELS: readonly MaturityLevelDefinition[] = [
  {
    level: 1,
    label: 'Initial',
    description:
      'Governance exists informally or ad hoc. No documented framework. Accountability is unclear.'
  },
  {
    level: 2,
    label: 'Developing',
    description:
      'Governance documentation exists but is incomplete, inconsistent, or not actively maintained. Some accountability is defined.'
  },
  {
    level: 3,
    label: 'Defined',
    description:
      'Governance documentation is complete, approved, and maintained. Accountability is clear. Review cadence is in place. Target for any AI deployment in production.'
  },
  {
    level: 4,
    label: 'Optimising',
    description:
      'Governance is embedded in operational practice. Reviews drive continuous improvement. The organisation learns from governance data and improves its framework over time.'
  }
];

export interface FrameQuestionSeed {
  code: string;
  text: string;
  guidance: string;
  helpText: string;
  evidenceExpectations: string;
  weight: number;
  answerType: 'maturity_1_4';
  applicabilityCondition?: string;
}

export interface FrameDimensionSeed {
  code: 'FOCUS' | 'ROLES' | 'AUTHORITY' | 'METRICS' | 'EVALUATION';
  name: string;
  description: string;
  orderIndex: number;
  levelDescriptors: Record<'1' | '2' | '3' | '4', string>;
  questions: FrameQuestionSeed[];
}

export const FRAME_V1_DIMENSIONS: readonly FrameDimensionSeed[] = [
  {
    code: 'FOCUS',
    name: 'Focus',
    description:
      'Defines the domain, scope, and intended outcome of the AI deployment. Governance begins with clarity about what the AI system is for, what problem it is solving, and what a successful outcome looks like.',
    orderIndex: 1,
    levelDescriptors: {
      '1': 'No documented domain statement or outcome definition. The deployment purpose is understood informally by the team that built it.',
      '2': 'A domain statement and outcome statement exist but were written by the technology team without business owner input. Scope boundaries are implied rather than documented.',
      '3': 'All Focus components are documented, approved by the business owner, and included in the governance documentation package. The Focus definition is reviewed at each cycle review.',
      '4': 'The Focus definition is actively used to evaluate whether the deployment remains fit for purpose. Changes in business strategy or operational context trigger proactive Focus reviews outside the regular cycle.'
    },
    questions: [
      {
        code: 'F1',
        text: 'A domain statement exists that clearly bounds the AI system operating scope',
        guidance:
          'Write a clear description of the operational domain in which the AI system will operate, specific enough to exclude adjacent domains in which the system is not authorised to operate.',
        helpText:
          'Practitioner test: read the domain statement to someone unfamiliar with the deployment. If they cannot tell you what the system does and does not do, rewrite it.',
        evidenceExpectations: 'Approved domain statement document or governance charter section.',
        weight: 1
        ,
        answerType: 'maturity_1_4'
      },
      {
        code: 'F2',
        text: 'A problem definition exists that describes the current state being addressed',
        guidance:
          'State the specific problem the AI system addresses, describing the current state, the gap or inefficiency, and why AI is the appropriate intervention.',
        helpText:
          'Avoid describing the AI solution in the problem definition. If the problem definition would still be valid if you replaced the AI system with a human worker, it is well framed.',
        evidenceExpectations: 'Problem statement / business case record.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'F3',
        text: 'An outcome statement exists that defines success in terms of operational change',
        guidance:
          'Define what success looks like in terms of measurable changes to operational outcomes, customer experience, or organisational capability, before metrics are selected.',
        helpText:
          'Avoid outcome statements that describe AI activity ("process 10,000 queries per month") rather than operational outcomes ("customer query resolution time decreases by 20%").',
        evidenceExpectations: 'Signed-off outcome statement traceable to business objectives.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'F4',
        text: 'Scope boundaries are documented for populations, data, decisions, and channels',
        guidance:
          'Explicitly define what is in scope and out of scope across populations served, permitted data, decisions influenced, and channels or interfaces.',
        helpText:
          'The out-of-scope list is as important as the in-scope list, particularly for systems interacting with end users or processing sensitive data.',
        evidenceExpectations: 'Scope matrix or specification covering in-scope and out-of-scope boundaries.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'F5',
        text: 'The Focus definition has been reviewed and approved by the business owner',
        guidance:
          'Document that the Focus definition has been reviewed and formally approved by the relevant business owner.',
        helpText:
          'A Focus definition completed by the technology team without business owner review or approval is a common governance failure.',
        evidenceExpectations: 'Business owner sign-off record, meeting minutes, or approval log.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'F6',
        text: 'The Focus definition has been reviewed by the compliance or risk function where applicable',
        guidance:
          'Obtain review from compliance or risk if the deployment touches regulated data, regulated decisions, or a regulated industry.',
        helpText: 'Mark N/A with justification only if no regulatory or compliance oversight applies.',
        evidenceExpectations: 'Compliance or risk review sign-off or assessment memo.',
        weight: 1,
        answerType: 'maturity_1_4',
        applicabilityCondition: 'Where regulatory, compliance, or risk oversight applies'
      },
      {
        code: 'F7',
        text: 'The Focus definition is reviewed and updated as part of each cycle review',
        guidance:
          'Ensure Focus remains accurate and aligned with business strategy and operational context during cycle reviews.',
        helpText: 'At Level 4, changes in business strategy or context trigger proactive Focus reviews outside the regular cycle.',
        evidenceExpectations: 'Cycle review minutes showing Focus validation or update history.',
        weight: 1,
        answerType: 'maturity_1_4'
      }
    ]
  },
  {
    code: 'ROLES',
    name: 'Roles',
    description:
      'Establishes who is responsible for what across the AI deployment lifecycle, including human oversight responsibilities, escalation paths, accountability for AI outputs, and boundaries between human and AI decision authority.',
    orderIndex: 2,
    levelDescriptors: {
      '1': 'No formal role documentation. Accountability is informally understood within the team.',
      '2': 'Some roles are documented but with team-level rather than individual assignments. The escalation path exists on paper but has not been tested.',
      '3': 'All roles are documented with named individuals. The escalation path has been tested. Role documentation is updated within two weeks of any personnel change.',
      '4': 'Role effectiveness is assessed at each cycle review. Escalation path performance is tracked and used to improve the path over time. Succession planning exists for governance-critical roles.'
    },
    questions: [
      {
        code: 'R1',
        text: 'A named business owner is documented with clear accountability for outcomes',
        guidance:
          'Assign a named individual (or accountable body) with accountability for the business outcomes, Focus approval, outcome metrics, and domain governance compliance.',
        helpText: 'Identify named individuals, not teams or functions, to avoid diffuse accountability.',
        evidenceExpectations: 'Role register naming the Business Owner and responsibilities.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'R2',
        text: 'A named technology accountable owner is documented',
        guidance:
          'Assign an internal named individual accountable for the AI system technical operation, performance, and security.',
        helpText: 'For vendor-procured systems, this must be an internal owner accountable for vendor performance; the vendor cannot hold this role.',
        evidenceExpectations: 'Role register naming the Technology Accountable Owner.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'R3',
        text: 'An operational oversight role is defined with day-to-day monitoring responsibilities',
        guidance:
          'Define who is responsible for day-to-day monitoring, performance tracking, escalation handling, and incident response.',
        helpText: 'In smaller deployments this may be the Technology Accountable Owner; in larger deployments it is typically a distinct operational function.',
        evidenceExpectations: 'Operational runbook or role assignment for daily oversight.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'R4',
        text: 'An escalation path is documented with trigger conditions, recipient, channel, and response time',
        guidance:
          'Document what conditions trigger escalation from the AI system to a human, who receives it, how it arrives, expected response time, and recipient authority to act.',
        helpText: 'Escalation paths must be actionable rather than generic statements.',
        evidenceExpectations: 'Escalation matrix / SOP with SLAs and named recipients.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'R5',
        text: 'The escalation path has been tested and confirmed to work',
        guidance:
          'Send a test escalation before deployment and confirm it arrives, is understood, and can be acted upon by the receiving human.',
        helpText: 'Escalation paths that exist only on paper fail during real incidents.',
        evidenceExpectations: 'Escalation test log, drill record, or confirmation screenshot.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'R6',
        text: 'A review and approval authority is defined for AI outputs feeding into consequential decisions',
        guidance:
          'Document who reviews AI outputs before they are acted upon, and under what conditions outputs may be acted upon without additional human review.',
        helpText: 'Mark N/A only if the system does not feed into consequential decisions.',
        evidenceExpectations: 'Decision review policy or workflow approval matrix.',
        weight: 1,
        answerType: 'maturity_1_4',
        applicabilityCondition: 'For AI systems producing outputs for consequential decisions'
      },
      {
        code: 'R7',
        text: 'A governance accountable owner is named, outside the development or vendor chain',
        guidance:
          'Assign a senior technology or risk leader accountable for maintaining FRAME governance, independent of the development or vendor team.',
        helpText: 'Assigning this role to the team building the system creates a conflict of interest.',
        evidenceExpectations: 'Governance charter naming an independent Governance Accountable Owner.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'R8',
        text: 'Role documentation is kept current as personnel changes occur',
        guidance:
          'Ensure role documentation is updated promptly (target within two weeks) when personnel changes occur.',
        helpText: 'At Level 4, succession planning exists for governance-critical roles.',
        evidenceExpectations: 'Change log of role updates or HR/governance sync procedure.',
        weight: 1,
        answerType: 'maturity_1_4'
      }
    ]
  },
  {
    code: 'AUTHORITY',
    name: 'Authority',
    description:
      'Defines the decision rights of the AI system: what it can act on autonomously (Tier 1), what requires human confirmation (Tier 2), and what is prohibited (Tier 3).',
    orderIndex: 3,
    levelDescriptors: {
      '1': 'No formal authority tier classification. The system operates without documented boundaries.',
      '2': 'A tier classification exists but uses broad action categories. Tier 3 prohibitions are policy statements only, with no technical enforcement.',
      '3': 'Tier classification is specific and complete. Tier 3 is technically enforced. A boundary change control process is followed. Violations are responded to under a documented protocol.',
      '4': 'Authority boundaries are regularly reviewed against emerging risk scenarios. Adversarial testing is conducted at each major system update. Boundary violation data is used to improve the tier classification over time.'
    },
    questions: [
      {
        code: 'A1',
        text: 'All action types are classified across Tier 1, Tier 2, and Tier 3',
        guidance:
          'Classify every action type available to the AI system into Tier 1 (Autonomous), Tier 2 (Confirmed), or Tier 3 (Prohibited). Tier 2 is the default for unclassified actions.',
        helpText: 'Actions not on the Tier 1 list must not be autonomous by default.',
        evidenceExpectations: 'Complete Authority Tier Classification table.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'A2',
        text: 'The Tier 1 list is specific (individual action types, not broad categories)',
        guidance:
          'List specific individual action types (e.g. "send standard acknowledgement", "issue refund under SGD 50") rather than broad categories (e.g. "respond to customer queries").',
        helpText: 'Tier 1 actions must be low-consequence, reversible, or both.',
        evidenceExpectations: 'Granular Tier 1 action specification.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'A3',
        text: 'The Tier 3 list exists and contains meaningful prohibitions',
        guidance:
          'Define explicit prohibited actions the AI system may never take regardless of instruction (at minimum: financial system access, unreviewed external communications, permanent data deletion where relevant).',
        helpText: 'Tier 3 should always contain explicit prohibitions.',
        evidenceExpectations: 'Documented Tier 3 prohibitions list (minimum 3 items recommended).',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'A4',
        text: 'Tier 3 prohibitions are technically enforced, not just stated in policy',
        guidance:
          'Implement technical controls (RBAC, tool gating, API permissions, policy guardrails) that make Tier 3 violations impossible rather than merely prohibited in policy.',
        helpText: 'Policy statements alone do not satisfy this requirement.',
        evidenceExpectations: 'Architecture/permission config, guardrail rules, or test evidence.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'A5',
        text: 'A boundary change control process is documented and followed',
        guidance:
          'Define how authority tier classifications are modified, requiring review and approval by the Governance Accountable Owner (and 24-hour documentation for emergency changes).',
        helpText: 'Avoid processes so slow they encourage informal boundary workarounds.',
        evidenceExpectations: 'Change control SOP and approval records.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'A6',
        text: 'A boundary violation protocol exists with defined response steps',
        guidance:
          'Document the response protocol for boundary violations: immediate containment, impact assessment, root cause analysis, and governance review.',
        helpText: 'Violations require immediate response under this protocol, not waiting for a cycle review.',
        evidenceExpectations: 'Boundary violation runbook and incident response template.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'A7',
        text: 'Authority boundaries have been tested against adversarial inputs',
        guidance:
          'Test that the system cannot be prompted or manipulated into treating Tier 2 or Tier 3 actions as Tier 1.',
        helpText: 'At Level 4, adversarial testing is repeated at each major system update.',
        evidenceExpectations: 'Red-team / adversarial test report and remediation log.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'A8',
        text: 'For agentic systems: workflow-level authority is defined in addition to action-level authority',
        guidance:
          'Define authority boundaries for multi-step action sequences and human checkpoints, not just individual tool calls.',
        helpText: 'Mark N/A with justification for non-agentic systems (e.g. single-turn predictive models).',
        evidenceExpectations: 'Workflow-level checkpoint specification for agentic pipelines.',
        weight: 1,
        answerType: 'maturity_1_4',
        applicabilityCondition: 'Agentic or multi-step AI systems only'
      }
    ]
  },
  {
    code: 'METRICS',
    name: 'Metrics',
    description:
      'Specifies how the AI system performance and contribution will be measured, distinguishing activity metrics, outcome metrics, and governance metrics.',
    orderIndex: 4,
    levelDescriptors: {
      '1': 'Metrics are activity-based and were selected after deployment. No baseline exists.',
      '2': 'Some outcome metrics exist but were defined after deployment. A partial baseline exists. Adoption is not tracked.',
      '3': 'Outcome metrics are defined pre-deployment, traceable to the Focus outcome statement, and measured against a pre-deployment baseline. Adoption is tracked. Leading and lagging indicators are designated.',
      '4': 'The metric set is reviewed at each cycle review for continued relevance. Metric data drives governance decisions, not just reporting. The organisation has built institutional knowledge about which metrics are most predictive of deployment success.'
    },
    questions: [
      {
        code: 'M1',
        text: 'Outcome metrics are defined and traceable to the Focus outcome statement',
        guidance:
          'Define outcome metrics specifying what is measured, calculation method, data source, frequency, and baseline, traceable to the Focus outcome statement.',
        helpText: 'Outcome metrics measure what changes in operational reality, not system throughput.',
        evidenceExpectations: 'Metrics specification mapped to Focus outcome statement.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'M2',
        text: 'A pre-deployment baseline has been established for each outcome metric',
        guidance:
          'Measure and record the pre-deployment baseline for each outcome metric before entering production.',
        helpText: 'For retrospective application, define a proxy baseline from historical data and document the limitation.',
        evidenceExpectations: 'Baseline measurement report dated prior to production release.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'M3',
        text: 'Leading and lagging indicators are explicitly designated',
        guidance:
          'Designate which metrics are leading indicators (early signals) and which are lagging indicators (actual outcomes, typically assessed after at least 90 days).',
        helpText: 'Prevents premature conclusions from early operational data.',
        evidenceExpectations: 'Metrics register with leading/lagging classification and assessment window.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'M4',
        text: 'An adoption metric is defined and tracked',
        guidance:
          'Define what counts as an active user, genuine integration usage patterns, and the target adoption rate.',
        helpText: 'Adoption is a financial and governance variable, not a soft factor.',
        evidenceExpectations: 'Adoption metric definition and tracking dashboard/report.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'M5',
        text: 'A reporting cadence is defined for each metric category',
        guidance:
          'Define reporting frequency separately for activity metrics (continuous/weekly), outcome metrics (aligned to accumulation time), and governance metrics (every formal review cycle).',
        helpText: 'Identify a named metric reporting owner.',
        evidenceExpectations: 'Reporting schedule and metric owner assignment.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'M6',
        text: 'Metrics are reviewed against baseline at each cycle review',
        guidance:
          'Compare current outcome and adoption metrics against pre-deployment baselines during every formal cycle review.',
        helpText: 'Cycle reviews without baseline comparison cannot demonstrate value.',
        evidenceExpectations: 'Cycle review pack comparing current metrics to baseline.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'M7',
        text: 'The metric set has not been changed post-deployment to flatter performance',
        guidance:
          'Maintain metric integrity; any metric changes must follow governance review rather than post-hoc substitution.',
        helpText: 'Post-hoc rationalisation of metrics is a governance failure.',
        evidenceExpectations: 'Metric version history / change log.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'M8',
        text: 'Activity metrics are distinguished from outcome metrics in all reporting',
        guidance:
          'Ensure governance reports clearly separate activity metrics (throughput/volume), outcome metrics (value/change), and governance metrics (boundary adherence, override rate).',
        helpText: 'Activity metrics alone are insufficient for governance accountability.',
        evidenceExpectations: 'Sample governance report showing separate metric categories.',
        weight: 1,
        answerType: 'maturity_1_4'
      }
    ]
  },
  {
    code: 'EVALUATION',
    name: 'Evaluation',
    description:
      'Establishes the cadence, method, and accountability for ongoing review of the AI system performance, alignment with organisational objectives, and governance compliance.',
    orderIndex: 5,
    levelDescriptors: {
      '1': 'No formal review cadence. Governance is reactive, triggered by incidents.',
      '2': 'Reviews are scheduled but irregular. No consistent methodology. Action register exists but is not reviewed systematically.',
      '3': 'Reviews are conducted on schedule using a defined methodology. The action register is actively maintained. Adoption is reviewed at every cycle. Decommissioning criteria are documented.',
      '4': 'Review findings drive measurable improvements to governance practice. The organisation benchmarks its governance maturity across deployments and applies lessons learned systematically. Strategic reviews produce governance roadmaps, not just status assessments.'
    },
    questions: [
      {
        code: 'E1',
        text: 'A review schedule is documented with named responsible parties',
        guidance:
          'Document the schedule for 30-day check-in, 90-day cycle review, ongoing quarterly cycle reviews, and annual strategic reviews, with named responsible parties.',
        helpText: 'Book the first cycle review before deployment.',
        evidenceExpectations: 'Governance review calendar and named review leads.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'E2',
        text: 'A review methodology is defined with consistent structure and evidence requirements',
        guidance:
          'Define which dimensions are assessed, required evidence, documentation format, attendees, and escalation path for concerns.',
        helpText: 'A review without a defined methodology defaults to a status update meeting.',
        evidenceExpectations: 'Cycle review methodology / terms of reference.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'E3',
        text: 'Cycle reviews are conducted on schedule',
        guidance:
          'Execute cycle reviews on the documented quarterly cadence (and 30/90-day milestones).',
        helpText: 'Track completion dates against scheduled due dates.',
        evidenceExpectations: 'Completed cycle review records with timestamps.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'E4',
        text: 'Adoption is a standing agenda item at every cycle review',
        guidance:
          'Assess adoption trends alongside outcome metrics at every cycle review; treat declining adoption as a priority governance concern.',
        helpText: 'Adoption below 50% of target for two consecutive months should trigger an unscheduled review.',
        evidenceExpectations: 'Cycle review agenda template and minutes covering adoption.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'E5',
        text: 'A governance action register is maintained and reviewed at each cycle',
        guidance:
          'Maintain a register of governance actions with owners, due dates, and completion status, reviewed at the opening of each cycle review.',
        helpText: 'Actions not closed by the subsequent review require escalation.',
        evidenceExpectations: 'Active governance action register and review sign-off.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'E6',
        text: 'Cycle review findings are documented in a consistent format',
        guidance:
          'Produce a consistent governance summary (e.g. one-page summary) for the Governance Accountable Owner and risk/audit functions.',
        helpText: 'Includes AAEF performance profile cross-reference where applicable.',
        evidenceExpectations: 'Standardised cycle review summary reports.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'E7',
        text: 'Decommissioning criteria are documented',
        guidance:
          'Define explicit criteria triggering decommissioning consideration: sustained underperformance, persistent boundary violations, irreversible adoption decline, or regulatory/risk change.',
        helpText: 'Documenting exit criteria upfront avoids sunk-cost continuation.',
        evidenceExpectations: 'Decommissioning criteria specification.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'E8',
        text: 'Unscheduled reviews are triggered by defined events',
        guidance:
          'Define triggers for unscheduled reviews: Tier 3 violation, significant incident/near-miss, regulatory change, owner change, major capability change, or adoption below 50% for two months.',
        helpText: 'Record unscheduled review triggers in operational governance procedures.',
        evidenceExpectations: 'Unscheduled review trigger policy and incident-to-review records.',
        weight: 1,
        answerType: 'maturity_1_4'
      },
      {
        code: 'E9',
        text: 'Strategic reviews are conducted annually',
        guidance:
          'Conduct an annual full reassessment of alignment with organisational strategy, Focus appropriateness, Authority calibration, and ongoing cost/governance value.',
        helpText: 'At Level 4, strategic reviews produce governance roadmaps, not just status assessments.',
        evidenceExpectations: 'Annual strategic review report and roadmap.',
        weight: 1,
        answerType: 'maturity_1_4'
      }
    ]
  }
];

export interface ChecklistItemTemplate {
  code: string;
  sectionGroup: string;
  text: string;
  supportsNa: boolean;
  requiresNamedIndividual?: boolean;
}

export interface ChecklistSectionTemplate {
  section: 'pre_deployment' | 'operational_30d' | 'operational_90d' | 'quarterly';
  title: string;
  description: string;
  items: ChecklistItemTemplate[];
}

export const FRAME_CHECKLIST_TEMPLATES: readonly ChecklistSectionTemplate[] = [
  {
    section: 'pre_deployment',
    title: 'Section 1: Pre-Deployment Governance',
    description:
      'Complete all Section 1 items before entering production. Any incomplete items must be documented as exceptions with a resolution plan and deadline.',
    items: [
      { code: '1.1.1', sectionGroup: '1.1 Focus', text: 'Domain statement documented', supportsNa: false },
      { code: '1.1.2', sectionGroup: '1.1 Focus', text: 'Problem definition documented', supportsNa: false },
      { code: '1.1.3', sectionGroup: '1.1 Focus', text: 'Outcome statement documented, expressed as operational change', supportsNa: false },
      { code: '1.1.4', sectionGroup: '1.1 Focus', text: 'Scope boundaries documented (in-scope and out-of-scope)', supportsNa: false },
      { code: '1.1.5', sectionGroup: '1.1 Focus', text: 'Focus definition reviewed and approved by business owner', supportsNa: false },
      { code: '1.1.6', sectionGroup: '1.1 Focus', text: 'Focus definition reviewed by compliance/risk function (if applicable)', supportsNa: true },
      { code: '1.2.1', sectionGroup: '1.2 Roles', text: 'Business owner assigned', supportsNa: false, requiresNamedIndividual: true },
      { code: '1.2.2', sectionGroup: '1.2 Roles', text: 'Technology accountable owner assigned', supportsNa: false, requiresNamedIndividual: true },
      { code: '1.2.3', sectionGroup: '1.2 Roles', text: 'Operational oversight role assigned', supportsNa: false, requiresNamedIndividual: true },
      { code: '1.2.4', sectionGroup: '1.2 Roles', text: 'Escalation path documented', supportsNa: false },
      { code: '1.2.5', sectionGroup: '1.2 Roles', text: 'Escalation path tested and confirmed', supportsNa: false },
      { code: '1.2.6', sectionGroup: '1.2 Roles', text: 'Review and approval authority defined (if applicable)', supportsNa: true },
      { code: '1.2.7', sectionGroup: '1.2 Roles', text: 'Governance accountable owner assigned', supportsNa: false, requiresNamedIndividual: true },
      { code: '1.3.1', sectionGroup: '1.3 Authority', text: 'All action types identified', supportsNa: false },
      { code: '1.3.2', sectionGroup: '1.3 Authority', text: 'Tier 1 (autonomous) actions classified, specific and exhaustive', supportsNa: false },
      { code: '1.3.3', sectionGroup: '1.3 Authority', text: 'Tier 2 (confirmed) actions classified', supportsNa: false },
      { code: '1.3.4', sectionGroup: '1.3 Authority', text: 'Tier 3 (prohibited) actions classified, at minimum 3 items', supportsNa: false },
      { code: '1.3.5', sectionGroup: '1.3 Authority', text: 'Technical enforcement confirmed for all Tier 3 prohibitions', supportsNa: false },
      { code: '1.3.6', sectionGroup: '1.3 Authority', text: 'Boundary change control process documented', supportsNa: false },
      { code: '1.3.7', sectionGroup: '1.3 Authority', text: 'Boundary violation protocol documented', supportsNa: false },
      { code: '1.3.8', sectionGroup: '1.3 Authority', text: 'Authority boundaries tested against adversarial inputs', supportsNa: false },
      { code: '1.3.9', sectionGroup: '1.3 Authority', text: 'Workflow-level authority defined (agentic systems only)', supportsNa: true },
      { code: '1.4.1', sectionGroup: '1.4 Metrics', text: 'Outcome metrics defined, traceable to Focus outcome statement', supportsNa: false },
      { code: '1.4.2', sectionGroup: '1.4 Metrics', text: 'Pre-deployment baseline established for each outcome metric', supportsNa: false },
      { code: '1.4.3', sectionGroup: '1.4 Metrics', text: 'Leading indicators designated', supportsNa: false },
      { code: '1.4.4', sectionGroup: '1.4 Metrics', text: 'Lagging indicators designated with minimum assessment period', supportsNa: false },
      { code: '1.4.5', sectionGroup: '1.4 Metrics', text: 'Adoption metric defined with target rate', supportsNa: false },
      { code: '1.4.6', sectionGroup: '1.4 Metrics', text: 'Reporting cadence defined for each metric category', supportsNa: false },
      { code: '1.4.7', sectionGroup: '1.4 Metrics', text: 'Metric reporting owner identified', supportsNa: false },
      { code: '1.5.1', sectionGroup: '1.5 Evaluation', text: '30-day check-in scheduled', supportsNa: false },
      { code: '1.5.2', sectionGroup: '1.5 Evaluation', text: '90-day cycle review scheduled', supportsNa: false },
      { code: '1.5.3', sectionGroup: '1.5 Evaluation', text: 'Ongoing quarterly review schedule documented', supportsNa: false },
      { code: '1.5.4', sectionGroup: '1.5 Evaluation', text: 'Annual strategic review scheduled', supportsNa: false },
      { code: '1.5.5', sectionGroup: '1.5 Evaluation', text: 'Review methodology documented', supportsNa: false },
      { code: '1.5.6', sectionGroup: '1.5 Evaluation', text: 'Governance action register created', supportsNa: false },
      { code: '1.5.7', sectionGroup: '1.5 Evaluation', text: 'Decommissioning criteria documented', supportsNa: false },
      { code: '1.5.8', sectionGroup: '1.5 Evaluation', text: 'Unscheduled review triggers documented', supportsNa: false }
    ]
  },
  {
    section: 'operational_30d',
    title: 'Section 2.1: 30-Day Check-In',
    description: 'Operational health, early adoption signal, and boundary adherence check 30 days after go-live.',
    items: [
      { code: '2.1.1', sectionGroup: '30-Day Check-In', text: 'System operational with no critical incidents', supportsNa: false },
      { code: '2.1.2', sectionGroup: '30-Day Check-In', text: 'No Tier 3 boundary violations recorded', supportsNa: false },
      { code: '2.1.3', sectionGroup: '30-Day Check-In', text: 'Escalation path functioning as documented', supportsNa: false },
      { code: '2.1.4', sectionGroup: '30-Day Check-In', text: 'Early adoption signal reviewed', supportsNa: false },
      { code: '2.1.5', sectionGroup: '30-Day Check-In', text: 'Activity metrics within expected range', supportsNa: false },
      { code: '2.1.6', sectionGroup: '30-Day Check-In', text: 'Any open actions from pre-deployment governance reviewed', supportsNa: false }
    ]
  },
  {
    section: 'operational_90d',
    title: 'Section 2.2: 90-Day Cycle Review',
    description: 'First formal FRAME review across all five dimensions, baselines, adoption, and AAEF profile.',
    items: [
      { code: '2.2.1', sectionGroup: '90-Day Cycle Review', text: 'Open actions from 30-day check-in reviewed', supportsNa: false },
      { code: '2.2.2', sectionGroup: '90-Day Cycle Review', text: 'All five FRAME dimensions assessed', supportsNa: false },
      { code: '2.2.3', sectionGroup: '90-Day Cycle Review', text: 'Outcome metrics reviewed against baseline', supportsNa: false },
      { code: '2.2.4', sectionGroup: '90-Day Cycle Review', text: 'Adoption rate reviewed against target', supportsNa: false },
      { code: '2.2.5', sectionGroup: '90-Day Cycle Review', text: 'Governance metrics reviewed (boundary adherence, escalation accuracy)', supportsNa: false },
      { code: '2.2.6', sectionGroup: '90-Day Cycle Review', text: 'Performance profile assigned (see AAEF if applicable)', supportsNa: true },
      { code: '2.2.7', sectionGroup: '90-Day Cycle Review', text: 'Governance documentation updated to reflect current reality', supportsNa: false }
    ]
  },
  {
    section: 'quarterly',
    title: 'Section 2.3: Quarterly Cycle Review',
    description: 'Recurring quarterly governance review across all five FRAME dimensions.',
    items: [
      { code: '2.3.1', sectionGroup: 'Quarterly Review', text: 'Open actions from previous cycle reviewed', supportsNa: false },
      { code: '2.3.2', sectionGroup: 'Quarterly Review', text: 'Focus dimension: still accurate and appropriate?', supportsNa: false },
      { code: '2.3.3', sectionGroup: 'Quarterly Review', text: 'Roles dimension: all named individuals current?', supportsNa: false },
      { code: '2.3.4', sectionGroup: 'Quarterly Review', text: 'Authority dimension: tier classification still accurate?', supportsNa: false },
      { code: '2.3.5', sectionGroup: 'Quarterly Review', text: 'Metrics dimension: outcome metrics reviewed against baseline', supportsNa: false },
      { code: '2.3.6', sectionGroup: 'Quarterly Review', text: 'Adoption reviewed against target', supportsNa: false },
      { code: '2.3.7', sectionGroup: 'Quarterly Review', text: 'Governance metrics reviewed', supportsNa: false },
      { code: '2.3.8', sectionGroup: 'Quarterly Review', text: 'Any regulatory or risk environment changes affecting this deployment?', supportsNa: false },
      { code: '2.3.9', sectionGroup: 'Quarterly Review', text: 'Governance documentation updated', supportsNa: false }
    ]
  }
];
