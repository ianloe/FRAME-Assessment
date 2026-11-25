import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, desc, asc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  ActionPrioritySchema,
  ActionStatusSchema,
  AuditFindingStatusSchema,
  CreateActionSchema,
  CreateAuditFindingSchema,
  FRAME_CHECKLIST_TEMPLATES
} from '@frame/shared';
import { isEntityInScope } from '../services/scope.js';
import { writeAuditLog } from '../services/audit.js';
import { assertPermission, requireFullAuth } from '../middleware/auth.js';

export async function governanceRoutes(app: FastifyInstance) {
  // --- Dashboard (Role-Aware) ---
  app.get('/api/dashboard', { preHandler: requireFullAuth }, async (request) => {
    const auth = request.auth!;
    const query = z
      .object({
        organisationId: z.string().uuid().optional(),
        businessUnitId: z.string().uuid().optional(),
        riskTier: z.string().optional(),
        lifecycleStage: z.string().optional(),
        regulatoryTag: z.string().optional()
      })
      .parse(request.query);

    const allSystems = await db.select().from(schema.aiSystems);
    const scopedSystems = allSystems.filter((sys) => {
      if (sys.archivedAt) return false;
      if (
        !isEntityInScope(auth.role, auth.scopes, {
          organisationId: sys.organisationId,
          businessUnitId: sys.businessUnitId,
          aiSystemId: sys.id
        })
      ) {
        return false;
      }
      if (query.organisationId && sys.organisationId !== query.organisationId) return false;
      if (query.businessUnitId && sys.businessUnitId !== query.businessUnitId) return false;
      if (query.riskTier && sys.riskTier !== query.riskTier) return false;
      if (query.lifecycleStage && sys.lifecycleStage !== query.lifecycleStage) return false;
      if (query.regulatoryTag && !sys.regulatoryTags.includes(query.regulatoryTag)) return false;
      return true;
    });

    const systemIds = new Set(scopedSystems.map((s) => s.id));
    const allAssessments = await db
      .select()
      .from(schema.assessments)
      .orderBy(asc(schema.assessments.assessmentDate));
    const scopedAssessments = allAssessments.filter(
      (a) => systemIds.has(a.aiSystemId) && a.status !== 'archived'
    );

    const allActions = await db.select().from(schema.actions);
    const scopedActions = allActions.filter((a) => systemIds.has(a.aiSystemId));

    const allEvidence = await db.select().from(schema.evidence);
    const scopedEvidence = allEvidence.filter((e) => systemIds.has(e.aiSystemId));

    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    const assessmentsByStatus: Record<string, number> = {};
    for (const a of scopedAssessments) {
      assessmentsByStatus[a.status] = (assessmentsByStatus[a.status] ?? 0) + 1;
    }

    const overdueReviews = scopedAssessments.filter(
      (a) => a.nextReviewDue && a.nextReviewDue.getTime() < now && a.status !== 'archived'
    ).length;

    const openActions = scopedActions.filter((a) =>
      ['open', 'in_progress', 'overdue'].includes(a.status)
    ).length;

    const evidenceNearingExpiry = scopedEvidence.filter(
      (e) =>
        e.expiresAt &&
        e.expiresAt.getTime() >= now &&
        e.expiresAt.getTime() <= now + thirtyDaysMs
    ).length;

    // Average maturity by dimension across latest scored assessment per system
    const latestPerSystem = new Map<string, typeof scopedAssessments[number]>();
    for (const a of scopedAssessments) {
      if (a.overallScore !== null) {
        latestPerSystem.set(a.aiSystemId, a);
      }
    }

    const dimTotals: Record<string, { name: string; sum: number; count: number }> = {
      FOCUS: { name: 'Focus', sum: 0, count: 0 },
      ROLES: { name: 'Roles', sum: 0, count: 0 },
      AUTHORITY: { name: 'Authority', sum: 0, count: 0 },
      METRICS: { name: 'Metrics', sum: 0, count: 0 },
      EVALUATION: { name: 'Evaluation', sum: 0, count: 0 }
    };

    const heatmap: Array<{
      aiSystemId: string;
      name: string;
      riskTier: string;
      overallScore: number | null;
      dimensions: Record<string, number | null>;
    }> = [];

    for (const sys of scopedSystems) {
      const latest = latestPerSystem.get(sys.id);
      const dimScores: Record<string, number | null> = {
        FOCUS: null,
        ROLES: null,
        AUTHORITY: null,
        METRICS: null,
        EVALUATION: null
      };

      if (latest && Array.isArray(latest.dimensionScoresJson)) {
        for (const d of latest.dimensionScoresJson as Array<{
          dimensionCode: string;
          score: number | null;
        }>) {
          dimScores[d.dimensionCode] = d.score;
          if (d.score !== null && dimTotals[d.dimensionCode]) {
            dimTotals[d.dimensionCode].sum += d.score;
            dimTotals[d.dimensionCode].count += 1;
          }
        }
      }

      heatmap.push({
        aiSystemId: sys.id,
        name: sys.name,
        riskTier: sys.riskTier,
        overallScore: latest?.overallScore ?? null,
        dimensions: dimScores
      });
    }

    const portfolioDimensionAverages = Object.entries(dimTotals).map(([code, val]) => ({
      dimensionCode: code,
      dimensionName: val.name,
      averageScore: val.count > 0 ? Math.round((val.sum / val.count) * 100) / 100 : 0
    }));

    const trend = scopedAssessments
      .filter((a) => a.overallScore !== null)
      .map((a) => ({
        date: a.assessmentDate.toISOString().slice(0, 10),
        title: a.title,
        aiSystemId: a.aiSystemId,
        aiSystemName: scopedSystems.find((s) => s.id === a.aiSystemId)?.name ?? '',
        overallScore: a.overallScore
      }));

    return {
      summary: {
        totalAiSystems: scopedSystems.length,
        totalAssessments: scopedAssessments.length,
        assessmentsByStatus,
        overdueReviews,
        openActions,
        evidenceNearingExpiry
      },
      portfolioDimensionAverages,
      heatmap,
      trend
    };
  });

  // --- Remediation Actions ---
  app.get('/api/actions', { preHandler: requireFullAuth }, async (request) => {
    const auth = request.auth!;
    const allActions = await db.select().from(schema.actions).orderBy(desc(schema.actions.createdAt));
    const allSystems = await db.select().from(schema.aiSystems);
    const sysMap = new Map(allSystems.map((s) => [s.id, s]));

    const filtered = allActions.filter((a) => {
      const sys = sysMap.get(a.aiSystemId);
      if (!sys) return false;
      return isEntityInScope(auth.role, auth.scopes, {
        organisationId: sys.organisationId,
        businessUnitId: sys.businessUnitId,
        aiSystemId: sys.id
      });
    });

    return {
      actions: filtered.map((a) => ({
        ...a,
        aiSystemName: sysMap.get(a.aiSystemId)?.name ?? ''
      }))
    };
  });

  app.post('/api/actions', { preHandler: requireFullAuth }, async (request, reply) => {
    const auth = request.auth!;
    const body = CreateActionSchema.parse(request.body);
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
    if (!assertPermission(request, reply, 'action:create', { inScope })) return;

    const [created] = await db
      .insert(schema.actions)
      .values({
        aiSystemId: body.aiSystemId,
        assessmentId: body.assessmentId ?? null,
        questionId: body.questionId ?? null,
        title: body.title,
        description: body.description,
        ownerId: body.ownerId ?? auth.userId,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        priority: body.priority,
        status: 'open',
        createdBy: auth.userId
      })
      .returning();

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'action.create',
      entityType: 'action',
      entityId: created.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      afterJson: created
    });

    return reply.code(201).send(created);
  });

  app.post('/api/actions/suggest/:assessmentId', { preHandler: requireFullAuth }, async (request, reply) => {
    const auth = request.auth!;
    const { assessmentId } = z.object({ assessmentId: z.string().uuid() }).parse(request.params);
    const [assessment] = await db
      .select()
      .from(schema.assessments)
      .where(eq(schema.assessments.id, assessmentId))
      .limit(1);
    if (!assessment) return reply.code(404).send({ error: 'Assessment not found' });

    const [sys] = await db
      .select()
      .from(schema.aiSystems)
      .where(eq(schema.aiSystems.id, assessment.aiSystemId))
      .limit(1);
    if (!sys) return reply.code(404).send({ error: 'AI system not found' });

    const inScope = isEntityInScope(auth.role, auth.scopes, {
      organisationId: sys.organisationId,
      businessUnitId: sys.businessUnitId,
      aiSystemId: sys.id
    });
    if (!assertPermission(request, reply, 'action:create', { inScope })) return;

    const respRows = await db
      .select()
      .from(schema.responses)
      .where(eq(schema.responses.assessmentId, assessmentId));

    const lowScoring = respRows.filter((r) => !r.isNa && r.rating !== null && r.rating < 3);
    const allQs = await db.select().from(schema.questions);
    const qMap = new Map(allQs.map((q) => [q.id, q]));

    const suggestions = lowScoring.map((r) => {
      const q = qMap.get(r.questionId);
      return {
        aiSystemId: sys.id,
        assessmentId,
        questionId: r.questionId,
        title: `Remediate ${q?.code ?? 'indicator'} (rated ${r.rating}/4)`,
        description: q
          ? `Address gap for "${q.text}". Guidance: ${q.guidance}`
          : 'Address governance maturity gap.',
        priority: r.rating === 1 ? 'high' : 'medium'
      };
    });

    return { suggestions };
  });

  app.patch('/api/actions/:id', { preHandler: requireFullAuth }, async (request, reply) => {
    const auth = request.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [existing] = await db.select().from(schema.actions).where(eq(schema.actions.id, id)).limit(1);
    if (!existing) return reply.code(404).send({ error: 'Action not found' });

    const [sys] = await db
      .select()
      .from(schema.aiSystems)
      .where(eq(schema.aiSystems.id, existing.aiSystemId))
      .limit(1);
    if (!sys) return reply.code(404).send({ error: 'AI system not found' });

    const inScope = isEntityInScope(auth.role, auth.scopes, {
      organisationId: sys.organisationId,
      businessUnitId: sys.businessUnitId,
      aiSystemId: sys.id
    });
    if (!assertPermission(request, reply, 'action:edit', { inScope })) return;

    const body = z
      .object({
        status: ActionStatusSchema.optional(),
        priority: ActionPrioritySchema.optional(),
        closureNotes: z.string().max(2000).optional(),
        dueDate: z.string().nullable().optional()
      })
      .parse(request.body);

    const [updated] = await db
      .update(schema.actions)
      .set({
        status: body.status ?? existing.status,
        priority: body.priority ?? existing.priority,
        closureNotes: body.closureNotes ?? existing.closureNotes,
        dueDate: body.dueDate !== undefined ? (body.dueDate ? new Date(body.dueDate) : null) : existing.dueDate,
        updatedAt: new Date()
      })
      .where(eq(schema.actions.id, id))
      .returning();

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'action.update',
      entityType: 'action',
      entityId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      beforeJson: existing,
      afterJson: updated
    });

    return updated;
  });

  // --- Implementation Checklists ---
  app.get('/api/checklists/templates', { preHandler: requireFullAuth }, async () => {
    return { templates: FRAME_CHECKLIST_TEMPLATES };
  });

  app.post('/api/ai-systems/:id/checklists', { preHandler: requireFullAuth }, async (request, reply) => {
    const auth = request.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { section } = z
      .object({ section: z.enum(['pre_deployment', 'operational_30d', 'operational_90d', 'quarterly']) })
      .parse(request.body);

    const [sys] = await db.select().from(schema.aiSystems).where(eq(schema.aiSystems.id, id)).limit(1);
    if (!sys) return reply.code(404).send({ error: 'AI system not found' });

    const inScope = isEntityInScope(auth.role, auth.scopes, {
      organisationId: sys.organisationId,
      businessUnitId: sys.businessUnitId,
      aiSystemId: sys.id
    });
    if (!assertPermission(request, reply, 'checklist:edit', { inScope })) return;

    const template = FRAME_CHECKLIST_TEMPLATES.find((t) => t.section === section)!;
    const [created] = await db
      .insert(schema.checklistRuns)
      .values({
        aiSystemId: id,
        section: template.section,
        title: template.title,
        itemsJson: template.items.map((item) => ({
          code: item.code,
          sectionGroup: item.sectionGroup,
          text: item.text,
          status: 'pending' as const,
          notes: ''
        }))
      })
      .returning();

    return reply.code(201).send(created);
  });

  app.put('/api/checklists/:id', { preHandler: requireFullAuth }, async (request, reply) => {
    const auth = request.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [existing] = await db
      .select()
      .from(schema.checklistRuns)
      .where(eq(schema.checklistRuns.id, id))
      .limit(1);
    if (!existing) return reply.code(404).send({ error: 'Checklist run not found' });

    const [sys] = await db
      .select()
      .from(schema.aiSystems)
      .where(eq(schema.aiSystems.id, existing.aiSystemId))
      .limit(1);
    if (!sys) return reply.code(404).send({ error: 'AI system not found' });

    const inScope = isEntityInScope(auth.role, auth.scopes, {
      organisationId: sys.organisationId,
      businessUnitId: sys.businessUnitId,
      aiSystemId: sys.id
    });
    if (!assertPermission(request, reply, 'checklist:edit', { inScope })) return;

    const body = z
      .object({
        itemsJson: z.array(z.any()),
        signoffJson: z.any().optional()
      })
      .parse(request.body);

    const allDone = body.itemsJson.every((i) => i.status === 'complete' || i.status === 'na');
    const [updated] = await db
      .update(schema.checklistRuns)
      .set({
        itemsJson: body.itemsJson,
        signoffJson: body.signoffJson ?? existing.signoffJson,
        completedBy: allDone ? auth.userId : null,
        completedAt: allDone ? new Date() : null,
        updatedAt: new Date()
      })
      .where(eq(schema.checklistRuns.id, id))
      .returning();

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'checklist.update',
      entityType: 'checklist_run',
      entityId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? ''
    });

    return updated;
  });

  // --- Audit Findings & Observations ---
  app.get('/api/audit-findings', { preHandler: requireFullAuth }, async (request) => {
    const auth = request.auth!;
    const rows = await db
      .select()
      .from(schema.auditFindings)
      .orderBy(desc(schema.auditFindings.createdAt));
    const allSystems = await db.select().from(schema.aiSystems);
    const sysMap = new Map(allSystems.map((s) => [s.id, s]));

    const filtered = rows.filter((f) => {
      const sys = sysMap.get(f.aiSystemId);
      if (!sys) return false;
      return isEntityInScope(auth.role, auth.scopes, {
        organisationId: sys.organisationId,
        businessUnitId: sys.businessUnitId,
        aiSystemId: sys.id
      });
    });

    return {
      findings: filtered.map((f) => ({
        ...f,
        aiSystemName: sysMap.get(f.aiSystemId)?.name ?? ''
      }))
    };
  });

  app.post('/api/audit-findings', { preHandler: requireFullAuth }, async (request, reply) => {
    const auth = request.auth!;
    const body = CreateAuditFindingSchema.parse(request.body);
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
    if (!assertPermission(request, reply, 'audit_finding:create', { inScope })) return;

    const [created] = await db
      .insert(schema.auditFindings)
      .values({
        aiSystemId: body.aiSystemId,
        assessmentId: body.assessmentId ?? null,
        questionId: body.questionId ?? null,
        auditorId: auth.userId,
        title: body.title,
        observation: body.observation,
        severity: body.severity,
        status: 'open'
      })
      .returning();

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'audit_finding.create',
      entityType: 'audit_finding',
      entityId: created.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      afterJson: created
    });

    return reply.code(201).send(created);
  });

  app.post('/api/audit-findings/:id/respond', { preHandler: requireFullAuth }, async (request, reply) => {
    const auth = request.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { managementResponse, status } = z
      .object({
        managementResponse: z.string().trim().min(3).max(4000),
        status: AuditFindingStatusSchema.default('responded')
      })
      .parse(request.body);

    const [existing] = await db
      .select()
      .from(schema.auditFindings)
      .where(eq(schema.auditFindings.id, id))
      .limit(1);
    if (!existing) return reply.code(404).send({ error: 'Audit finding not found' });

    const [sys] = await db
      .select()
      .from(schema.aiSystems)
      .where(eq(schema.aiSystems.id, existing.aiSystemId))
      .limit(1);
    if (!sys) return reply.code(404).send({ error: 'AI system not found' });

    const inScope = isEntityInScope(auth.role, auth.scopes, {
      organisationId: sys.organisationId,
      businessUnitId: sys.businessUnitId,
      aiSystemId: sys.id
    });
    if (!assertPermission(request, reply, 'audit_finding:respond', { inScope })) return;

    const [updated] = await db
      .update(schema.auditFindings)
      .set({
        managementResponse,
        status,
        respondedBy: auth.userId,
        respondedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(schema.auditFindings.id, id))
      .returning();

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'audit_finding.respond',
      entityType: 'audit_finding',
      entityId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? ''
    });

    return updated;
  });

  // --- Notifications ---
  app.get('/api/notifications', { preHandler: requireFullAuth }, async (request) => {
    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, request.auth!.userId))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(50);
    return { notifications: rows };
  });

  app.post('/api/notifications/:id/read', { preHandler: requireFullAuth }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await db
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(eq(schema.notifications.id, id));
    return { ok: true };
  });
}
