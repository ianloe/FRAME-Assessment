import { eq } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { db, pool, schema } from './index.js';
import { config } from '../config.js';
import {
  DEFAULT_SCORING_CONFIG,
  FRAME_MATURITY_LEVELS,
  FRAME_V1_DIMENSIONS,
  FRAME_CHECKLIST_TEMPLATES,
  calculateAssessmentScore
} from '@frame/shared';
import { generateOpaqueToken, hashPassword, sha256Hex } from '../services/crypto.js';
import { writeAuditLog } from '../services/audit.js';
import {
  DEFAULT_BRANDING_SETTINGS,
  DEFAULT_SECURITY_POLICY,
  DEFAULT_TAXONOMY_SETTINGS,
  setSetting
} from '../services/settings.js';

export async function runSeed() {
  // 1. Default settings (only if not yet set)
  const existingPolicy = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, 'security_policy'))
    .limit(1);
  if (existingPolicy.length === 0) {
    await setSetting('security_policy', DEFAULT_SECURITY_POLICY);
    await setSetting('branding', DEFAULT_BRANDING_SETTINGS);
    await setSetting('taxonomy', DEFAULT_TAXONOMY_SETTINGS);
  }

  // 2. Seed FRAME v1.0 questionnaire if not present
  const [existingQv] = await db
    .select()
    .from(schema.questionnaireVersions)
    .where(eq(schema.questionnaireVersions.versionLabel, 'FRAME v1.0'))
    .limit(1);

  let qvId = existingQv?.id;
  if (!qvId) {
    const [qv] = await db
      .insert(schema.questionnaireVersions)
      .values({
        versionLabel: 'FRAME v1.0',
        status: 'published',
        notes: 'Initial FRAME v1.0 specification (Ian Loe, Tactics Solutions, CC BY-NC 4.0).',
        maturityLevelsJson: FRAME_MATURITY_LEVELS,
        scoringConfigJson: DEFAULT_SCORING_CONFIG,
        publishedAt: new Date()
      })
      .returning();
    qvId = qv.id;

    for (const dim of FRAME_V1_DIMENSIONS) {
      const [insertedDim] = await db
        .insert(schema.dimensions)
        .values({
          questionnaireVersionId: qvId,
          code: dim.code,
          name: dim.name,
          description: dim.description,
          orderIndex: dim.orderIndex,
          levelDescriptorsJson: dim.levelDescriptors
        })
        .returning();

      for (let i = 0; i < dim.questions.length; i++) {
        const q = dim.questions[i];
        await db.insert(schema.questions).values({
          dimensionId: insertedDim.id,
          code: q.code,
          text: q.text,
          guidance: q.guidance,
          helpText: q.helpText,
          evidenceExpectations: q.evidenceExpectations,
          weight: q.weight,
          answerType: q.answerType,
          applicabilityCondition: q.applicabilityCondition ?? null,
          orderIndex: i + 1
        });
      }
    }
    await writeAuditLog({
      actorRole: 'system',
      action: 'questionnaire.seed',
      entityType: 'questionnaire_version',
      entityId: qvId,
      afterJson: { versionLabel: 'FRAME v1.0' }
    });
  }

  // 3. First-run Admin bootstrap
  const [existingAdmin] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.role, 'admin'))
    .limit(1);

  let adminId = existingAdmin?.id;
  if (!existingAdmin) {
    if (config.adminPassword && config.adminPassword.length >= 12) {
      const passwordHash = await hashPassword(config.adminPassword);
      const [admin] = await db
        .insert(schema.users)
        .values({
          name: config.adminName,
          email: config.adminEmail,
          passwordHash,
          role: 'admin',
          isReviewer: true,
          isActive: true,
          mustChangePassword: false
        })
        .returning();
      adminId = admin.id;
      console.log(`Bootstrap Admin created: ${config.adminEmail}`);
    } else {
      // Create one-time setup invitation for the initial Admin
      const rawToken = generateOpaqueToken(32);
      const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
      await db.insert(schema.invitations).values({
        email: config.adminEmail,
        name: config.adminName,
        role: 'admin',
        isReviewer: true,
        scopeJson: { organisationIds: [], businessUnitIds: [], aiSystemIds: [] },
        tokenHash: sha256Hex(rawToken),
        expiresAt
      });
      console.log('================================================================');
      console.log('FIRST-RUN ADMIN SETUP TOKEN (valid 72 hours, single use):');
      console.log(`${config.appBaseUrl}/accept-invite?token=${rawToken}`);
      console.log('================================================================');
    }
  }

  // 4. Optional Demo Dataset (only when SEED_DEMO=true)
  if (config.seedDemo) {
    const [existingDemoOrg] = await db
      .select()
      .from(schema.organisations)
      .where(eq(schema.organisations.slug, 'meridian-demo'))
      .limit(1);

    if (!existingDemoOrg) {
      const [org] = await db
        .insert(schema.organisations)
        .values({
          name: 'Meridian Financial Group (Demo)',
          slug: 'meridian-demo',
          description: 'Demo enterprise organisation for evaluating FRAME Assessment Platform.'
        })
        .returning();

      const [buRetail] = await db
        .insert(schema.businessUnits)
        .values({
          organisationId: org.id,
          name: 'Retail Banking',
          code: 'RB-01'
        })
        .returning();

      const [buOps] = await db
        .insert(schema.businessUnits)
        .values({
          organisationId: org.id,
          name: 'Operations & Risk',
          code: 'OR-02'
        })
        .returning();

      const demoPassHash = await hashPassword('DemoFrame2026!ChangeMe');

      const [demoUser] = await db
        .insert(schema.users)
        .values({
          name: 'Alex Tan (Demo Assessor)',
          email: 'user@frame.local',
          passwordHash: demoPassHash,
          role: 'user',
          isReviewer: false,
          isActive: true,
          mustChangePassword: true
        })
        .returning();

      const [demoReviewer] = await db
        .insert(schema.users)
        .values({
          name: 'Priya Nair (Demo Reviewer)',
          email: 'reviewer@frame.local',
          passwordHash: demoPassHash,
          role: 'user',
          isReviewer: true,
          isActive: true,
          mustChangePassword: true
        })
        .returning();

      const [demoAuditor] = await db
        .insert(schema.users)
        .values({
          name: 'Marcus Lim (Demo Auditor)',
          email: 'auditor@frame.local',
          passwordHash: demoPassHash,
          role: 'auditor',
          isReviewer: false,
          isActive: true,
          mustChangePassword: true
        })
        .returning();

      for (const u of [demoUser, demoReviewer, demoAuditor]) {
        await db.insert(schema.userScopes).values({
          userId: u.id,
          organisationId: org.id
        });
      }

      const [sys1] = await db
        .insert(schema.aiSystems)
        .values({
          organisationId: org.id,
          businessUnitId: buRetail.id,
          ownerId: demoUser.id,
          name: 'Customer Service Triage Copilot (Demo)',
          description:
            'Conversational copilot assisting retail banking agents with enquiry classification and draft responses.',
          lifecycleStage: 'production',
          deploymentType: 'copilot',
          vendorOrInhouse: 'hybrid',
          modelAndPlatform: 'Managed LLM + Internal RAG Platform',
          dataClassification: 'Confidential',
          regulatoryTags: ['MAS FEAT', 'PDPA'],
          riskTier: 'high',
          targetMaturityLevel: 3,
          aaefReference: 'AAEF-CS-001 (Profile: Assisted Responder)',
          aaefUrl: 'https://github.com/ianloe/AAEF',
          isDemo: true
        })
        .returning();

      const [sys2] = await db
        .insert(schema.aiSystems)
        .values({
          organisationId: org.id,
          businessUnitId: buOps.id,
          ownerId: demoUser.id,
          name: 'Claims Escalation Agent (Demo)',
          description:
            'Autonomous workflow agent routing complex operational exceptions and drafting escalation summaries.',
          lifecycleStage: 'pilot',
          deploymentType: 'autonomous_agent',
          vendorOrInhouse: 'in_house',
          modelAndPlatform: 'Orchestrated Multi-Step Agent Runtime',
          dataClassification: 'Restricted',
          regulatoryTags: ['MAS FEAT', 'ISO 42001'],
          riskTier: 'critical',
          targetMaturityLevel: 3.5,
          aaefReference: 'AAEF-OP-014 (Profile: Bounded Agent)',
          aaefUrl: 'https://github.com/ianloe/AAEF',
          isDemo: true
        })
        .returning();

      await db.insert(schema.aiSystems).values({
        organisationId: org.id,
        businessUnitId: buOps.id,
        ownerId: demoUser.id,
        name: 'Internal Policy Search Assistant (Demo)',
        description: 'Internal read-only Q&A assistant over HR and compliance policies.',
        lifecycleStage: 'idea',
        deploymentType: 'assistant',
        vendorOrInhouse: 'vendor',
        modelAndPlatform: 'Enterprise Search SaaS',
        dataClassification: 'Internal',
        regulatoryTags: ['PDPA'],
        riskTier: 'low',
        targetMaturityLevel: 2.5,
        isDemo: true
      });

      // Load questions for sys1 approved assessment
      const dims = await db
        .select()
        .from(schema.dimensions)
        .where(eq(schema.dimensions.questionnaireVersionId, qvId));
      const allQuestions: Array<{
        id: string;
        code: string;
        dimensionCode: string;
        dimensionName: string;
        weight: number;
      }> = [];
      for (const d of dims) {
        const qs = await db
          .select()
          .from(schema.questions)
          .where(eq(schema.questions.dimensionId, d.id));
        for (const q of qs) {
          allQuestions.push({
            id: q.id,
            code: q.code,
            dimensionCode: d.code,
            dimensionName: d.name,
            weight: q.weight
          });
        }
      }

      // 1. Approved assessment for sys1
      const [approvedAssessment] = await db
        .insert(schema.assessments)
        .values({
          aiSystemId: sys1.id,
          questionnaireVersionId: qvId,
          title: 'Q3 2026 Production Governance Review (Demo)',
          scopeType: 'full',
          selectedDimensionsJson: ['FOCUS', 'ROLES', 'AUTHORITY', 'METRICS', 'EVALUATION'],
          assessmentType: 'periodic_review',
          status: 'approved',
          assessorId: demoUser.id,
          reviewerId: demoReviewer.id,
          assessmentDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
          nextReviewDue: new Date(Date.now() + 76 * 24 * 60 * 60 * 1000),
          narrativeSummary:
            'System meets Defined (Level 3) governance across Focus, Roles, Authority, and Evaluation, with minor baseline refresh actions in Metrics.',
          approvedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          isDemo: true
        })
        .returning();

      const approvedResponses = allQuestions.map((q, idx) => {
        const isNa = q.code === 'A8';
        const rating = isNa ? null : idx % 5 === 0 ? 4 : 3;
        return {
          assessmentId: approvedAssessment.id,
          questionId: q.id,
          rating,
          rationale: isNa
            ? 'Copilot is single-turn assisted drafting, not an autonomous multi-step agent.'
            : `Verified governance artefacts and operational logs for ${q.code}.`,
          confidence: 'high' as const,
          isNa,
          naJustification: isNa ? 'Single-turn copilot deployment without autonomous tool chains.' : '',
          responderId: demoUser.id
        };
      });
      await db.insert(schema.responses).values(approvedResponses);

      const score1 = calculateAssessmentScore(
        allQuestions,
        approvedResponses.map((r) => ({ questionId: r.questionId, rating: r.rating, isNa: r.isNa })),
        DEFAULT_SCORING_CONFIG,
        sys1.targetMaturityLevel
      );

      await db
        .update(schema.assessments)
        .set({
          overallScore: score1.overallScore,
          dimensionScoresJson: score1.dimensions,
          approvedSnapshotJson: {
            score: score1,
            responses: approvedResponses,
            approvedBy: demoReviewer.name
          }
        })
        .where(eq(schema.assessments.id, approvedAssessment.id));

      await db.insert(schema.reviewRecords).values({
        assessmentId: approvedAssessment.id,
        reviewerId: demoReviewer.id,
        decision: 'approved',
        reason: 'All pre-deployment and operational evidence verified; four-eyes review complete.'
      });

      // 2. In-progress assessment for sys2
      const [inProgressAssessment] = await db
        .insert(schema.assessments)
        .values({
          aiSystemId: sys2.id,
          questionnaireVersionId: qvId,
          title: 'Pre-Deployment Readiness Assessment (Demo)',
          scopeType: 'full',
          selectedDimensionsJson: ['FOCUS', 'ROLES', 'AUTHORITY', 'METRICS', 'EVALUATION'],
          assessmentType: 'pre_deployment',
          status: 'in_progress',
          assessorId: demoUser.id,
          assessmentDate: new Date(),
          nextReviewDue: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          narrativeSummary: 'Initial pre-deployment FRAME review for autonomous claims routing agent.',
          isDemo: true
        })
        .returning();

      const partialResponses = allQuestions.slice(0, 18).map((q, idx) => ({
        assessmentId: inProgressAssessment.id,
        questionId: q.id,
        rating: idx % 3 === 0 ? 2 : 3,
        rationale: `Draft assessment rationale for ${q.code}.`,
        confidence: 'medium' as const,
        isNa: false,
        naJustification: '',
        responderId: demoUser.id
      }));
      await db.insert(schema.responses).values(partialResponses);

      const score2 = calculateAssessmentScore(
        allQuestions,
        partialResponses.map((r) => ({ questionId: r.questionId, rating: r.rating, isNa: r.isNa })),
        DEFAULT_SCORING_CONFIG,
        sys2.targetMaturityLevel
      );
      await db
        .update(schema.assessments)
        .set({
          overallScore: score2.overallScore,
          dimensionScoresJson: score2.dimensions
        })
        .where(eq(schema.assessments.id, inProgressAssessment.id));

      // 3. Sample Remediation Actions
      await db.insert(schema.actions).values([
        {
          aiSystemId: sys2.id,
          assessmentId: inProgressAssessment.id,
          title: 'Enforce technical guardrail for Tier 3 financial payout prohibition',
          description:
            'Replace prompt-only prohibition with API gateway policy check blocking payout endpoints.',
          ownerId: demoUser.id,
          dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          priority: 'critical',
          status: 'open',
          createdBy: adminId ?? demoUser.id,
          isDemo: true
        },
        {
          aiSystemId: sys1.id,
          assessmentId: approvedAssessment.id,
          title: 'Refresh 90-day lagging outcome baseline comparison',
          description: 'Update customer resolution time baseline comparison for Q4 cycle review.',
          ownerId: demoUser.id,
          dueDate: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000),
          priority: 'medium',
          status: 'in_progress',
          createdBy: demoReviewer.id,
          isDemo: true
        }
      ]);

      // 4. Pre-deployment checklist for sys2
      const preDepTemplate = FRAME_CHECKLIST_TEMPLATES[0];
      await db.insert(schema.checklistRuns).values({
        aiSystemId: sys2.id,
        section: preDepTemplate.section,
        title: preDepTemplate.title,
        itemsJson: preDepTemplate.items.map((item, idx) => ({
          code: item.code,
          sectionGroup: item.sectionGroup,
          text: item.text,
          status: idx < 6 ? 'complete' : 'pending',
          notes: idx < 6 ? 'Completed during Focus workshop.' : ''
        }))
      });

      console.log('Demo dataset seeded (SEED_DEMO=true).');
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSeed()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Seed failed:', err);
      await pool.end();
      process.exit(1);
    });
}
