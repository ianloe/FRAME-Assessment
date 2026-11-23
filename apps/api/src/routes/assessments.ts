import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, desc, asc, and, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  CreateAssessmentSchema,
  DEFAULT_SCORING_CONFIG,
  ReviewDecisionSchema,
  UpsertResponseSchema,
  calculateAssessmentScore,
  type ScoringConfig
} from '@frame/shared';
import { isEntityInScope } from '../services/scope.js';
import { writeAuditLog } from '../services/audit.js';
import { storageProvider } from '../services/storage.js';
import { assertPermission, requireFullAuth } from '../middleware/auth.js';

async function loadAssessmentBundle(assessmentId: string) {
  const [assessment] = await db
    .select()
    .from(schema.assessments)
    .where(eq(schema.assessments.id, assessmentId))
    .limit(1);
  if (!assessment) return null;

  const [aiSystem] = await db
    .select()
    .from(schema.aiSystems)
    .where(eq(schema.aiSystems.id, assessment.aiSystemId))
    .limit(1);
  if (!aiSystem) return null;

  const [qv] = await db
    .select()
    .from(schema.questionnaireVersions)
    .where(eq(schema.questionnaireVersions.id, assessment.questionnaireVersionId))
    .limit(1);

  const dims = await db
    .select()
    .from(schema.dimensions)
    .where(eq(schema.dimensions.questionnaireVersionId, assessment.questionnaireVersionId))
    .orderBy(asc(schema.dimensions.orderIndex));

  const selectedSet = new Set(assessment.selectedDimensionsJson);
  const activeDims = dims.filter((d) => selectedSet.has(d.code));

  const dimIds = activeDims.map((d) => d.id);
  const qs =
    dimIds.length > 0
      ? await db
          .select()
          .from(schema.questions)
          .where(inArray(schema.questions.dimensionId, dimIds))
          .orderBy(asc(schema.questions.orderIndex))
      : [];

  const respRows = await db
    .select()
    .from(schema.responses)
    .where(eq(schema.responses.assessmentId, assessmentId));

  const scoringConfig = (qv?.scoringConfigJson as ScoringConfig) ?? DEFAULT_SCORING_CONFIG;
  const dimById = new Map(activeDims.map((d) => [d.id, d]));

  const scoreInputQuestions = qs.map((q) => {
    const dim = dimById.get(q.dimensionId)!;
    return {
      id: q.id,
      code: q.code,
      dimensionCode: dim.code,
      dimensionName: dim.name,
      weight: q.weight
    };
  });

  const scoreResult = calculateAssessmentScore(
    scoreInputQuestions,
    respRows.map((r) => ({ questionId: r.questionId, rating: r.rating, isNa: r.isNa })),
    scoringConfig,
    aiSystem.targetMaturityLevel
  );

  return {
    assessment,
    aiSystem,
    questionnaireVersion: qv,
    dimensions: activeDims.map((d) => ({
      ...d,
      questions: qs.filter((q) => q.dimensionId === d.id)
    })),
    responses: respRows,
    scoringConfig,
    scoreResult
  };
}

export async function assessmentRoutes(app: FastifyInstance) {
  app.get('/api/assessments', { preHandler: requireFullAuth }, async (request) => {
    const auth = request.auth!;
    const query = z
      .object({
        status: z.string().optional(),
        aiSystemId: z.string().uuid().optional()
      })
      .parse(request.query);

    const allAssessments = await db
      .select()
      .from(schema.assessments)
      .orderBy(desc(schema.assessments.updatedAt));

    const allSystems = await db.select().from(schema.aiSystems);
    const sysMap = new Map(allSystems.map((s) => [s.id, s]));

    const filtered = allAssessments.filter((a) => {
      const sys = sysMap.get(a.aiSystemId);
      if (!sys) return false;
      if (
        !isEntityInScope(auth.role, auth.scopes, {
          organisationId: sys.organisationId,
          businessUnitId: sys.businessUnitId,
          aiSystemId: sys.id
        })
      ) {
        return false;
      }
      if (query.status && a.status !== query.status) return false;
      if (query.aiSystemId && a.aiSystemId !== query.aiSystemId) return false;
      return true;
    });

    return {
      assessments: filtered.map((a) => ({
        ...a,
        aiSystemName: sysMap.get(a.aiSystemId)?.name ?? '',
        riskTier: sysMap.get(a.aiSystemId)?.riskTier ?? 'medium'
      }))
    };
  });

  app.get('/api/assessments/:id', { preHandler: requireFullAuth }, async (request, reply) => {
    const auth = request.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const bundle = await loadAssessmentBundle(id);
    if (!bundle) return reply.code(404).send({ error: 'Assessment not found' });

    const inScope = isEntityInScope(auth.role, auth.scopes, {
      organisationId: bundle.aiSystem.organisationId,
      businessUnitId: bundle.aiSystem.businessUnitId,
      aiSystemId: bundle.aiSystem.id
    });
    if (!assertPermission(request, reply, 'assessment:view', { inScope })) return;

    if (auth.role === 'auditor') {
      await writeAuditLog({
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'auditor.view_assessment',
        entityType: 'assessment',
        entityId: id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? ''
      });
    }

    const evidenceRows = await db
      .select()
      .from(schema.evidence)
      .where(eq(schema.evidence.assessmentId, id))
      .orderBy(desc(schema.evidence.createdAt));

    const commentRows = await db
      .select()
      .from(schema.comments)
      .where(eq(schema.comments.assessmentId, id))
      .orderBy(asc(schema.comments.createdAt));

    const reviewRows = await db
      .select()
      .from(schema.reviewRecords)
      .where(eq(schema.reviewRecords.assessmentId, id))
      .orderBy(desc(schema.reviewRecords.createdAt));

    const findingRows = await db
      .select()
      .from(schema.auditFindings)
      .where(eq(schema.auditFindings.assessmentId, id))
      .orderBy(desc(schema.auditFindings.createdAt));

    let priorResponses: typeof bundle.responses = [];
    if (bundle.assessment.clonedFromId) {
      priorResponses = await db
        .select()
        .from(schema.responses)
        .where(eq(schema.responses.assessmentId, bundle.assessment.clonedFromId));
    }

    const users = await db
      .select({ id: schema.users.id, name: schema.users.name, role: schema.users.role })
      .from(schema.users);

    return {
      ...bundle,
      evidence: evidenceRows,
      comments: commentRows,
      reviews: reviewRows,
      auditFindings: findingRows,
      priorResponses,
      users
    };
  });

  app.post('/api/assessments', { preHandler: requireFullAuth }, async (request, reply) => {
    const auth = request.auth!;
    const body = CreateAssessmentSchema.parse(request.body);

    const [sys] = await db
      .select()
      .from(schema.aiSystems)
      .where(eq(schema.aiSystems.id, body.aiSystemId))
      .limit(1);
    if (!sys) return reply.code(404).send({ error: 'AI system not found' });

    const inScope = isEntityInScope(auth.role, auth.scopes, {
      organisationId: sys.organisationId,
      businessUnitId: sys.businessUnitId,
      aiSystemId: sys.id
    });
    if (!assertPermission(request, reply, 'assessment:create', { inScope })) return;

    let qvId = body.questionnaireVersionId;
    if (!qvId) {
      const [published] = await db
        .select()
        .from(schema.questionnaireVersions)
        .where(eq(schema.questionnaireVersions.status, 'published'))
        .orderBy(desc(schema.questionnaireVersions.publishedAt))
        .limit(1);
      if (!published) return reply.code(400).send({ error: 'No published FRAME questionnaire found' });
      qvId = published.id;
    }

    const [created] = await db
      .insert(schema.assessments)
      .values({
        aiSystemId: body.aiSystemId,
        questionnaireVersionId: qvId,
        title: body.title,
        scopeType: body.scopeType,
        selectedDimensionsJson: body.selectedDimensions,
        assessmentType: body.assessmentType,
        status: 'draft',
        assessorId: auth.userId,
        assessmentDate: body.assessmentDate ? new Date(body.assessmentDate) : new Date(),
        nextReviewDue: body.nextReviewDue ? new Date(body.nextReviewDue) : null,
        narrativeSummary: body.narrativeSummary
      })
      .returning();

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'assessment.create',
      entityType: 'assessment',
      entityId: created.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      afterJson: created
    });

    return reply.code(201).send(created);
  });

  app.post('/api/assessments/:id/clone', { preHandler: requireFullAuth }, async (request, reply) => {
    const auth = request.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { title } = z.object({ title: z.string().trim().min(2).max(200) }).parse(request.body);

    const bundle = await loadAssessmentBundle(id);
    if (!bundle) return reply.code(404).send({ error: 'Source assessment not found' });

    const inScope = isEntityInScope(auth.role, auth.scopes, {
      organisationId: bundle.aiSystem.organisationId,
      businessUnitId: bundle.aiSystem.businessUnitId,
      aiSystemId: bundle.aiSystem.id
    });
    if (!assertPermission(request, reply, 'assessment:create', { inScope })) return;

    const [cloned] = await db
      .insert(schema.assessments)
      .values({
        aiSystemId: bundle.aiSystem.id,
        questionnaireVersionId: bundle.assessment.questionnaireVersionId,
        title,
        scopeType: bundle.assessment.scopeType,
        selectedDimensionsJson: bundle.assessment.selectedDimensionsJson,
        assessmentType: 'periodic_review',
        status: 'in_progress',
        assessorId: auth.userId,
        clonedFromId: bundle.assessment.id,
        overallScore: bundle.assessment.overallScore,
        dimensionScoresJson: bundle.assessment.dimensionScoresJson,
        narrativeSummary: bundle.assessment.narrativeSummary
      })
      .returning();

    if (bundle.responses.length > 0) {
      await db.insert(schema.responses).values(
        bundle.responses.map((r) => ({
          assessmentId: cloned.id,
          questionId: r.questionId,
          rating: r.rating,
          rationale: r.rationale,
          confidence: r.confidence,
          isNa: r.isNa,
          naJustification: r.naJustification,
          responderId: auth.userId
        }))
      );
    }

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'assessment.clone',
      entityType: 'assessment',
      entityId: cloned.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      afterJson: { clonedFromId: id }
    });

    return reply.code(201).send(cloned);
  });

  app.put('/api/assessments/:id/responses', { preHandler: requireFullAuth }, async (request, reply) => {
    const auth = request.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = UpsertResponseSchema.parse(request.body);

    const bundle = await loadAssessmentBundle(id);
    if (!bundle) return reply.code(404).send({ error: 'Assessment not found' });

    const inScope = isEntityInScope(auth.role, auth.scopes, {
      organisationId: bundle.aiSystem.organisationId,
      businessUnitId: bundle.aiSystem.businessUnitId,
      aiSystemId: bundle.aiSystem.id
    });
    if (!assertPermission(request, reply, 'assessment:answer', { inScope })) return;

    if (bundle.assessment.status === 'approved' || bundle.assessment.status === 'archived') {
      return reply.code(400).send({ error: 'Approved or archived assessments are locked' });
    }

    const [existing] = await db
      .select()
      .from(schema.responses)
      .where(
        and(
          eq(schema.responses.assessmentId, id),
          eq(schema.responses.questionId, body.questionId)
        )
      )
      .limit(1);

    if (existing && body.expectedVersion !== undefined && existing.version !== body.expectedVersion) {
      return reply.code(409).send({
        error: 'This indicator was updated by another user. Refresh to see the latest version.',
        currentVersion: existing.version
      });
    }

    let saved;
    if (existing) {
      const [updated] = await db
        .update(schema.responses)
        .set({
          rating: body.isNa ? null : body.rating,
          rationale: body.rationale,
          confidence: body.confidence,
          isNa: body.isNa,
          naJustification: body.isNa ? body.naJustification : '',
          responderId: auth.userId,
          version: existing.version + 1,
          updatedAt: new Date()
        })
        .where(eq(schema.responses.id, existing.id))
        .returning();
      saved = updated;
    } else {
      const [inserted] = await db
        .insert(schema.responses)
        .values({
          assessmentId: id,
          questionId: body.questionId,
          rating: body.isNa ? null : body.rating,
          rationale: body.rationale,
          confidence: body.confidence,
          isNa: body.isNa,
          naJustification: body.isNa ? body.naJustification : '',
          responderId: auth.userId,
          version: 1
        })
        .returning();
      saved = inserted;
    }

    await db.insert(schema.responseHistory).values({
      responseId: saved.id,
      assessmentId: id,
      questionId: body.questionId,
      rating: saved.rating,
      rationale: saved.rationale,
      confidence: saved.confidence,
      isNa: saved.isNa,
      naJustification: saved.naJustification,
      changedBy: auth.userId
    });

    // Recompute score & move status from draft -> in_progress
    const updatedBundle = await loadAssessmentBundle(id);
    if (updatedBundle) {
      const nextStatus =
        updatedBundle.assessment.status === 'draft' ? 'in_progress' : updatedBundle.assessment.status;
      await db
        .update(schema.assessments)
        .set({
          status: nextStatus,
          overallScore: updatedBundle.scoreResult.overallScore,
          dimensionScoresJson: updatedBundle.scoreResult.dimensions,
          updatedAt: new Date()
        })
        .where(eq(schema.assessments.id, id));
    }

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'response.upsert',
      entityType: 'response',
      entityId: saved.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      beforeJson: existing ?? null,
      afterJson: saved
    });

    return {
      response: saved,
      scoreResult: updatedBundle?.scoreResult
    };
  });

  app.post('/api/assessments/:id/submit', { preHandler: requireFullAuth }, async (request, reply) => {
    const auth = request.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { narrativeSummary } = z
      .object({ narrativeSummary: z.string().max(4000).optional() })
      .parse(request.body ?? {});

    const bundle = await loadAssessmentBundle(id);
    if (!bundle) return reply.code(404).send({ error: 'Assessment not found' });

    const inScope = isEntityInScope(auth.role, auth.scopes, {
      organisationId: bundle.aiSystem.organisationId,
      businessUnitId: bundle.aiSystem.businessUnitId,
      aiSystemId: bundle.aiSystem.id
    });
    if (!assertPermission(request, reply, 'assessment:submit', { inScope })) return;

    if (!['draft', 'in_progress', 'changes_requested'].includes(bundle.assessment.status)) {
      return reply.code(400).send({ error: 'Assessment cannot be submitted from its current status' });
    }

    // Completeness validation
    const respByQ = new Map(bundle.responses.map((r) => [r.questionId, r]));
    const gaps: Array<{ code: string; reason: string }> = [];
    const reqAbove = bundle.scoringConfig.rationaleRequiredAboveRating ?? 3;

    for (const dim of bundle.dimensions) {
      for (const q of dim.questions) {
        const r = respByQ.get(q.id);
        if (!r) {
          gaps.push({ code: q.code, reason: 'Indicator has not been answered' });
          continue;
        }
        if (r.isNa) {
          if (!r.naJustification.trim()) {
            gaps.push({ code: q.code, reason: 'N/A justification is required' });
          }
          continue;
        }
        if (!r.rating || r.rating < 1 || r.rating > 4) {
          gaps.push({ code: q.code, reason: 'Maturity rating (1 to 4) is required' });
          continue;
        }
        if (r.rating >= reqAbove && r.rationale.trim().length < 5) {
          gaps.push({
            code: q.code,
            reason: `Rationale is required for maturity rating ${r.rating} (>= ${reqAbove})`
          });
        }
      }
    }

    if (gaps.length > 0) {
      return reply.code(400).send({
        error: 'Assessment has incomplete indicators or missing required rationales',
        gaps
      });
    }

    const [updated] = await db
      .update(schema.assessments)
      .set({
        status: 'submitted',
        assessorId: bundle.assessment.assessorId ?? auth.userId,
        narrativeSummary: narrativeSummary ?? bundle.assessment.narrativeSummary,
        overallScore: bundle.scoreResult.overallScore,
        dimensionScoresJson: bundle.scoreResult.dimensions,
        updatedAt: new Date()
      })
      .where(eq(schema.assessments.id, id))
      .returning();

    await db.insert(schema.reviewRecords).values({
      assessmentId: id,
      reviewerId: auth.userId,
      decision: 'submitted',
      reason: 'Submitted for independent governance review.'
    });

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'assessment.submit',
      entityType: 'assessment',
      entityId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      afterJson: { overallScore: updated.overallScore }
    });

    return updated;
  });

  app.post('/api/assessments/:id/review', { preHandler: requireFullAuth }, async (request, reply) => {
    const auth = request.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = ReviewDecisionSchema.parse(request.body);

    const bundle = await loadAssessmentBundle(id);
    if (!bundle) return reply.code(404).send({ error: 'Assessment not found' });

    const inScope = isEntityInScope(auth.role, auth.scopes, {
      organisationId: bundle.aiSystem.organisationId,
      businessUnitId: bundle.aiSystem.businessUnitId,
      aiSystemId: bundle.aiSystem.id
    });

    const isOwnerOrAuthor = bundle.assessment.assessorId === auth.userId;
    if (
      !assertPermission(request, reply, 'assessment:review', {
        inScope,
        isOwnerOrAuthor
      })
    ) {
      return;
    }

    if (!['submitted', 'in_review'].includes(bundle.assessment.status)) {
      return reply.code(400).send({ error: 'Assessment must be submitted before review' });
    }

    const now = new Date();
    const isApproved = body.decision === 'approved';
    const snapshot = isApproved
      ? {
          score: bundle.scoreResult,
          responses: bundle.responses,
          approvedBy: auth.name,
          approvedAt: now.toISOString()
        }
      : bundle.assessment.approvedSnapshotJson;

    const [updated] = await db
      .update(schema.assessments)
      .set({
        status: body.decision,
        reviewerId: auth.userId,
        approvedAt: isApproved ? now : null,
        approvedSnapshotJson: snapshot,
        updatedAt: now
      })
      .where(eq(schema.assessments.id, id))
      .returning();

    await db.insert(schema.reviewRecords).values({
      assessmentId: id,
      reviewerId: auth.userId,
      decision: body.decision,
      reason: body.reason
    });

    if (bundle.assessment.assessorId) {
      await db.insert(schema.notifications).values({
        userId: bundle.assessment.assessorId,
        title: `Assessment ${body.decision.replace('_', ' ')}`,
        body: `${bundle.assessment.title} was marked ${body.decision} by ${auth.name}: ${body.reason}`,
        link: `/assessments/${id}`
      });
    }

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: `assessment.review_${body.decision}`,
      entityType: 'assessment',
      entityId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      afterJson: { decision: body.decision, reason: body.reason }
    });

    return updated;
  });

  app.post('/api/assessments/:id/archive', { preHandler: requireFullAuth }, async (request, reply) => {
    const auth = request.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const bundle = await loadAssessmentBundle(id);
    if (!bundle) return reply.code(404).send({ error: 'Assessment not found' });

    const inScope = isEntityInScope(auth.role, auth.scopes, {
      organisationId: bundle.aiSystem.organisationId,
      businessUnitId: bundle.aiSystem.businessUnitId,
      aiSystemId: bundle.aiSystem.id
    });

    const allowed = assertPermission(request, reply, 'assessment:archive_own_draft', {
      inScope,
      isOwnerOrAuthor: bundle.assessment.assessorId === auth.userId,
      isDraft: bundle.assessment.status === 'draft'
    });
    if (!allowed) return;

    await db
      .update(schema.assessments)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(eq(schema.assessments.id, id));

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'assessment.archive',
      entityType: 'assessment',
      entityId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? ''
    });

    return { ok: true };
  });

  // Comments
  app.post('/api/assessments/:id/comments', { preHandler: requireFullAuth }, async (request, reply) => {
    const auth = request.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        questionId: z.string().uuid(),
        parentId: z.string().uuid().nullable().optional(),
        body: z.string().trim().min(1).max(3000)
      })
      .parse(request.body);

    const bundle = await loadAssessmentBundle(id);
    if (!bundle) return reply.code(404).send({ error: 'Assessment not found' });

    const inScope = isEntityInScope(auth.role, auth.scopes, {
      organisationId: bundle.aiSystem.organisationId,
      businessUnitId: bundle.aiSystem.businessUnitId,
      aiSystemId: bundle.aiSystem.id
    });
    if (!assertPermission(request, reply, 'assessment:answer', { inScope })) return;

    const [comment] = await db
      .insert(schema.comments)
      .values({
        assessmentId: id,
        questionId: body.questionId,
        parentId: body.parentId ?? null,
        authorId: auth.userId,
        body: body.body
      })
      .returning();

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'comment.create',
      entityType: 'comment',
      entityId: comment.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? ''
    });

    return reply.code(201).send(comment);
  });

  // Evidence (Link & File Upload)
  app.post('/api/assessments/:id/evidence/link', { preHandler: requireFullAuth }, async (request, reply) => {
    const auth = request.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        responseId: z.string().uuid().nullable().optional(),
        title: z.string().trim().min(2).max(200),
        description: z.string().max(1000).default(''),
        evidenceType: z.string().default('other'),
        url: z.string().url(),
        expiresAt: z.string().nullable().optional()
      })
      .parse(request.body);

    const bundle = await loadAssessmentBundle(id);
    if (!bundle) return reply.code(404).send({ error: 'Assessment not found' });

    const inScope = isEntityInScope(auth.role, auth.scopes, {
      organisationId: bundle.aiSystem.organisationId,
      businessUnitId: bundle.aiSystem.businessUnitId,
      aiSystemId: bundle.aiSystem.id
    });
    if (!assertPermission(request, reply, 'assessment:answer', { inScope })) return;

    const [ev] = await db
      .insert(schema.evidence)
      .values({
        aiSystemId: bundle.aiSystem.id,
        assessmentId: id,
        responseId: body.responseId ?? null,
        kind: 'link',
        title: body.title,
        description: body.description,
        evidenceType: body.evidenceType,
        url: body.url,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        uploadedBy: auth.userId
      })
      .returning();

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'evidence.link_add',
      entityType: 'evidence',
      entityId: ev.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? ''
    });

    return reply.code(201).send(ev);
  });

  app.post('/api/assessments/:id/evidence/file', { preHandler: requireFullAuth }, async (request, reply) => {
    const auth = request.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    const bundle = await loadAssessmentBundle(id);
    if (!bundle) return reply.code(404).send({ error: 'Assessment not found' });

    const inScope = isEntityInScope(auth.role, auth.scopes, {
      organisationId: bundle.aiSystem.organisationId,
      businessUnitId: bundle.aiSystem.businessUnitId,
      aiSystemId: bundle.aiSystem.id
    });
    if (!assertPermission(request, reply, 'assessment:answer', { inScope })) return;

    const filePart = await request.file();
    if (!filePart) {
      return reply.code(400).send({ error: 'No file uploaded' });
    }

    const buffer = await filePart.toBuffer();
    const fields = filePart.fields as Record<string, { value?: string } | undefined>;
    const title = fields.title?.value || filePart.filename;
    const description = fields.description?.value || '';
    const evidenceType = fields.evidenceType?.value || 'other';
    const responseId = fields.responseId?.value || null;

    const stored = await storageProvider.save(buffer, filePart.filename, filePart.mimetype);

    const [ev] = await db
      .insert(schema.evidence)
      .values({
        aiSystemId: bundle.aiSystem.id,
        assessmentId: id,
        responseId,
        kind: 'file',
        title,
        description,
        evidenceType,
        filePath: stored.storageKey,
        originalFilename: filePart.filename,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        sha256Hash: stored.sha256Hash,
        uploadedBy: auth.userId
      })
      .returning();

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'evidence.file_upload',
      entityType: 'evidence',
      entityId: ev.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      afterJson: { originalFilename: ev.originalFilename, sha256Hash: ev.sha256Hash }
    });

    return reply.code(201).send(ev);
  });

  app.get('/api/evidence/:id/download', { preHandler: requireFullAuth }, async (request, reply) => {
    const auth = request.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [ev] = await db.select().from(schema.evidence).where(eq(schema.evidence.id, id)).limit(1);
    if (!ev || ev.kind !== 'file' || !ev.filePath) {
      return reply.code(404).send({ error: 'Evidence file not found' });
    }

    const [sys] = await db
      .select()
      .from(schema.aiSystems)
      .where(eq(schema.aiSystems.id, ev.aiSystemId))
      .limit(1);
    if (!sys) return reply.code(404).send({ error: 'AI system not found' });

    const inScope = isEntityInScope(auth.role, auth.scopes, {
      organisationId: sys.organisationId,
      businessUnitId: sys.businessUnitId,
      aiSystemId: sys.id
    });
    if (!assertPermission(request, reply, 'assessment:view', { inScope })) return;

    const data = await storageProvider.read(ev.filePath);
    const safeFilename = (ev.originalFilename ?? 'evidence').replace(/["\r\n]/g, '_');

    return reply
      .header('Content-Type', ev.mimeType ?? 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${safeFilename}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .send(data);
  });
}
