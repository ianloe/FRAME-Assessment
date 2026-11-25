import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, desc, asc, isNull, and } from 'drizzle-orm';
import { db, pool, schema } from '../db/index.js';
import { config } from '../config.js';
import {
  CreateInvitationSchema,
  DEFAULT_SCORING_CONFIG,
  PasswordSchema,
  RoleSchema,
  getPermissionsMatrix
} from '@frame/shared';
import {
  evaluatePasswordStrength,
  generateOpaqueToken,
  hashPassword,
  sha256Hex
} from '../services/crypto.js';
import { verifyAuditLogChain, writeAuditLog } from '../services/audit.js';
import { emailProvider } from '../services/email.js';
import {
  DEFAULT_BRANDING_SETTINGS,
  DEFAULT_SECURITY_POLICY,
  DEFAULT_TAXONOMY_SETTINGS,
  getSetting,
  setSetting,
  type BrandingSettings,
  type SecurityPolicy,
  type TaxonomySettings
} from '../services/settings.js';
import { assertPermission, requireFullAuth, requireStepUp } from '../middleware/auth.js';

export async function adminRoutes(app: FastifyInstance) {
  // Permissions matrix (generated from code)
  app.get('/api/admin/permissions-matrix', { preHandler: requireFullAuth }, async (request, reply) => {
    if (!assertPermission(request, reply, 'users:manage')) return;
    return { matrix: getPermissionsMatrix() };
  });

  // --- Organisations & Business Units ---
  app.get('/api/organisations', { preHandler: requireFullAuth }, async (request) => {
    const auth = request.auth!;
    const orgs = await db.select().from(schema.organisations).orderBy(asc(schema.organisations.name));
    const bus = await db.select().from(schema.businessUnits).orderBy(asc(schema.businessUnits.name));

    if (auth.role === 'admin') {
      return { organisations: orgs, businessUnits: bus };
    }
    const allowedOrgIds = new Set(auth.scopes.map((s) => s.organisationId).filter(Boolean));
    const allowedBuIds = new Set(auth.scopes.map((s) => s.businessUnitId).filter(Boolean));

    const filteredOrgs = orgs.filter((o) => allowedOrgIds.has(o.id));
    const filteredBus = bus.filter(
      (b) => allowedOrgIds.has(b.organisationId) || allowedBuIds.has(b.id)
    );
    return { organisations: filteredOrgs, businessUnits: filteredBus };
  });

  app.post('/api/organisations', { preHandler: requireFullAuth }, async (request, reply) => {
    if (!assertPermission(request, reply, 'org_taxonomy:manage')) return;
    const body = z
      .object({
        name: z.string().trim().min(2).max(160),
        slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/),
        description: z.string().max(1000).default('')
      })
      .parse(request.body);

    const [org] = await db.insert(schema.organisations).values(body).returning();
    await writeAuditLog({
      actorId: request.auth!.userId,
      actorRole: request.auth!.role,
      action: 'organisation.create',
      entityType: 'organisation',
      entityId: org.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      afterJson: org
    });
    return reply.code(201).send(org);
  });

  app.post(
    '/api/organisations/:id/business-units',
    { preHandler: requireFullAuth },
    async (request, reply) => {
      if (!assertPermission(request, reply, 'org_taxonomy:manage')) return;
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          name: z.string().trim().min(2).max(160),
          code: z.string().trim().max(40).default(''),
          parentId: z.string().uuid().nullable().optional()
        })
        .parse(request.body);

      const [bu] = await db
        .insert(schema.businessUnits)
        .values({
          organisationId: id,
          name: body.name,
          code: body.code,
          parentId: body.parentId ?? null
        })
        .returning();

      await writeAuditLog({
        actorId: request.auth!.userId,
        actorRole: request.auth!.role,
        action: 'business_unit.create',
        entityType: 'business_unit',
        entityId: bu.id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? '',
        afterJson: bu
      });
      return reply.code(201).send(bu);
    }
  );

  // --- Users & Invitations ---
  app.get('/api/admin/users', { preHandler: requireFullAuth }, async (request, reply) => {
    if (!assertPermission(request, reply, 'users:manage')) return;
    const allUsers = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
        isReviewer: schema.users.isReviewer,
        isActive: schema.users.isActive,
        mustChangePassword: schema.users.mustChangePassword,
        failedLoginAttempts: schema.users.failedLoginAttempts,
        lockedUntil: schema.users.lockedUntil,
        lastLoginAt: schema.users.lastLoginAt,
        createdAt: schema.users.createdAt
      })
      .from(schema.users)
      .orderBy(asc(schema.users.name));

    const allScopes = await db.select().from(schema.userScopes);
    const invs = await db
      .select({
        id: schema.invitations.id,
        name: schema.invitations.name,
        email: schema.invitations.email,
        role: schema.invitations.role,
        isReviewer: schema.invitations.isReviewer,
        expiresAt: schema.invitations.expiresAt,
        acceptedAt: schema.invitations.acceptedAt,
        revokedAt: schema.invitations.revokedAt,
        createdAt: schema.invitations.createdAt
      })
      .from(schema.invitations)
      .orderBy(desc(schema.invitations.createdAt));

    return {
      users: allUsers.map((u) => ({
        ...u,
        scopes: allScopes.filter((s) => s.userId === u.id)
      })),
      invitations: invs
    };
  });

  app.post('/api/admin/invitations', { preHandler: requireStepUp }, async (request, reply) => {
    if (!assertPermission(request, reply, 'users:manage')) return;
    const body = CreateInvitationSchema.parse(request.body);
    const policy = await getSetting<SecurityPolicy>('security_policy', DEFAULT_SECURITY_POLICY);

    const [existingUser] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, body.email))
      .limit(1);
    if (existingUser) {
      return reply.code(409).send({ error: 'A user with this email address already exists' });
    }

    const rawToken = generateOpaqueToken(32);
    const expiresAt = new Date(Date.now() + policy.invitationExpiryHours * 60 * 60 * 1000);

    const [inv] = await db
      .insert(schema.invitations)
      .values({
        name: body.name,
        email: body.email,
        role: body.role,
        isReviewer: body.isReviewer,
        scopeJson: {
          organisationIds: body.organisationIds,
          businessUnitIds: body.businessUnitIds,
          aiSystemIds: body.aiSystemIds
        },
        tokenHash: sha256Hex(rawToken),
        invitedBy: request.auth!.userId,
        expiresAt
      })
      .returning();

    const inviteUrl = `${config.appBaseUrl}/accept-invite?token=${rawToken}`;
    await emailProvider.send({
      to: body.email,
      subject: 'Invitation to FRAME Assessment Platform',
      text: `Hello ${body.name},\n\nYou have been invited to join the FRAME Assessment Platform as ${body.role}.\nAccept your invitation within ${policy.invitationExpiryHours} hours: ${inviteUrl}`
    });

    await writeAuditLog({
      actorId: request.auth!.userId,
      actorRole: request.auth!.role,
      action: 'user.invite',
      entityType: 'invitation',
      entityId: inv.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      afterJson: { email: body.email, role: body.role, isReviewer: body.isReviewer }
    });

    return reply.code(201).send({
      invitation: {
        id: inv.id,
        email: inv.email,
        name: inv.name,
        role: inv.role,
        expiresAt: inv.expiresAt
      },
      // Returned to Admin in response for copy/paste in air-gapped or local testing
      inviteUrl
    });
  });

  // Create user directly with an initial password (no email sent)
  app.post('/api/admin/users', { preHandler: requireStepUp }, async (request, reply) => {
    if (!assertPermission(request, reply, 'users:manage')) return;
    const body = z
      .object({
        name: z.string().trim().min(2).max(120),
        email: z.string().trim().email().toLowerCase(),
        password: PasswordSchema,
        role: RoleSchema,
        isReviewer: z.boolean().default(false),
        mustChangePassword: z.boolean().default(true),
        organisationIds: z.array(z.string().uuid()).default([]),
        businessUnitIds: z.array(z.string().uuid()).default([]),
        aiSystemIds: z.array(z.string().uuid()).default([])
      })
      .parse(request.body);

    const [existingUser] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, body.email))
      .limit(1);
    if (existingUser) {
      return reply.code(409).send({ error: 'A user with this email address already exists' });
    }

    const strength = evaluatePasswordStrength(body.password, [body.name, body.email]);
    if (!strength.acceptable) {
      return reply.code(400).send({
        error: 'Initial password does not meet security requirements',
        feedback: strength.feedback
      });
    }

    const passwordHash = await hashPassword(body.password);

    const createdUser = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(schema.users)
        .values({
          name: body.name,
          email: body.email,
          passwordHash,
          role: body.role,
          isReviewer: body.isReviewer,
          isActive: true,
          mustChangePassword: body.mustChangePassword
        })
        .returning();

      for (const orgId of body.organisationIds) {
        await tx.insert(schema.userScopes).values({ userId: inserted.id, organisationId: orgId });
      }
      for (const buId of body.businessUnitIds) {
        await tx.insert(schema.userScopes).values({ userId: inserted.id, businessUnitId: buId });
      }
      for (const sysId of body.aiSystemIds) {
        await tx.insert(schema.userScopes).values({ userId: inserted.id, aiSystemId: sysId });
      }
      return inserted;
    });

    await writeAuditLog({
      actorId: request.auth!.userId,
      actorRole: request.auth!.role,
      action: 'user.create_direct',
      entityType: 'user',
      entityId: createdUser.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      afterJson: {
        email: createdUser.email,
        role: createdUser.role,
        isReviewer: createdUser.isReviewer,
        mustChangePassword: createdUser.mustChangePassword
      }
    });

    return reply.code(201).send({
      id: createdUser.id,
      name: createdUser.name,
      email: createdUser.email,
      role: createdUser.role,
      isReviewer: createdUser.isReviewer,
      isActive: createdUser.isActive
    });
  });

  app.post('/api/admin/invitations/:id/revoke', { preHandler: requireFullAuth }, async (request, reply) => {
    if (!assertPermission(request, reply, 'users:manage')) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await db
      .update(schema.invitations)
      .set({ revokedAt: new Date() })
      .where(eq(schema.invitations.id, id));
    await writeAuditLog({
      actorId: request.auth!.userId,
      actorRole: request.auth!.role,
      action: 'user.invitation_revoked',
      entityType: 'invitation',
      entityId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? ''
    });
    return { ok: true };
  });

  app.patch('/api/admin/users/:id', { preHandler: requireStepUp }, async (request, reply) => {
    if (!assertPermission(request, reply, 'users:manage')) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        name: z.string().trim().min(2).max(120).optional(),
        email: z.string().trim().email().toLowerCase().optional(),
        password: PasswordSchema.optional(),
        mustChangePassword: z.boolean().optional(),
        role: RoleSchema.optional(),
        isReviewer: z.boolean().optional(),
        isActive: z.boolean().optional(),
        organisationIds: z.array(z.string().uuid()).optional(),
        businessUnitIds: z.array(z.string().uuid()).optional(),
        aiSystemIds: z.array(z.string().uuid()).optional()
      })
      .parse(request.body);

    const [before] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
    if (!before) return reply.code(404).send({ error: 'User not found' });

    if (body.email && body.email !== before.email) {
      const [dup] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, body.email))
        .limit(1);
      if (dup) {
        return reply.code(409).send({ error: 'Another user already uses this email address' });
      }
    }

    let nextPasswordHash = before.passwordHash;
    if (body.password) {
      const strength = evaluatePasswordStrength(body.password, [
        body.name ?? before.name,
        body.email ?? before.email
      ]);
      if (!strength.acceptable) {
        return reply.code(400).send({
          error: 'Password does not meet security requirements',
          feedback: strength.feedback
        });
      }
      nextPasswordHash = await hashPassword(body.password);
    }

    const [updated] = await db
      .update(schema.users)
      .set({
        name: body.name ?? before.name,
        email: body.email ?? before.email,
        passwordHash: nextPasswordHash,
        mustChangePassword: body.mustChangePassword ?? before.mustChangePassword,
        role: body.role ?? before.role,
        isReviewer: body.isReviewer ?? before.isReviewer,
        isActive: body.isActive ?? before.isActive,
        updatedAt: new Date()
      })
      .where(eq(schema.users.id, id))
      .returning();

    if (body.organisationIds || body.businessUnitIds || body.aiSystemIds) {
      await db.delete(schema.userScopes).where(eq(schema.userScopes.userId, id));
      for (const orgId of body.organisationIds ?? []) {
        await db.insert(schema.userScopes).values({ userId: id, organisationId: orgId });
      }
      for (const buId of body.businessUnitIds ?? []) {
        await db.insert(schema.userScopes).values({ userId: id, businessUnitId: buId });
      }
      for (const sysId of body.aiSystemIds ?? []) {
        await db.insert(schema.userScopes).values({ userId: id, aiSystemId: sysId });
      }
    }

    if (body.isActive === false) {
      await db
        .update(schema.sessions)
        .set({ revokedAt: new Date() })
        .where(eq(schema.sessions.userId, id));
    }

    await writeAuditLog({
      actorId: request.auth!.userId,
      actorRole: request.auth!.role,
      action: 'user.update',
      entityType: 'user',
      entityId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      beforeJson: {
        name: before.name,
        email: before.email,
        role: before.role,
        isReviewer: before.isReviewer,
        isActive: before.isActive
      },
      afterJson: {
        name: updated.name,
        email: updated.email,
        role: updated.role,
        isReviewer: updated.isReviewer,
        isActive: updated.isActive
      }
    });

    return { ok: true };
  });

  app.post('/api/admin/users/:id/reset-mfa', { preHandler: requireStepUp }, async (request, reply) => {
    if (!assertPermission(request, reply, 'users:manage')) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { reason } = z.object({ reason: z.string().trim().min(5).max(500) }).parse(request.body);

    await db.transaction(async (tx) => {
      await tx.delete(schema.totpSecrets).where(eq(schema.totpSecrets.userId, id));
      await tx.delete(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, id));
      await tx
        .update(schema.webauthnCredentials)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.webauthnCredentials.userId, id), isNull(schema.webauthnCredentials.revokedAt)));
      await tx
        .update(schema.sessions)
        .set({ revokedAt: new Date() })
        .where(eq(schema.sessions.userId, id));
    });

    await writeAuditLog({
      actorId: request.auth!.userId,
      actorRole: request.auth!.role,
      action: 'user.mfa_reset',
      entityType: 'user',
      entityId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      afterJson: { reason }
    });

    return { ok: true };
  });

  app.post('/api/admin/users/:id/force-logout', { preHandler: requireFullAuth }, async (request, reply) => {
    if (!assertPermission(request, reply, 'users:manage')) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await db
      .update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(eq(schema.sessions.userId, id));
    await writeAuditLog({
      actorId: request.auth!.userId,
      actorRole: request.auth!.role,
      action: 'user.force_logout',
      entityType: 'user',
      entityId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? ''
    });
    return { ok: true };
  });

  app.post('/api/admin/users/:id/force-password-reset', { preHandler: requireFullAuth }, async (request, reply) => {
    if (!assertPermission(request, reply, 'users:manage')) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await db
      .update(schema.users)
      .set({ mustChangePassword: true, updatedAt: new Date() })
      .where(eq(schema.users.id, id));
    await writeAuditLog({
      actorId: request.auth!.userId,
      actorRole: request.auth!.role,
      action: 'user.force_password_reset',
      entityType: 'user',
      entityId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? ''
    });
    return { ok: true };
  });

  app.delete('/api/admin/users/:id', { preHandler: requireStepUp }, async (request, reply) => {
    if (!assertPermission(request, reply, 'users:manage')) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    if (id === request.auth!.userId) {
      return reply.code(400).send({ error: 'You cannot remove your own currently signed-in account' });
    }

    const [target] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
    if (!target) {
      return reply.code(404).send({ error: 'User not found' });
    }

    if (target.role === 'admin') {
      const admins = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(eq(schema.users.role, 'admin'), eq(schema.users.isActive, true)));
      if (admins.length <= 1) {
        return reply.code(400).send({ error: 'Cannot remove the last active Administrator account' });
      }
    }

    await db.delete(schema.users).where(eq(schema.users.id, id));

    await writeAuditLog({
      actorId: request.auth!.userId,
      actorRole: request.auth!.role,
      action: 'user.delete',
      entityType: 'user',
      entityId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      beforeJson: { name: target.name, email: target.email, role: target.role }
    });

    return { ok: true };
  });

  // --- Security Policy, Branding & Taxonomy ---
  app.get('/api/settings/public', async () => {
    const branding = await getSetting<BrandingSettings>('branding', DEFAULT_BRANDING_SETTINGS);
    const taxonomy = await getSetting<TaxonomySettings>('taxonomy', DEFAULT_TAXONOMY_SETTINGS);
    return { branding, taxonomy };
  });

  app.get('/api/admin/security-policy', { preHandler: requireFullAuth }, async (request, reply) => {
    if (!assertPermission(request, reply, 'security_policy:manage')) return;
    return getSetting<SecurityPolicy>('security_policy', DEFAULT_SECURITY_POLICY);
  });

  app.put('/api/admin/security-policy', { preHandler: requireStepUp }, async (request, reply) => {
    if (!assertPermission(request, reply, 'security_policy:manage')) return;
    const body = z
      .object({
        mfaRequiredForAll: z.boolean(),
        passkeyRequiredForAdmins: z.boolean(),
        idleTimeoutMinutes: z.number().int().min(5).max(480),
        absoluteTimeoutHours: z.number().int().min(1).max(72),
        maxFailedLoginAttempts: z.number().int().min(3).max(20),
        lockoutMinutes: z.number().int().min(1).max(120),
        passwordMinLength: z.number().int().min(12).max(64),
        invitationExpiryHours: z.number().int().min(1).max(168),
        stepUpWindowMinutes: z.number().int().min(1).max(60)
      })
      .parse(request.body);

    const before = await getSetting<SecurityPolicy>('security_policy', DEFAULT_SECURITY_POLICY);
    await setSetting('security_policy', body, request.auth!.userId);
    await writeAuditLog({
      actorId: request.auth!.userId,
      actorRole: request.auth!.role,
      action: 'security_policy.update',
      entityType: 'settings',
      entityId: 'security_policy',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      beforeJson: before,
      afterJson: body
    });
    return body;
  });

  app.put('/api/admin/branding', { preHandler: requireFullAuth }, async (request, reply) => {
    if (!assertPermission(request, reply, 'org_taxonomy:manage')) return;
    const body = z
      .object({
        organisationName: z.string().trim().min(2).max(120),
        accentColour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        logoDataUrl: z.string().max(500000).default(''),
        timezone: z.string().trim().min(2).max(64).default('Asia/Singapore')
      })
      .parse(request.body);
    await setSetting('branding', body, request.auth!.userId);
    await writeAuditLog({
      actorId: request.auth!.userId,
      actorRole: request.auth!.role,
      action: 'branding.update',
      entityType: 'settings',
      entityId: 'branding',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? ''
    });
    return body;
  });

  app.put('/api/admin/taxonomy', { preHandler: requireFullAuth }, async (request, reply) => {
    if (!assertPermission(request, reply, 'org_taxonomy:manage')) return;
    const body = z
      .object({
        lifecycleStages: z.array(z.string().trim().min(1)).min(1),
        deploymentTypes: z.array(z.string().trim().min(1)).min(1),
        riskTiers: z
          .array(
            z.object({
              name: z.string().trim().min(1),
              targetMaturityLevel: z.number().min(1).max(4)
            })
          )
          .min(1),
        regulatoryTags: z.array(z.string().trim().min(1)),
        evidenceTypes: z.array(z.string().trim().min(1)).min(1)
      })
      .parse(request.body);
    await setSetting('taxonomy', body, request.auth!.userId);
    await writeAuditLog({
      actorId: request.auth!.userId,
      actorRole: request.auth!.role,
      action: 'taxonomy.update',
      entityType: 'settings',
      entityId: 'taxonomy',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? ''
    });
    return body;
  });

  // --- Questionnaire Versioning ---
  app.get('/api/questionnaires', { preHandler: requireFullAuth }, async () => {
    const versions = await db
      .select()
      .from(schema.questionnaireVersions)
      .orderBy(desc(schema.questionnaireVersions.createdAt));
    return { questionnaires: versions };
  });

  app.get('/api/questionnaires/:id', { preHandler: requireFullAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [qv] = await db
      .select()
      .from(schema.questionnaireVersions)
      .where(eq(schema.questionnaireVersions.id, id))
      .limit(1);
    if (!qv) return reply.code(404).send({ error: 'Questionnaire version not found' });

    const dims = await db
      .select()
      .from(schema.dimensions)
      .where(eq(schema.dimensions.questionnaireVersionId, id))
      .orderBy(asc(schema.dimensions.orderIndex));

    const dimsWithQuestions = [];
    for (const d of dims) {
      const qs = await db
        .select()
        .from(schema.questions)
        .where(eq(schema.questions.dimensionId, d.id))
        .orderBy(asc(schema.questions.orderIndex));
      dimsWithQuestions.push({ ...d, questions: qs });
    }

    return { ...qv, dimensions: dimsWithQuestions };
  });

  app.post('/api/questionnaires/:id/clone', { preHandler: requireFullAuth }, async (request, reply) => {
    if (!assertPermission(request, reply, 'questionnaire:manage')) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { versionLabel, notes } = z
      .object({
        versionLabel: z.string().trim().min(2).max(60),
        notes: z.string().max(1000).default('')
      })
      .parse(request.body);

    const [source] = await db
      .select()
      .from(schema.questionnaireVersions)
      .where(eq(schema.questionnaireVersions.id, id))
      .limit(1);
    if (!source) return reply.code(404).send({ error: 'Source questionnaire not found' });

    const [draft] = await db
      .insert(schema.questionnaireVersions)
      .values({
        versionLabel,
        status: 'draft',
        notes,
        maturityLevelsJson: source.maturityLevelsJson,
        scoringConfigJson: source.scoringConfigJson,
        createdBy: request.auth!.userId
      })
      .returning();

    const dims = await db
      .select()
      .from(schema.dimensions)
      .where(eq(schema.dimensions.questionnaireVersionId, source.id))
      .orderBy(asc(schema.dimensions.orderIndex));

    for (const d of dims) {
      const [newDim] = await db
        .insert(schema.dimensions)
        .values({
          questionnaireVersionId: draft.id,
          code: d.code,
          name: d.name,
          description: d.description,
          orderIndex: d.orderIndex,
          levelDescriptorsJson: d.levelDescriptorsJson
        })
        .returning();

      const qs = await db
        .select()
        .from(schema.questions)
        .where(eq(schema.questions.dimensionId, d.id))
        .orderBy(asc(schema.questions.orderIndex));

      for (const q of qs) {
        await db.insert(schema.questions).values({
          dimensionId: newDim.id,
          code: q.code,
          text: q.text,
          guidance: q.guidance,
          helpText: q.helpText,
          evidenceExpectations: q.evidenceExpectations,
          weight: q.weight,
          answerType: q.answerType,
          applicabilityCondition: q.applicabilityCondition,
          orderIndex: q.orderIndex
        });
      }
    }

    await writeAuditLog({
      actorId: request.auth!.userId,
      actorRole: request.auth!.role,
      action: 'questionnaire.clone',
      entityType: 'questionnaire_version',
      entityId: draft.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      afterJson: { versionLabel, clonedFrom: id }
    });

    return reply.code(201).send(draft);
  });

  app.put('/api/questionnaires/:id', { preHandler: requireFullAuth }, async (request, reply) => {
    if (!assertPermission(request, reply, 'questionnaire:manage')) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [qv] = await db
      .select()
      .from(schema.questionnaireVersions)
      .where(eq(schema.questionnaireVersions.id, id))
      .limit(1);
    if (!qv) return reply.code(404).send({ error: 'Questionnaire not found' });
    if (qv.status !== 'draft') {
      return reply.code(400).send({ error: 'Published questionnaire versions are immutable' });
    }

    const body = z
      .object({
        scoringConfigJson: z.any().optional(),
        questionUpdates: z
          .array(
            z.object({
              id: z.string().uuid(),
              text: z.string().min(3).optional(),
              guidance: z.string().optional(),
              weight: z.number().min(0.1).max(10).optional()
            })
          )
          .optional()
      })
      .parse(request.body);

    if (body.scoringConfigJson) {
      await db
        .update(schema.questionnaireVersions)
        .set({ scoringConfigJson: body.scoringConfigJson })
        .where(eq(schema.questionnaireVersions.id, id));
    }

    for (const qUpdate of body.questionUpdates ?? []) {
      await db
        .update(schema.questions)
        .set({
          ...(qUpdate.text !== undefined ? { text: qUpdate.text } : {}),
          ...(qUpdate.guidance !== undefined ? { guidance: qUpdate.guidance } : {}),
          ...(qUpdate.weight !== undefined ? { weight: qUpdate.weight } : {})
        })
        .where(eq(schema.questions.id, qUpdate.id));
    }

    return { ok: true };
  });

  app.post('/api/questionnaires/:id/publish', { preHandler: requireFullAuth }, async (request, reply) => {
    if (!assertPermission(request, reply, 'questionnaire:manage')) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [qv] = await db
      .select()
      .from(schema.questionnaireVersions)
      .where(eq(schema.questionnaireVersions.id, id))
      .limit(1);
    if (!qv) return reply.code(404).send({ error: 'Questionnaire not found' });
    if (qv.status !== 'draft') {
      return reply.code(400).send({ error: 'Only draft versions can be published' });
    }

    await db
      .update(schema.questionnaireVersions)
      .set({ status: 'published', publishedAt: new Date() })
      .where(eq(schema.questionnaireVersions.id, id));

    await writeAuditLog({
      actorId: request.auth!.userId,
      actorRole: request.auth!.role,
      action: 'questionnaire.publish',
      entityType: 'questionnaire_version',
      entityId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? ''
    });

    return { ok: true, DEFAULT_SCORING_CONFIG };
  });

  // --- Audit Log & Integrity Check ---
  app.get('/api/audit-logs', { preHandler: requireFullAuth }, async (request) => {
    const auth = request.auth!;
    const query = z
      .object({
        entityType: z.string().optional(),
        action: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
        offset: z.coerce.number().int().min(0).default(0)
      })
      .parse(request.query);

    const canViewAll = auth.role === 'admin' || auth.role === 'auditor';
    const rows = canViewAll
      ? await db
          .select()
          .from(schema.auditLogs)
          .orderBy(desc(schema.auditLogs.seq))
          .limit(query.limit)
          .offset(query.offset)
      : await db
          .select()
          .from(schema.auditLogs)
          .where(eq(schema.auditLogs.actorId, auth.userId))
          .orderBy(desc(schema.auditLogs.seq))
          .limit(query.limit)
          .offset(query.offset);

    const filtered = rows.filter((r) => {
      if (query.entityType && r.entityType !== query.entityType) return false;
      if (query.action && !r.action.includes(query.action)) return false;
      return true;
    });

    return { logs: filtered };
  });

  app.post('/api/audit-logs/verify', { preHandler: requireFullAuth }, async (request, reply) => {
    if (!assertPermission(request, reply, 'audit_log:verify')) return;
    const result = await verifyAuditLogChain();
    await writeAuditLog({
      actorId: request.auth!.userId,
      actorRole: request.auth!.role,
      action: 'audit_log.verify_chain',
      entityType: 'audit_log',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      afterJson: result
    });
    return result;
  });

  // --- System Health & Demo Cleanup ---
  app.get('/api/admin/health', { preHandler: requireFullAuth }, async (request, reply) => {
    if (!assertPermission(request, reply, 'users:manage')) return;
    const dbCheck = await pool.query('SELECT 1 AS ok');
    const [qvCount] = await db.select({ count: schema.questionnaireVersions.id }).from(schema.questionnaireVersions);
    return {
      status: 'healthy',
      version: '1.0.0',
      database: dbCheck.rows[0]?.ok === 1 ? 'connected' : 'error',
      storageDriver: config.storageDriver,
      questionnaireSeeded: Boolean(qvCount),
      uptimeSeconds: Math.floor(process.uptime())
    };
  });

  app.delete('/api/admin/demo-data', { preHandler: requireStepUp }, async (request, reply) => {
    if (!assertPermission(request, reply, 'users:manage')) return;
    await db.delete(schema.actions).where(eq(schema.actions.isDemo, true));
    await db.delete(schema.assessments).where(eq(schema.assessments.isDemo, true));
    await db.delete(schema.aiSystems).where(eq(schema.aiSystems.isDemo, true));
    await db.delete(schema.organisations).where(eq(schema.organisations.slug, 'meridian-demo'));

    await writeAuditLog({
      actorId: request.auth!.userId,
      actorRole: request.auth!.role,
      action: 'admin.demo_data_removed',
      entityType: 'system',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? ''
    });
    return { ok: true };
  });
}
