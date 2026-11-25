import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, asc, desc, inArray } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  convertInchesToTwip
} from 'docx';
import archiver from 'archiver';
import { PassThrough } from 'node:stream';
import { stringify as stringifyCsv } from 'csv-stringify/sync';
import { db, schema } from '../db/index.js';
import {
  DEFAULT_SCORING_CONFIG,
  calculateAssessmentScore,
  type ScoringConfig
} from '@frame/shared';
import { isEntityInScope } from '../services/scope.js';
import { writeAuditLog } from '../services/audit.js';
import { sha256Hex } from '../services/crypto.js';
import { storageProvider } from '../services/storage.js';
import { DEFAULT_BRANDING_SETTINGS, getSetting, type BrandingSettings } from '../services/settings.js';
import { assertPermission, requireStepUp } from '../middleware/auth.js';

const FRAME_ATTRIBUTION =
  'FRAME ("A governance framework for enterprise AI deployment") by Ian Loe, Tactics Solutions, licensed under CC BY-NC 4.0.';

async function getAssessmentReportData(assessmentId: string) {
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

  const evidenceRows = await db
    .select()
    .from(schema.evidence)
    .where(eq(schema.evidence.assessmentId, assessmentId));

  const actionRows = await db
    .select()
    .from(schema.actions)
    .where(eq(schema.actions.assessmentId, assessmentId));

  const reviewRows = await db
    .select()
    .from(schema.reviewRecords)
    .where(eq(schema.reviewRecords.assessmentId, assessmentId))
    .orderBy(desc(schema.reviewRecords.createdAt));

  const findingRows = await db
    .select()
    .from(schema.auditFindings)
    .where(eq(schema.auditFindings.assessmentId, assessmentId));

  const scoringConfig = (qv?.scoringConfigJson as ScoringConfig) ?? DEFAULT_SCORING_CONFIG;
  const dimById = new Map(activeDims.map((d) => [d.id, d]));

  const scoreResult = calculateAssessmentScore(
    qs.map((q) => ({
      id: q.id,
      code: q.code,
      dimensionCode: dimById.get(q.dimensionId)!.code,
      dimensionName: dimById.get(q.dimensionId)!.name,
      weight: q.weight
    })),
    respRows.map((r) => ({ questionId: r.questionId, rating: r.rating, isNa: r.isNa })),
    scoringConfig,
    aiSystem.targetMaturityLevel
  );

  const branding = await getSetting<BrandingSettings>('branding', DEFAULT_BRANDING_SETTINGS);

  return {
    assessment,
    aiSystem,
    questionnaireVersion: qv,
    dimensions: activeDims.map((d) => ({
      ...d,
      questions: qs.filter((q) => q.dimensionId === d.id)
    })),
    responses: respRows,
    evidence: evidenceRows,
    actions: actionRows,
    reviews: reviewRows,
    findings: findingRows,
    scoreResult,
    branding
  };
}

async function generateAssessmentPdfBuffer(
  data: NonNullable<Awaited<ReturnType<typeof getAssessmentReportData>>>
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const accent = data.branding.accentColour || '#0f766e';

    // Header
    doc.fillColor(accent).fontSize(18).text(data.branding.organisationName, { align: 'left' });
    doc.fillColor('#111827').fontSize(15).text(`FRAME Assessment Report: ${data.assessment.title}`);
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#4b5563');
    doc.text(`AI System: ${data.aiSystem.name} (${data.aiSystem.riskTier.toUpperCase()} risk tier)`);
    doc.text(`Status: ${data.assessment.status.toUpperCase()} | Type: ${data.assessment.assessmentType}`);
    doc.text(
      `Assessment Date: ${data.assessment.assessmentDate.toISOString().slice(0, 10)} | Questionnaire: ${data.questionnaireVersion?.versionLabel ?? 'FRAME v1.0'}`
    );
    if (data.aiSystem.aaefReference) {
      doc.text(`AAEF Cross-Reference: ${data.aiSystem.aaefReference}`);
    }
    doc.moveDown(1);

    // Executive Summary & Score
    doc.fillColor(accent).fontSize(13).text('1. Executive Summary & Score Derivation');
    doc.fillColor('#111827').fontSize(10).moveDown(0.3);
    doc.text(
      `Overall Maturity Score: ${data.scoreResult.overallScore !== null ? `${data.scoreResult.overallScore.toFixed(2)} / 4.00` : 'Not scored'} | Target: ${data.scoreResult.targetMaturityLevel.toFixed(2)}`
    );
    if (data.scoreResult.band) {
      doc.text(`Maturity Band: ${data.scoreResult.band.label}`);
      doc.text(data.scoreResult.band.guidance);
    }
    doc.moveDown(0.3);
    doc.text(`Score Derivation: ${data.scoreResult.derivationSummary}`);
    if (data.assessment.narrativeSummary) {
      doc.moveDown(0.3);
      doc.text(`Narrative Summary: ${data.assessment.narrativeSummary}`);
    }
    doc.moveDown(0.8);

    // Dimension Scores
    doc.fillColor(accent).fontSize(13).text('2. Dimension Maturity Profile');
    doc.fillColor('#111827').fontSize(10).moveDown(0.3);
    for (const d of data.scoreResult.dimensions) {
      doc.text(
        `- ${d.dimensionName}: ${d.score !== null ? d.score.toFixed(2) : 'N/A'} (${d.levelLabel}) | Applicable: ${d.applicableCount}, N/A: ${d.naCount}, Gap to Target: ${d.gapToTarget !== null ? d.gapToTarget.toFixed(2) : 'N/A'}`
      );
    }
    doc.moveDown(0.8);

    // Per-Dimension Indicator Responses
    doc.fillColor(accent).fontSize(13).text('3. Detailed Indicator Findings');
    doc.fillColor('#111827').fontSize(9.5).moveDown(0.3);
    const respMap = new Map(data.responses.map((r) => [r.questionId, r]));
    for (const dim of data.dimensions) {
      doc.font('Helvetica-Bold').fontSize(11).text(dim.name);
      doc.font('Helvetica').fontSize(9.5);
      for (const q of dim.questions) {
        const r = respMap.get(q.id);
        const ratingLabel = r?.isNa
          ? `N/A (${r.naJustification || 'No justification'})`
          : r?.rating
            ? `${r.rating}/4 (Confidence: ${r.confidence})`
            : 'Unanswered';
        doc.text(`${q.code}: ${q.text} -> ${ratingLabel}`);
        if (r?.rationale) {
          doc.fillColor('#374151').text(`   Rationale: ${r.rationale}`);
          doc.fillColor('#111827');
        }
      }
      doc.moveDown(0.4);
    }

    // Remediation Actions
    doc.fillColor(accent).fontSize(13).text('4. Remediation Actions');
    doc.fillColor('#111827').fontSize(10).moveDown(0.3);
    if (data.actions.length === 0) {
      doc.text('No remediation actions linked to this assessment.');
    } else {
      for (const act of data.actions) {
        doc.text(
          `- [${act.priority.toUpperCase()} / ${act.status}] ${act.title}${act.dueDate ? ` (Due: ${act.dueDate.toISOString().slice(0, 10)})` : ''}`
        );
      }
    }
    doc.moveDown(0.8);

    // Evidence Index
    doc.fillColor(accent).fontSize(13).text('5. Evidence Index');
    doc.fillColor('#111827').fontSize(10).moveDown(0.3);
    if (data.evidence.length === 0) {
      doc.text('No evidence items attached.');
    } else {
      for (const ev of data.evidence) {
        doc.text(
          `- [${ev.evidenceType}] ${ev.title} (${ev.kind === 'file' ? `SHA-256: ${ev.sha256Hash}` : ev.url})`
        );
      }
    }
    doc.moveDown(0.8);

    // Sign-off Block
    doc.fillColor(accent).fontSize(13).text('6. Governance Review & Sign-Off');
    doc.fillColor('#111827').fontSize(10).moveDown(0.3);
    if (data.reviews.length === 0) {
      doc.text('No review decisions recorded yet.');
    } else {
      for (const rev of data.reviews) {
        doc.text(
          `- ${rev.decision.toUpperCase()} on ${rev.createdAt.toISOString().slice(0, 10)}: ${rev.reason}`
        );
      }
    }

    doc.moveDown(1.2);
    doc.fontSize(8.5).fillColor('#6b7280').text(FRAME_ATTRIBUTION);

    doc.end();
  });
}

async function generateAssessmentDocxBuffer(
  data: NonNullable<Awaited<ReturnType<typeof getAssessmentReportData>>>
): Promise<Buffer> {
  const respMap = new Map(data.responses.map((r) => [r.questionId, r]));

  const dimensionRows = [
    new TableRow({
      children: ['Dimension', 'Score', 'Level', 'Applicable', 'N/A', 'Gap to Target'].map(
        (h) =>
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })]
          })
      )
    }),
    ...data.scoreResult.dimensions.map(
      (d) =>
        new TableRow({
          children: [
            d.dimensionName,
            d.score !== null ? d.score.toFixed(2) : 'N/A',
            d.levelLabel,
            String(d.applicableCount),
            String(d.naCount),
            d.gapToTarget !== null ? d.gapToTarget.toFixed(2) : 'N/A'
          ].map((val) => new TableCell({ children: [new Paragraph(val)] }))
        })
    )
  ];

  const indicatorParagraphs: Paragraph[] = [];
  for (const dim of data.dimensions) {
    indicatorParagraphs.push(
      new Paragraph({ text: dim.name, heading: HeadingLevel.HEADING_2, spacing: { before: 200 } })
    );
    for (const q of dim.questions) {
      const r = respMap.get(q.id);
      const val = r?.isNa
        ? `N/A (${r.naJustification})`
        : r?.rating
          ? `${r.rating}/4 (${r.confidence} confidence)`
          : 'Unanswered';
      indicatorParagraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${q.code}: ${q.text} `, bold: true }),
            new TextRun({ text: `[${val}]` })
          ]
        })
      );
      if (r?.rationale) {
        indicatorParagraphs.push(new Paragraph({ text: `Rationale: ${r.rationale}` }));
      }
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: convertInchesToTwip(8.27), // A4 width
              height: convertInchesToTwip(11.69) // A4 height
            }
          }
        },
        children: [
          new Paragraph({ text: data.branding.organisationName, heading: HeadingLevel.HEADING_2 }),
          new Paragraph({
            text: `FRAME Assessment Report: ${data.assessment.title}`,
            heading: HeadingLevel.HEADING_1
          }),
          new Paragraph(
            `AI System: ${data.aiSystem.name} | Risk Tier: ${data.aiSystem.riskTier} | Status: ${data.assessment.status}`
          ),
          new Paragraph(
            `Overall Score: ${data.scoreResult.overallScore !== null ? data.scoreResult.overallScore.toFixed(2) : 'Not scored'} / 4.00 (Target: ${data.scoreResult.targetMaturityLevel})`
          ),
          new Paragraph(`Score Derivation: ${data.scoreResult.derivationSummary}`),
          new Paragraph({ text: 'Dimension Maturity Profile', heading: HeadingLevel.HEADING_2 }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: dimensionRows
          }),
          ...indicatorParagraphs,
          new Paragraph({ text: 'Evidence Index', heading: HeadingLevel.HEADING_2 }),
          ...(data.evidence.length === 0
            ? [new Paragraph('No evidence attached.')]
            : data.evidence.map(
                (e) =>
                  new Paragraph(
                    `${e.title} [${e.evidenceType}] - ${e.kind === 'file' ? `SHA-256: ${e.sha256Hash}` : e.url}`
                  )
              )),
          new Paragraph({ text: 'Licence & Attribution', heading: HeadingLevel.HEADING_2 }),
          new Paragraph(FRAME_ATTRIBUTION)
        ]
      }
    ]
  });

  return Packer.toBuffer(doc);
}

export async function reportRoutes(app: FastifyInstance) {
  app.get('/api/reports/assessments/:id/pdf', { preHandler: requireStepUp }, async (request, reply) => {
    const auth = request.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const data = await getAssessmentReportData(id);
    if (!data) return reply.code(404).send({ error: 'Assessment not found' });

    const inScope = isEntityInScope(auth.role, auth.scopes, {
      organisationId: data.aiSystem.organisationId,
      businessUnitId: data.aiSystem.businessUnitId,
      aiSystemId: data.aiSystem.id
    });
    if (!assertPermission(request, reply, 'report:export', { inScope })) return;

    const pdfBuffer = await generateAssessmentPdfBuffer(data);
    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'report.export_pdf',
      entityType: 'assessment',
      entityId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? ''
    });

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="frame-assessment-${id.slice(0, 8)}.pdf"`)
      .send(pdfBuffer);
  });

  app.get('/api/reports/assessments/:id/docx', { preHandler: requireStepUp }, async (request, reply) => {
    const auth = request.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const data = await getAssessmentReportData(id);
    if (!data) return reply.code(404).send({ error: 'Assessment not found' });

    const inScope = isEntityInScope(auth.role, auth.scopes, {
      organisationId: data.aiSystem.organisationId,
      businessUnitId: data.aiSystem.businessUnitId,
      aiSystemId: data.aiSystem.id
    });
    if (!assertPermission(request, reply, 'report:export', { inScope })) return;

    const docxBuffer = await generateAssessmentDocxBuffer(data);
    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'report.export_docx',
      entityType: 'assessment',
      entityId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? ''
    });

    return reply
      .header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )
      .header('Content-Disposition', `attachment; filename="frame-assessment-${id.slice(0, 8)}.docx"`)
      .send(docxBuffer);
  });

  app.get('/api/reports/assessments/:id/json', { preHandler: requireStepUp }, async (request, reply) => {
    const auth = request.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const data = await getAssessmentReportData(id);
    if (!data) return reply.code(404).send({ error: 'Assessment not found' });

    const inScope = isEntityInScope(auth.role, auth.scopes, {
      organisationId: data.aiSystem.organisationId,
      businessUnitId: data.aiSystem.businessUnitId,
      aiSystemId: data.aiSystem.id
    });
    if (!assertPermission(request, reply, 'report:export', { inScope })) return;

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'report.export_json',
      entityType: 'assessment',
      entityId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? ''
    });

    return reply
      .header('Content-Type', 'application/json')
      .header('Content-Disposition', `attachment; filename="frame-assessment-${id.slice(0, 8)}.json"`)
      .send({ attribution: FRAME_ATTRIBUTION, ...data });
  });

  app.get('/api/reports/assessments/:id/csv', { preHandler: requireStepUp }, async (request, reply) => {
    const auth = request.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const data = await getAssessmentReportData(id);
    if (!data) return reply.code(404).send({ error: 'Assessment not found' });

    const inScope = isEntityInScope(auth.role, auth.scopes, {
      organisationId: data.aiSystem.organisationId,
      businessUnitId: data.aiSystem.businessUnitId,
      aiSystemId: data.aiSystem.id
    });
    if (!assertPermission(request, reply, 'report:export', { inScope })) return;

    const respMap = new Map(data.responses.map((r) => [r.questionId, r]));
    const rows = [];
    for (const dim of data.dimensions) {
      for (const q of dim.questions) {
        const r = respMap.get(q.id);
        rows.push({
          dimension: dim.name,
          code: q.code,
          indicator: q.text,
          isNa: r?.isNa ?? false,
          rating: r?.rating ?? '',
          confidence: r?.confidence ?? '',
          rationale: r?.rationale ?? '',
          naJustification: r?.naJustification ?? ''
        });
      }
    }

    const csv = stringifyCsv(rows, { header: true });
    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'report.export_csv',
      entityType: 'assessment',
      entityId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? ''
    });

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="frame-assessment-${id.slice(0, 8)}.csv"`)
      .send(csv);
  });

  // Audit Pack ZIP (PDF report + evidence files + response history + audit log extract + SHA-256 manifest)
  app.get('/api/reports/assessments/:id/audit-pack', { preHandler: requireStepUp }, async (request, reply) => {
    const auth = request.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const data = await getAssessmentReportData(id);
    if (!data) return reply.code(404).send({ error: 'Assessment not found' });

    const inScope = isEntityInScope(auth.role, auth.scopes, {
      organisationId: data.aiSystem.organisationId,
      businessUnitId: data.aiSystem.businessUnitId,
      aiSystemId: data.aiSystem.id
    });
    if (!assertPermission(request, reply, 'report:export', { inScope })) return;

    const pdfBuffer = await generateAssessmentPdfBuffer(data);
    const historyRows = await db
      .select()
      .from(schema.responseHistory)
      .where(eq(schema.responseHistory.assessmentId, id));

    const auditRows = await db
      .select()
      .from(schema.auditLogs)
      .orderBy(desc(schema.auditLogs.seq))
      .limit(500);
    const relatedLogs = auditRows.filter(
      (l) => l.entityId === id || l.entityId === data.aiSystem.id
    );

    const manifestFiles: Array<{ path: string; sha256: string; bytes: number }> = [];
    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    const finished = new Promise<Buffer>((resolve, reject) => {
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);
    });
    archive.pipe(stream);

    const addBuffer = (filePath: string, buf: Buffer) => {
      archive.append(buf, { name: filePath });
      manifestFiles.push({ path: filePath, sha256: sha256Hex(buf), bytes: buf.length });
    };

    addBuffer('report.pdf', pdfBuffer);
    addBuffer('response-history.json', Buffer.from(JSON.stringify(historyRows, null, 2)));
    addBuffer('audit-log-extract.json', Buffer.from(JSON.stringify(relatedLogs, null, 2)));
    addBuffer('findings.json', Buffer.from(JSON.stringify(data.findings, null, 2)));

    for (const ev of data.evidence) {
      if (ev.kind === 'file' && ev.filePath) {
        try {
          const fileBuf = await storageProvider.read(ev.filePath);
          const safeName = (ev.originalFilename ?? ev.filePath).replace(/[^a-zA-Z0-9._-]/g, '_');
          addBuffer(`evidence/${ev.id.slice(0, 8)}-${safeName}`, fileBuf);
        } catch {
          // Record missing file in manifest note
        }
      }
    }

    const manifest = {
      generatedAt: new Date().toISOString(),
      generatedBy: auth.email,
      assessmentId: id,
      aiSystemName: data.aiSystem.name,
      attribution: FRAME_ATTRIBUTION,
      files: manifestFiles
    };
    archive.append(Buffer.from(JSON.stringify(manifest, null, 2)), { name: 'manifest.json' });
    await archive.finalize();
    const zipBuffer = await finished;

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'report.export_audit_pack',
      entityType: 'assessment',
      entityId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? ''
    });

    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="frame-audit-pack-${id.slice(0, 8)}.zip"`)
      .send(zipBuffer);
  });

  // Portfolio Report (CSV)
  app.get('/api/reports/portfolio/csv', { preHandler: requireStepUp }, async (request, reply) => {
    const auth = request.auth!;
    if (!assertPermission(request, reply, 'report:export', { inScope: true })) return;

    const systems = await db.select().from(schema.aiSystems).orderBy(asc(schema.aiSystems.name));
    const assessments = await db
      .select()
      .from(schema.assessments)
      .orderBy(desc(schema.assessments.assessmentDate));

    const scopedSystems = systems.filter(
      (s) =>
        !s.archivedAt &&
        isEntityInScope(auth.role, auth.scopes, {
          organisationId: s.organisationId,
          businessUnitId: s.businessUnitId,
          aiSystemId: s.id
        })
    );

    const rows = scopedSystems.map((s) => {
      const latest = assessments.find((a) => a.aiSystemId === s.id && a.status !== 'archived');
      return {
        systemName: s.name,
        lifecycleStage: s.lifecycleStage,
        deploymentType: s.deploymentType,
        riskTier: s.riskTier,
        targetMaturityLevel: s.targetMaturityLevel,
        latestAssessmentTitle: latest?.title ?? 'None',
        latestStatus: latest?.status ?? 'None',
        overallScore: latest?.overallScore ?? ''
      };
    });

    const csv = stringifyCsv(rows, { header: true });
    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'report.export_portfolio_csv',
      entityType: 'portfolio',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? ''
    });

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="frame-portfolio-report.csv"')
      .send(csv);
  });

  // Per-System Comprehensive PDF Report (A4)
  app.get('/api/reports/systems/:id/pdf', { preHandler: requireStepUp }, async (request, reply) => {
    const auth = request.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    const [aiSystem] = await db
      .select()
      .from(schema.aiSystems)
      .where(eq(schema.aiSystems.id, id))
      .limit(1);
    if (!aiSystem) return reply.code(404).send({ error: 'AI system not found' });

    const inScope = isEntityInScope(auth.role, auth.scopes, {
      organisationId: aiSystem.organisationId,
      businessUnitId: aiSystem.businessUnitId,
      aiSystemId: aiSystem.id
    });
    if (!assertPermission(request, reply, 'report:export', { inScope })) return;

    const [org] = await db
      .select()
      .from(schema.organisations)
      .where(eq(schema.organisations.id, aiSystem.organisationId))
      .limit(1);

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

    const systemFindings = await db
      .select()
      .from(schema.auditFindings)
      .where(eq(schema.auditFindings.aiSystemId, id))
      .orderBy(desc(schema.auditFindings.createdAt));

    const systemEvidence = await db
      .select()
      .from(schema.evidence)
      .where(eq(schema.evidence.aiSystemId, id))
      .orderBy(desc(schema.evidence.createdAt));

    const branding = await getSetting<BrandingSettings>('branding', DEFAULT_BRANDING_SETTINGS);

    // Load detailed bundle for each non-archived assessment
    const detailedAssessments: Array<NonNullable<Awaited<ReturnType<typeof getAssessmentReportData>>>> = [];
    for (const a of systemAssessments) {
      if (a.status === 'archived') continue;
      const bundle = await getAssessmentReportData(a.id);
      if (bundle) detailedAssessments.push(bundle);
    }

    const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
      const MARGIN = 48;
      const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const accent = branding.accentColour || '#0f766e';
      const pageWidth = doc.page.width - MARGIN * 2; // ~499pt on A4
      const bottomLimit = doc.page.height - MARGIN - 24;

      const ensureSpace = (neededHeight: number) => {
        if (doc.y + neededHeight > bottomLimit) {
          doc.addPage();
          doc.x = MARGIN;
          doc.y = MARGIN;
        }
      };

      const sectionHeading = (title: string) => {
        ensureSpace(48);
        doc.moveDown(0.8);
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(12.5).fillColor(accent).text(title, MARGIN, y, {
          width: pageWidth,
          lineGap: 3
        });
        doc
          .moveTo(MARGIN, doc.y + 4)
          .lineTo(MARGIN + pageWidth, doc.y + 4)
          .lineWidth(0.75)
          .strokeColor('#cbd5e1')
          .stroke();
        doc.x = MARGIN;
        doc.y = doc.y + 14;
      };

      // Top branded banner
      doc.rect(MARGIN, 40, pageWidth, 58).fill(accent);
      doc
        .fillColor('#ffffff')
        .font('Helvetica-Bold')
        .fontSize(14)
        .text(branding.organisationName, MARGIN + 14, 50, { width: pageWidth - 28 });
      doc
        .font('Helvetica')
        .fontSize(10.5)
        .text(`FRAME Governance Dossier: ${aiSystem.name}`, MARGIN + 14, 70, {
          width: pageWidth - 28
        });

      doc.x = MARGIN;
      doc.y = 114;
      doc.fillColor('#111827');

      // Section 1: AI System Profile (2-column card)
      sectionHeading('1. AI System Profile');
      const cardTop = doc.y;
      const leftColX = MARGIN + 12;
      const rightColX = MARGIN + pageWidth / 2 + 6;
      const colW = pageWidth / 2 - 18;

      const leftPairs: Array<[string, string]> = [
        ['Organisation', org?.name ?? 'N/A'],
        ['Lifecycle Stage', aiSystem.lifecycleStage.toUpperCase()],
        ['Deployment Type', aiSystem.deploymentType.replace(/_/g, ' ')],
        ['Sourcing', aiSystem.vendorOrInhouse.replace(/_/g, ' ')],
        ['Data Classification', aiSystem.dataClassification]
      ];
      const rightPairs: Array<[string, string]> = [
        ['Risk Tier', aiSystem.riskTier.toUpperCase()],
        ['Target Maturity', `${aiSystem.targetMaturityLevel.toFixed(1)} / 4.00`],
        ['Model / Platform', aiSystem.modelAndPlatform || 'Not specified'],
        ['Regulatory Tags', aiSystem.regulatoryTags.join(', ') || 'None'],
        ['AAEF Reference', aiSystem.aaefReference || 'Not linked']
      ];

      const rowH = 21;
      const cardHeight = Math.max(leftPairs.length, rightPairs.length) * rowH + 20;
      doc.rect(MARGIN, cardTop, pageWidth, cardHeight).fillAndStroke('#f8fafc', '#e2e8f0');

      leftPairs.forEach(([k, v], idx) => {
        const ry = cardTop + 12 + idx * rowH;
        doc
          .font('Helvetica-Bold')
          .fontSize(8.5)
          .fillColor('#475569')
          .text(`${k}:`, leftColX, ry, { width: 88 });
        doc
          .font('Helvetica')
          .fontSize(8.5)
          .fillColor('#0f172a')
          .text(v, leftColX + 90, ry, { width: colW - 90, ellipsis: true });
      });

      rightPairs.forEach(([k, v], idx) => {
        const ry = cardTop + 12 + idx * rowH;
        doc
          .font('Helvetica-Bold')
          .fontSize(8.5)
          .fillColor('#475569')
          .text(`${k}:`, rightColX, ry, { width: 88 });
        doc
          .font('Helvetica')
          .fontSize(8.5)
          .fillColor('#0f172a')
          .text(v, rightColX + 90, ry, { width: colW - 90, ellipsis: true });
      });

      doc.x = MARGIN;
      doc.y = cardTop + cardHeight + 12;
      doc
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor('#334155')
        .text(`Description: ${aiSystem.description}`, MARGIN, doc.y, {
          width: pageWidth,
          lineGap: 3.5
        });
      doc.x = MARGIN;

      // Section 2: Current FRAME Maturity Profile
      sectionHeading('2. Current FRAME Maturity Profile');
      const latestScored = detailedAssessments.find((d) => d.scoreResult.overallScore !== null);
      if (!latestScored) {
        doc
          .font('Helvetica')
          .fontSize(9.5)
          .fillColor('#64748b')
          .text('No scored FRAME assessments recorded yet.', MARGIN, doc.y, { width: pageWidth });
      } else {
        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .fillColor('#0f172a')
          .text(
            `Latest Assessment: ${latestScored.assessment.title} (${latestScored.assessment.status.replace(/_/g, ' ').toUpperCase()})`,
            MARGIN,
            doc.y,
            { width: pageWidth }
          );
        doc.moveDown(0.2);
        doc
          .font('Helvetica')
          .fontSize(9.5)
          .fillColor('#334155')
          .text(
            `Overall Score: ${latestScored.scoreResult.overallScore!.toFixed(2)} / 4.00  |  Band: ${latestScored.scoreResult.band?.label ?? 'N/A'}  |  Target: ${aiSystem.targetMaturityLevel.toFixed(1)}`,
            MARGIN,
            doc.y,
            { width: pageWidth }
          );
        doc.moveDown(0.5);

        for (const dim of latestScored.scoreResult.dimensions) {
          ensureSpace(28);
          const y = doc.y;
          const barX = MARGIN + 105;
          const barW = 235;
          const scoreVal = dim.score ?? 0;
          const fillW = Math.max(0, Math.min(barW, (scoreVal / 4) * barW));

          doc
            .font('Helvetica-Bold')
            .fontSize(9.5)
            .fillColor('#0f172a')
            .text(dim.dimensionName, MARGIN, y, { width: 100 });
          doc.rect(barX, y + 2, barW, 10).fill('#e2e8f0');
          if (fillW > 0) {
            doc.rect(barX, y + 2, fillW, 10).fill(accent);
          }
          doc
            .font('Helvetica')
            .fontSize(9)
            .fillColor('#0f172a')
            .text(
              dim.score !== null ? `${dim.score.toFixed(2)} / 4.00 (${dim.levelLabel})` : 'N/A',
              barX + barW + 12,
              y,
              { width: pageWidth - (105 + barW + 12) }
            );
          doc.x = MARGIN;
          doc.y = y + 25;
        }

        doc.moveDown(0.4);
        doc
          .font('Helvetica')
          .fontSize(8.5)
          .fillColor('#475569')
          .text(`Score Derivation: ${latestScored.scoreResult.derivationSummary}`, MARGIN, doc.y, {
            width: pageWidth,
            lineGap: 3.5
          });
        doc.x = MARGIN;
      }

      // Section 3: FRAME Assessments & Indicator Entries
      sectionHeading('3. FRAME Assessments & Indicator Entries');
      if (detailedAssessments.length === 0) {
        doc
          .font('Helvetica')
          .fontSize(9.5)
          .fillColor('#64748b')
          .text('No assessments recorded.', MARGIN, doc.y, { width: pageWidth });
      } else {
        for (const bundle of detailedAssessments) {
          ensureSpace(55);
          doc
            .font('Helvetica-Bold')
            .fontSize(10.5)
            .fillColor('#0f172a')
            .text(
              `${bundle.assessment.title}  [${bundle.assessment.status.replace(/_/g, ' ').toUpperCase()}]`,
              MARGIN,
              doc.y,
              { width: pageWidth }
            );
          doc
            .font('Helvetica')
            .fontSize(8.5)
            .fillColor('#475569')
            .text(
              `Date: ${bundle.assessment.assessmentDate.toISOString().slice(0, 10)}  |  Type: ${bundle.assessment.assessmentType.replace(/_/g, ' ')}  |  Scope: ${bundle.assessment.scopeType}  |  Overall Score: ${bundle.scoreResult.overallScore !== null ? `${bundle.scoreResult.overallScore.toFixed(2)} / 4.00` : 'Unscored'}`,
              MARGIN,
              doc.y,
              { width: pageWidth }
            );
          if (bundle.assessment.narrativeSummary) {
            doc.moveDown(0.2);
            doc
              .font('Helvetica-Oblique')
              .fontSize(8.5)
              .fillColor('#334155')
              .text(`Summary: ${bundle.assessment.narrativeSummary}`, MARGIN, doc.y, {
                width: pageWidth
              });
          }
          doc.moveDown(0.4);

          const respMap = new Map(bundle.responses.map((r) => [r.questionId, r]));
          const codeW = 38;
          const scoreW = 115;
          const textW = pageWidth - codeW - scoreW - 16;

          for (const dim of bundle.dimensions) {
            ensureSpace(34);
            doc
              .font('Helvetica-Bold')
              .fontSize(9.5)
              .fillColor(accent)
              .text(`${dim.name} Dimension`, MARGIN, doc.y, { width: pageWidth });
            doc.moveDown(0.2);

            for (let qi = 0; qi < dim.questions.length; qi++) {
              const q = dim.questions[qi];
              const r = respMap.get(q.id);
              const valLabel = r?.isNa
                ? 'N/A'
                : r?.rating
                  ? `Level ${r.rating} / 4 (${r.confidence})`
                  : 'Unanswered';
              const detailText = r?.isNa
                ? `Justification: ${r.naJustification || 'None provided'}`
                : r?.rationale
                  ? `Rationale: ${r.rationale}`
                  : '';

              doc.font('Helvetica').fontSize(8.5);
              const qHeight = doc.heightOfString(q.text, { width: textW, lineGap: 3 });
              const dHeight = detailText
                ? doc.heightOfString(detailText, { width: textW, lineGap: 3 }) + 6
                : 0;
              const totalRowH = Math.max(26, qHeight + dHeight + 14);

              ensureSpace(totalRowH + 6);
              const rowY = doc.y;

              if (qi % 2 === 0) {
                doc.rect(MARGIN, rowY, pageWidth, totalRowH).fill('#f8fafc');
              }

              doc
                .font('Helvetica-Bold')
                .fontSize(8.5)
                .fillColor(accent)
                .text(q.code, MARGIN + 4, rowY + 7, { width: codeW });

              doc
                .font('Helvetica')
                .fontSize(8.5)
                .fillColor('#0f172a')
                .text(q.text, MARGIN + codeW + 6, rowY + 7, { width: textW, lineGap: 3 });

              if (detailText) {
                doc
                  .font('Helvetica')
                  .fontSize(8)
                  .fillColor('#475569')
                  .text(detailText, MARGIN + codeW + 6, rowY + 7 + qHeight + 4, {
                    width: textW,
                    lineGap: 3
                  });
              }

              doc
                .font('Helvetica-Bold')
                .fontSize(8.5)
                .fillColor(r?.rating && r.rating < 3 ? '#b45309' : '#0f172a')
                .text(valLabel, MARGIN + codeW + textW + 10, rowY + 7, {
                  width: scoreW,
                  align: 'right'
                });

              doc.x = MARGIN;
              doc.y = rowY + totalRowH + 2;
            }
            doc.moveDown(0.35);
          }
          doc.moveDown(0.4);
        }
      }

      // Section 4: Implementation Checklists
      sectionHeading('4. Implementation Checklists');
      doc.font('Helvetica').fontSize(9.5).fillColor('#0f172a');
      if (systemChecklists.length === 0) {
        doc.text('No implementation checklists started.', MARGIN, doc.y, { width: pageWidth });
      } else {
        for (const run of systemChecklists) {
          ensureSpace(18);
          const total = run.itemsJson.length;
          const done = run.itemsJson.filter((i) => i.status === 'complete').length;
          const na = run.itemsJson.filter((i) => i.status === 'na').length;
          doc.text(
            `- ${run.title}: ${done} complete, ${na} N/A, ${total - done - na} pending (out of ${total})`,
            MARGIN,
            doc.y,
            { width: pageWidth }
          );
        }
      }

      // Section 5: Remediation Actions & Audit Findings
      sectionHeading('5. Remediation Actions & Audit Findings');
      doc.font('Helvetica').fontSize(9.5).fillColor('#0f172a');
      if (systemActions.length === 0 && systemFindings.length === 0) {
        doc.text('No remediation actions or audit findings recorded.', MARGIN, doc.y, {
          width: pageWidth
        });
      } else {
        for (const act of systemActions) {
          ensureSpace(18);
          doc.text(
            `- Action [${act.priority.toUpperCase()} / ${act.status}]: ${act.title}${act.dueDate ? ` (Due: ${act.dueDate.toISOString().slice(0, 10)})` : ''}`,
            MARGIN,
            doc.y,
            { width: pageWidth }
          );
        }
        for (const f of systemFindings) {
          ensureSpace(18);
          doc.text(
            `- Audit Finding [${f.severity.toUpperCase()} / ${f.status}]: ${f.title}`,
            MARGIN,
            doc.y,
            { width: pageWidth }
          );
        }
      }

      // Section 6: Evidence Index
      sectionHeading('6. Evidence Index');
      doc.font('Helvetica').fontSize(9).fillColor('#0f172a');
      if (systemEvidence.length === 0) {
        doc.text('No evidence artefacts attached.', MARGIN, doc.y, { width: pageWidth });
      } else {
        for (const ev of systemEvidence) {
          ensureSpace(18);
          doc.text(
            `- [${ev.evidenceType}] ${ev.title} (${ev.kind === 'file' ? `SHA-256: ${ev.sha256Hash}` : ev.url})`,
            MARGIN,
            doc.y,
            { width: pageWidth }
          );
        }
      }

      ensureSpace(30);
      doc.moveDown(1);
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#64748b')
        .text(`${FRAME_ATTRIBUTION} Generated ${new Date().toISOString()}.`, MARGIN, doc.y, {
          width: pageWidth
        });

      doc.end();
    });

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'report.export_system_pdf',
      entityType: 'ai_system',
      entityId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? ''
    });

    const safeSlug = aiSystem.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="frame-system-${safeSlug}.pdf"`)
      .send(pdfBuffer);
  });
}
