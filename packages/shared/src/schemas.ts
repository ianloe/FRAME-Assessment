import { z } from 'zod';

export const RoleSchema = z.enum(['admin', 'user', 'auditor']);

export const LifecycleStageSchema = z.enum(['idea', 'pilot', 'production', 'retired']);
export const DeploymentTypeSchema = z.enum([
  'assistant',
  'copilot',
  'autonomous_agent',
  'multi_agent',
  'predictive_model',
  'other'
]);
export const RiskTierSchema = z.enum(['low', 'medium', 'high', 'critical']);

export const AssessmentTypeSchema = z.enum([
  'baseline',
  'periodic_review',
  'pre_deployment',
  'post_incident'
]);

export const AssessmentStatusSchema = z.enum([
  'draft',
  'in_progress',
  'submitted',
  'in_review',
  'changes_requested',
  'approved',
  'archived'
]);

export const ConfidenceSchema = z.enum(['low', 'medium', 'high']);

export const EvidenceTypeSchema = z.enum([
  'policy',
  'screenshot',
  'log',
  'report',
  'contract',
  'other'
]);

export const ActionPrioritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export const ActionStatusSchema = z.enum(['open', 'in_progress', 'completed', 'overdue', 'cancelled']);

export const AuditFindingSeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export const AuditFindingStatusSchema = z.enum([
  'open',
  'clarification_requested',
  'responded',
  'closed'
]);

export const PasswordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters long')
  .max(128, 'Password must be 128 characters or fewer');

export const CreateInvitationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().toLowerCase(),
  role: RoleSchema,
  isReviewer: z.boolean().default(false),
  organisationIds: z.array(z.string().uuid()).default([]),
  businessUnitIds: z.array(z.string().uuid()).default([]),
  aiSystemIds: z.array(z.string().uuid()).default([])
});

export const AcceptInvitationSchema = z.object({
  token: z.string().min(16),
  password: PasswordSchema
});

export const LoginPasswordSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(1).max(128)
});

export const CreateAISystemSchema = z.object({
  organisationId: z.string().uuid(),
  businessUnitId: z.string().uuid().nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().min(1).max(4000),
  lifecycleStage: z.string().trim().min(1).max(60),
  deploymentType: z.string().trim().min(1).max(60),
  vendorOrInhouse: z.enum(['in_house', 'vendor', 'hybrid']).default('in_house'),
  modelAndPlatform: z.string().trim().max(300).default(''),
  dataClassification: z.string().trim().max(120).default('Internal'),
  regulatoryTags: z.array(z.string().trim().max(60)).default([]),
  riskTier: z.string().trim().min(1).max(60).default('medium'),
  targetMaturityLevel: z.number().min(1).max(4).default(3),
  aaefReference: z.string().trim().max(500).default(''),
  aaefUrl: z
    .string()
    .trim()
    .url()
    .or(z.literal(''))
    .default(''),
  documentationLinks: z.array(z.string().trim().url()).default([])
});

export const CreateAssessmentSchema = z.object({
  aiSystemId: z.string().uuid(),
  questionnaireVersionId: z.string().uuid().optional(),
  title: z.string().trim().min(2).max(200),
  scopeType: z.enum(['full', 'partial']).default('full'),
  selectedDimensions: z
    .array(z.enum(['FOCUS', 'ROLES', 'AUTHORITY', 'METRICS', 'EVALUATION']))
    .default(['FOCUS', 'ROLES', 'AUTHORITY', 'METRICS', 'EVALUATION']),
  assessmentType: AssessmentTypeSchema.default('baseline'),
  assessmentDate: z.string().optional(),
  nextReviewDue: z.string().nullable().optional(),
  narrativeSummary: z.string().max(4000).default('')
});

export const UpsertResponseSchema = z.object({
  questionId: z.string().uuid(),
  rating: z.number().int().min(1).max(4).nullable(),
  rationale: z.string().max(5000).default(''),
  confidence: ConfidenceSchema.default('medium'),
  isNa: z.boolean().default(false),
  naJustification: z.string().max(2000).default(''),
  expectedVersion: z.number().int().min(0).optional()
});

export const ReviewDecisionSchema = z.object({
  decision: z.enum(['in_review', 'changes_requested', 'approved']),
  reason: z.string().trim().min(3).max(2000)
});

export const CreateActionSchema = z.object({
  aiSystemId: z.string().uuid(),
  assessmentId: z.string().uuid().nullable().optional(),
  questionId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(3000).default(''),
  ownerId: z.string().uuid().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  priority: ActionPrioritySchema.default('medium')
});

export const CreateAuditFindingSchema = z.object({
  aiSystemId: z.string().uuid(),
  assessmentId: z.string().uuid().nullable().optional(),
  questionId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(3).max(200),
  observation: z.string().trim().min(5).max(5000),
  severity: AuditFindingSeveritySchema.default('medium')
});
