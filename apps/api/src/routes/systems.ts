import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, desc, asc, isNull } from 'drizzle-orm';
import { parse as parseCsv } from 'csv-parse/sync';
import { stringify as stringifyCsv } from 'csv-stringify/sync';
import { db, schema } from '../db/index.js';
import { CreateAISystemSchema } from '@frame/shared';
import { isEntityInScope } from '../services/scope.js';
import { writeAuditLog } from '../services/audit.js';
import { assertPermission, requireFullAuth, requireStepUp } from '../middleware/auth.js';

export async function systemRoutes(app: FastifyInstance) {
  app.get('/api/ai-systems', { preHandler: requireFullAuth }, async (request) => {
    const auth = request.auth!;
    const query = z
      .object({
        search: z.string().optional(),
        organisationId: z.string().uuid().optional(),
        businessUnitId: z.string().uuid().optional(),
        lifecycleStage: z.string().optional(),
        riskTier: z.string().optional(),
        regulatoryTag: z.string().optional(),
        includeArchived: z.coerce.boolean().default(false)
      })
      .parse(request.query);

    const allSystems = await db
      .select()
      .from(schema.aiSystems)
      .orderBy(asc(schema.aiSystems.name));

    const scoped = allSystems.filter((sys) => {
      if (!query.includeArchived && sys.archivedAt) return false;
      if (!isEntityInScope(auth.role, auth.scopes, {
        organisationId: sys.organisationId,
        businessUnitId: sys.businessUnitId,
        aiSystemId: sys.id
      })) {
        return false;
      }
      if (query.organisationId && sys.organisationId !== query.organisationId) return false;
      if (query.businessUnitId && sys.businessUnitId !== query.businessUnitId) return false;
      if (query.lifecycleStage && sys.lifecycleStage !== query.lifecycleStage) return false;
      if (query.riskTier && sys.riskTier !== query.riskTier) return false;
      if (query.regulatoryTag && !sys.regulatoryTags.includes(query.regulatoryTag)) return false;
      if (query.search) {
        const s = query.search.toLowerCase();
        if (
          !sys.name.toLowerCase().includes(s) &&
          !sys.description.toLowerCase().includes(s) &&
          !sys.aaefReference.toLowerCase().includes(s)
        ) {
          return false;
        }
      }
      return true;
    });

    return { aiSystems: scoped };
  });

  app.get('/api/ai-systems/export/csv', { preHandler: requireStepUp }, async (request, reply) => {
    const auth = request.auth!;
    if (!assertPermission(request, reply, 'report:export', { inScope: true })) return;

    const allSystems = await db
      .select()
      .from(schema.aiSystems)
      .where(isNull(schema.aiSystems.archivedAt))
      .orderBy(asc(schema.aiSystems.name));

    const scoped = allSystems.filter((sys) =>
      isEntityInScope(auth.role, auth.scopes, {
        organisationId: sys.organisationId,
        businessUnitId: sys.businessUnitId,
        aiSystemId: sys.id
      })
    );

    const csv = stringifyCsv(
      scoped.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        lifecycleStage: s.lifecycleStage,
        deploymentType: s.deploymentType,
        vendorOrInhouse: s.vendorOrInhouse,
        modelAndPlatform: s.modelAndPlatform,
        dataClassification: s.dataClassification,
        regulatoryTags: s.regulatoryTags.join('; '),
        riskTier: s.riskTier,
        targetMaturityLevel: s.targetMaturityLevel,
        aaefReference: s.aaefReference,
        aaefUrl: s.aaefUrl
      })),
      { header: true }
    );

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'ai_system.export_csv',
      entityType: 'ai_system',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      afterJson: { count: scoped.length }
    });

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="frame-ai-systems.csv"')
      .send(csv);
  });

  app.get('/api/ai-systems/:id', { preHandler: requireFullAuth }, async (request, reply) => {
    const auth = request.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [sys] = await db.select().from(schema.aiSystems).where(eq(schema.aiSystems.id, id)).limit(1);
    if (!sys) return reply.code(404).send({ error: 'AI system not found' });

    const inScope = isEntityInScope(auth.role, auth.scopes, {
      organisationId: sys.organisationId,
      businessUnitId: sys.businessUnitId,
      aiSystemId: sys.id
    });
    if (!assertPermission(request, reply, 'ai_system:view', { inScope })) return;

    if (auth.role === 'auditor') {
      await writeAuditLog({
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'auditor.view_ai_system',
        entityType: 'ai_system',
        entityId: sys.id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? ''
      });
    }

    const systemAssessments = await db
      .select()
      .from(schema.assessments)
      .where(eq(schema.assessments.aiSystemId, id))
      .orderBy(desc(schema.assessments.assessmentDate));

    const systemActions = await db
      .select()
      .from(schema.actions)
      .where(eq(schema.actions.aiSystemId, id))
      .orderBy(desc(schema.actions.createdAt));

    const systemChecklists = await db
      .select()
      .from(schema.checklistRuns)
      .where(eq(schema.checklistRuns.aiSystemId, id))
      .orderBy(desc(schema.checklistRuns.createdAt));

    const systemEvidence = await db
      .select()
      .from(schema.evidence)
      .where(eq(schema.evidence.aiSystemId, id))
      .orderBy(desc(schema.evidence.createdAt));

    const systemFindings = await db
      .select()
      .from(schema.auditFindings)
      .where(eq(schema.auditFindings.aiSystemId, id))
      .orderBy(desc(schema.auditFindings.createdAt));

    return {
      aiSystem: sys,
      assessments: systemAssessments,
      actions: systemActions,
      checklists: systemChecklists,
      evidence: systemEvidence,
      auditFindings: systemFindings
    };
  });

  app.post('/api/ai-systems', { preHandler: requireFullAuth }, async (request, reply) => {
    const auth = request.auth!;
    const body = CreateAISystemSchema.parse(request.body);
    const inScope = isEntityInScope(auth.role, auth.scopes, {
      organisationId: body.organisationId,
      businessUnitId: body.businessUnitId ?? null
    });
    if (!assertPermission(request, reply, 'ai_system:create', { inScope })) return;

    const [created] = await db
      .insert(schema.aiSystems)
      .values({
        organisationId: body.organisationId,
        businessUnitId: body.businessUnitId ?? null,
        ownerId: body.ownerId ?? auth.userId,
        name: body.name,
        description: body.description,
        lifecycleStage: body.lifecycleStage,
        deploymentType: body.deploymentType,
        vendorOrInhouse: body.vendorOrInhouse,
        modelAndPlatform: body.modelAndPlatform,
        dataClassification: body.dataClassification,
        regulatoryTags: body.regulatoryTags,
        riskTier: body.riskTier,
        targetMaturityLevel: body.targetMaturityLevel,
        aaefReference: body.aaefReference,
        aaefUrl: body.aaefUrl,
        documentationLinks: body.documentationLinks
      })
      .returning();

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'ai_system.create',
      entityType: 'ai_system',
      entityId: created.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      afterJson: created
    });

    return reply.code(201).send(created);
  });

  app.put('/api/ai-systems/:id', { preHandler: requireFullAuth }, async (request, reply) => {
    const auth = request.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [existing] = await db.select().from(schema.aiSystems).where(eq(schema.aiSystems.id, id)).limit(1);
    if (!existing) return reply.code(404).send({ error: 'AI system not found' });

    const inScope = isEntityInScope(auth.role, auth.scopes, {
      organisationId: existing.organisationId,
      businessUnitId: existing.businessUnitId,
      aiSystemId: existing.id
    });
    if (!assertPermission(request, reply, 'ai_system:edit', { inScope })) return;

    const body = CreateAISystemSchema.partial().parse(request.body);
    const [updated] = await db
      .update(schema.aiSystems)
      .set({
        ...body,
        updatedAt: new Date()
      })
      .where(eq(schema.aiSystems.id, id))
      .returning();

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'ai_system.update',
      entityType: 'ai_system',
      entityId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      beforeJson: existing,
      afterJson: updated
    });

    return updated;
  });

  app.delete('/api/ai-systems/:id', { preHandler: requireStepUp }, async (request, reply) => {
    const auth = request.auth!;
    if (!assertPermission(request, reply, 'ai_system:archive')) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [existing] = await db.select().from(schema.aiSystems).where(eq(schema.aiSystems.id, id)).limit(1);
    if (!existing) return reply.code(404).send({ error: 'AI system not found' });

    await db
      .update(schema.aiSystems)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.aiSystems.id, id));

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'ai_system.archive',
      entityType: 'ai_system',
      entityId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      beforeJson: { archivedAt: existing.archivedAt },
      afterJson: { archivedAt: new Date().toISOString() }
    });

    return { ok: true };
  });

  // CSV Bulk Import Preview & Commit
  app.post('/api/ai-systems/import-preview', { preHandler: requireFullAuth }, async (request, reply) => {
    const auth = request.auth!;
    const { csvText, organisationId } = z
      .object({ csvText: z.string().min(1).max(500000), organisationId: z.string().uuid() })
      .parse(request.body);

    const inScope = isEntityInScope(auth.role, auth.scopes, { organisationId });
    if (!assertPermission(request, reply, 'ai_system:create', { inScope })) return;

    const records = parseCsv(csvText, { columns: true, skip_empty_lines: true, trim: true }) as Array<
      Record<string, string>
    >;

    const preview = records.map((row, index) => {
      const parsed = CreateAISystemSchema.safeParse({
        organisationId,
        name: row.name ?? row.Name ?? '',
        description: row.description ?? row.Description ?? '',
        lifecycleStage: (row.lifecycleStage ?? row.lifecycle_stage ?? 'pilot').toLowerCase(),
        deploymentType: (row.deploymentType ?? row.deployment_type ?? 'assistant').toLowerCase(),
        vendorOrInhouse: (row.vendorOrInhouse ?? row.vendor_or_inhouse ?? 'in_house').toLowerCase(),
        modelAndPlatform: row.modelAndPlatform ?? row.model_and_platform ?? '',
        dataClassification: row.dataClassification ?? row.data_classification ?? 'Internal',
        regulatoryTags: (row.regulatoryTags ?? row.regulatory_tags ?? '')
          .split(';')
          .map((t) => t.trim())
          .filter(Boolean),
        riskTier: (row.riskTier ?? row.risk_tier ?? 'medium').toLowerCase(),
        targetMaturityLevel: Number(row.targetMaturityLevel ?? row.target_maturity_level ?? 3) || 3,
        aaefReference: row.aaefReference ?? row.aaef_reference ?? '',
        aaefUrl: row.aaefUrl ?? row.aaef_url ?? ''
      });
      return {
        rowNumber: index + 1,
        valid: parsed.success,
        data: parsed.success ? parsed.data : null,
        errors: parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
      };
    });

    return { rows: preview, validCount: preview.filter((r) => r.valid).length };
  });

  app.post('/api/ai-systems/import', { preHandler: requireFullAuth }, async (request, reply) => {
    const auth = request.auth!;
    const { items } = z.object({ items: z.array(CreateAISystemSchema).min(1).max(200) }).parse(request.body);

    const createdIds: string[] = [];
    for (const item of items) {
      const inScope = isEntityInScope(auth.role, auth.scopes, {
        organisationId: item.organisationId,
        businessUnitId: item.businessUnitId ?? null
      });
      if (!assertPermission(request, reply, 'ai_system:create', { inScope })) return;

      const [created] = await db
        .insert(schema.aiSystems)
        .values({
          ...item,
          ownerId: item.ownerId ?? auth.userId
        })
        .returning();
      createdIds.push(created.id);
    }

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'ai_system.bulk_import',
      entityType: 'ai_system',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      afterJson: { importedCount: createdIds.length }
    });

    return reply.code(201).send({ importedCount: createdIds.length, ids: createdIds });
  });
}
