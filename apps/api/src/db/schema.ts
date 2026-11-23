import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  doublePrecision,
  timestamp,
  jsonb,
  bigint,
  index,
  uniqueIndex,
  type AnyPgColumn
} from 'drizzle-orm/pg-core';

export const organisations = pgTable('organisations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

export const businessUnits = pgTable(
  'business_units',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => businessUnits.id, {
      onDelete: 'set null'
    }),
    name: text('name').notNull(),
    code: text('code').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('bu_org_idx').on(table.organisationId)]
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash'),
    role: text('role').notNull().default('user'), // admin | user | auditor
    isReviewer: boolean('is_reviewer').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('users_role_idx').on(table.role)]
);

export const userScopes = pgTable(
  'user_scopes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organisationId: uuid('organisation_id').references(() => organisations.id, {
      onDelete: 'cascade'
    }),
    businessUnitId: uuid('business_unit_id').references(() => businessUnits.id, {
      onDelete: 'cascade'
    }),
    aiSystemId: uuid('ai_system_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('user_scopes_user_idx').on(table.userId)]
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: text('role').notNull().default('user'),
    isReviewer: boolean('is_reviewer').notNull().default(false),
    scopeJson: jsonb('scope_json').$type<{
      organisationIds: string[];
      businessUnitIds: string[];
      aiSystemIds: string[];
    }>().notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('invitations_email_idx').on(table.email)]
);

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    csrfSecret: text('csrf_secret').notNull(),
    ipAddress: text('ip_address').notNull().default(''),
    userAgent: text('user_agent').notNull().default(''),
    mfaVerified: boolean('mfa_verified').notNull().default(false),
    authMethod: text('auth_method').notNull().default('password'), // password | passkey
    stepUpVerifiedAt: timestamp('step_up_verified_at', { withTimezone: true }),
    idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('sessions_user_idx').on(table.userId)]
);

export const webauthnChallenges = pgTable('webauthn_challenges', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  challenge: text('challenge').notNull().unique(),
  purpose: text('purpose').notNull(), // registration | authentication | step_up
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

export const webauthnCredentials = pgTable(
  'webauthn_credentials',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    credentialId: text('credential_id').notNull().unique(),
    publicKey: text('public_key').notNull(), // base64url
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    transports: jsonb('transports').$type<string[]>().notNull().default([]),
    friendlyName: text('friendly_name').notNull().default('Passkey'),
    deviceType: text('device_type').notNull().default('singleDevice'),
    backedUp: boolean('backed_up').notNull().default(false),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('webauthn_user_idx').on(table.userId)]
);

export const totpSecrets = pgTable('totp_secrets', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  encryptedSecret: text('encrypted_secret').notNull(),
  keyVersion: text('key_version').notNull().default('v1'),
  verified: boolean('verified').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

export const recoveryCodes = pgTable(
  'recovery_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('recovery_codes_user_idx').on(table.userId)]
);

export const authEvents = pgTable(
  'auth_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    email: text('email').notNull().default(''),
    eventType: text('event_type').notNull(),
    success: boolean('success').notNull(),
    ipAddress: text('ip_address').notNull().default(''),
    userAgent: text('user_agent').notNull().default(''),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('auth_events_user_idx').on(table.userId, table.createdAt)]
);

export const aiSystems = pgTable(
  'ai_systems',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    businessUnitId: uuid('business_unit_id').references(() => businessUnits.id, {
      onDelete: 'set null'
    }),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    lifecycleStage: text('lifecycle_stage').notNull().default('pilot'),
    deploymentType: text('deployment_type').notNull().default('assistant'),
    vendorOrInhouse: text('vendor_or_inhouse').notNull().default('in_house'),
    modelAndPlatform: text('model_and_platform').notNull().default(''),
    dataClassification: text('data_classification').notNull().default('Internal'),
    regulatoryTags: jsonb('regulatory_tags').$type<string[]>().notNull().default([]),
    riskTier: text('risk_tier').notNull().default('medium'),
    targetMaturityLevel: doublePrecision('target_maturity_level').notNull().default(3),
    aaefReference: text('aaef_reference').notNull().default(''),
    aaefUrl: text('aaef_url').notNull().default(''),
    documentationLinks: jsonb('documentation_links').$type<string[]>().notNull().default([]),
    isDemo: boolean('is_demo').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index('ai_systems_org_idx').on(table.organisationId),
    index('ai_systems_bu_idx').on(table.businessUnitId)
  ]
);

export const questionnaireVersions = pgTable('questionnaire_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  versionLabel: text('version_label').notNull().unique(),
  status: text('status').notNull().default('draft'), // draft | published | archived
  notes: text('notes').notNull().default(''),
  maturityLevelsJson: jsonb('maturity_levels_json').notNull(),
  scoringConfigJson: jsonb('scoring_config_json').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

export const dimensions = pgTable(
  'dimensions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    questionnaireVersionId: uuid('questionnaire_version_id')
      .notNull()
      .references(() => questionnaireVersions.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    orderIndex: integer('order_index').notNull(),
    levelDescriptorsJson: jsonb('level_descriptors_json').$type<Record<string, string>>().notNull()
  },
  (table) => [index('dimensions_qv_idx').on(table.questionnaireVersionId)]
);

export const questions = pgTable(
  'questions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    dimensionId: uuid('dimension_id')
      .notNull()
      .references(() => dimensions.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    text: text('text').notNull(),
    guidance: text('guidance').notNull(),
    helpText: text('help_text').notNull().default(''),
    evidenceExpectations: text('evidence_expectations').notNull().default(''),
    weight: doublePrecision('weight').notNull().default(1),
    answerType: text('answer_type').notNull().default('maturity_1_4'),
    applicabilityCondition: text('applicability_condition'),
    orderIndex: integer('order_index').notNull()
  },
  (table) => [index('questions_dim_idx').on(table.dimensionId)]
);

export const assessments = pgTable(
  'assessments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    aiSystemId: uuid('ai_system_id')
      .notNull()
      .references(() => aiSystems.id, { onDelete: 'cascade' }),
    questionnaireVersionId: uuid('questionnaire_version_id')
      .notNull()
      .references(() => questionnaireVersions.id),
    title: text('title').notNull(),
    scopeType: text('scope_type').notNull().default('full'), // full | partial
    selectedDimensionsJson: jsonb('selected_dimensions_json').$type<string[]>().notNull(),
    assessmentType: text('assessment_type').notNull().default('baseline'),
    status: text('status').notNull().default('draft'),
    assessorId: uuid('assessor_id').references(() => users.id, { onDelete: 'set null' }),
    reviewerId: uuid('reviewer_id').references(() => users.id, { onDelete: 'set null' }),
    clonedFromId: uuid('cloned_from_id').references((): AnyPgColumn => assessments.id, {
      onDelete: 'set null'
    }),
    assessmentDate: timestamp('assessment_date', { withTimezone: true }).defaultNow().notNull(),
    nextReviewDue: timestamp('next_review_due', { withTimezone: true }),
    overallScore: doublePrecision('overall_score'),
    dimensionScoresJson: jsonb('dimension_scores_json'),
    narrativeSummary: text('narrative_summary').notNull().default(''),
    version: integer('version').notNull().default(1),
    approvedSnapshotJson: jsonb('approved_snapshot_json'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index('assessments_system_idx').on(table.aiSystemId),
    index('assessments_status_idx').on(table.status)
  ]
);

export const responses = pgTable(
  'responses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    rating: integer('rating'),
    rationale: text('rationale').notNull().default(''),
    confidence: text('confidence').notNull().default('medium'),
    isNa: boolean('is_na').notNull().default(false),
    naJustification: text('na_justification').notNull().default(''),
    responderId: uuid('responder_id').references(() => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    uniqueIndex('responses_assessment_question_uniq').on(table.assessmentId, table.questionId),
    index('responses_assessment_idx').on(table.assessmentId)
  ]
);

export const responseHistory = pgTable(
  'response_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    responseId: uuid('response_id')
      .notNull()
      .references(() => responses.id, { onDelete: 'cascade' }),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    rating: integer('rating'),
    rationale: text('rationale').notNull().default(''),
    confidence: text('confidence').notNull().default('medium'),
    isNa: boolean('is_na').notNull().default(false),
    naJustification: text('na_justification').notNull().default(''),
    changedBy: uuid('changed_by').references(() => users.id, { onDelete: 'set null' }),
    changedAt: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('response_history_resp_idx').on(table.responseId)]
);

export const evidence = pgTable(
  'evidence',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    aiSystemId: uuid('ai_system_id')
      .notNull()
      .references(() => aiSystems.id, { onDelete: 'cascade' }),
    assessmentId: uuid('assessment_id').references(() => assessments.id, { onDelete: 'cascade' }),
    responseId: uuid('response_id').references(() => responses.id, { onDelete: 'set null' }),
    kind: text('kind').notNull().default('file'), // file | link
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    evidenceType: text('evidence_type').notNull().default('other'),
    filePath: text('file_path'),
    originalFilename: text('original_filename'),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    sha256Hash: text('sha256_hash'),
    url: text('url'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index('evidence_assessment_idx').on(table.assessmentId),
    index('evidence_system_idx').on(table.aiSystemId)
  ]
);

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => comments.id, {
      onDelete: 'cascade'
    }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    mentionsJson: jsonb('mentions_json').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('comments_assessment_q_idx').on(table.assessmentId, table.questionId)]
);

export const actions = pgTable(
  'actions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    aiSystemId: uuid('ai_system_id')
      .notNull()
      .references(() => aiSystems.id, { onDelete: 'cascade' }),
    assessmentId: uuid('assessment_id').references(() => assessments.id, { onDelete: 'set null' }),
    questionId: uuid('question_id').references(() => questions.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    dueDate: timestamp('due_date', { withTimezone: true }),
    priority: text('priority').notNull().default('medium'),
    status: text('status').notNull().default('open'),
    closureNotes: text('closure_notes').notNull().default(''),
    closureEvidenceId: uuid('closure_evidence_id').references(() => evidence.id, {
      onDelete: 'set null'
    }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index('actions_system_idx').on(table.aiSystemId),
    index('actions_status_idx').on(table.status)
  ]
);

export const checklistRuns = pgTable(
  'checklist_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    aiSystemId: uuid('ai_system_id')
      .notNull()
      .references(() => aiSystems.id, { onDelete: 'cascade' }),
    section: text('section').notNull(), // pre_deployment | operational_30d | operational_90d | quarterly
    title: text('title').notNull(),
    itemsJson: jsonb('items_json')
      .$type<
        Array<{
          code: string;
          sectionGroup: string;
          text: string;
          status: 'pending' | 'complete' | 'na';
          namedIndividual?: string;
          completedDate?: string;
          notes?: string;
        }>
      >()
      .notNull(),
    signoffJson: jsonb('signoff_json')
      .$type<{
        businessOwnerName?: string;
        businessOwnerDate?: string;
        techOwnerName?: string;
        techOwnerDate?: string;
        governanceOwnerName?: string;
        governanceOwnerDate?: string;
        exceptions?: Array<{
          item: string;
          reason: string;
          resolutionPlan: string;
          dueDate: string;
          owner: string;
        }>;
      }>()
      .notNull()
      .default({}),
    completedBy: uuid('completed_by').references(() => users.id, { onDelete: 'set null' }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('checklist_runs_system_idx').on(table.aiSystemId)]
);

export const reviewRecords = pgTable(
  'review_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    reviewerId: uuid('reviewer_id').references(() => users.id, { onDelete: 'set null' }),
    decision: text('decision').notNull(),
    reason: text('reason').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('review_records_assessment_idx').on(table.assessmentId)]
);

export const auditFindings = pgTable(
  'audit_findings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    aiSystemId: uuid('ai_system_id')
      .notNull()
      .references(() => aiSystems.id, { onDelete: 'cascade' }),
    assessmentId: uuid('assessment_id').references(() => assessments.id, { onDelete: 'set null' }),
    questionId: uuid('question_id').references(() => questions.id, { onDelete: 'set null' }),
    auditorId: uuid('auditor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    observation: text('observation').notNull(),
    severity: text('severity').notNull().default('medium'),
    status: text('status').notNull().default('open'),
    managementResponse: text('management_response').notNull().default(''),
    respondedBy: uuid('responded_by').references(() => users.id, { onDelete: 'set null' }),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index('audit_findings_system_idx').on(table.aiSystemId),
    index('audit_findings_assessment_idx').on(table.assessmentId)
  ]
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    seq: bigint('seq', { mode: 'number' }).notNull().unique(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorRole: text('actor_role').notNull().default('system'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull().default(''),
    ipAddress: text('ip_address').notNull().default(''),
    userAgent: text('user_agent').notNull().default(''),
    beforeJson: jsonb('before_json'),
    afterJson: jsonb('after_json'),
    prevHash: text('prev_hash').notNull(),
    rowHash: text('row_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index('audit_logs_actor_idx').on(table.actorId),
    index('audit_logs_entity_idx').on(table.entityType, table.entityId),
    index('audit_logs_created_idx').on(table.createdAt)
  ]
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    link: text('link').notNull().default(''),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index('notifications_user_idx').on(table.userId)]
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  valueJson: jsonb('value_json').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});
