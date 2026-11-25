import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { eq, and, isNull, desc } from 'drizzle-orm';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} from '@simplewebauthn/server';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import {
  AcceptInvitationSchema,
  LoginPasswordSchema,
  PasswordSchema
} from '@frame/shared';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  evaluatePasswordStrength,
  generateOpaqueToken,
  hashPassword,
  sha256Hex,
  verifyPassword
} from '../services/crypto.js';
import { writeAuditLog } from '../services/audit.js';
import { emailProvider } from '../services/email.js';
import { DEFAULT_SECURITY_POLICY, getSetting, type SecurityPolicy } from '../services/settings.js';
import {
  SESSION_COOKIE_NAME,
  authenticateRequest,
  createSession,
  requireFullAuth,
  requireStepUp,
  rotateSession
} from '../middleware/auth.js';

function getWebAuthnContext(request: FastifyRequest): { rpID: string; expectedOrigin: string } {
  const configuredOrigins = config.webauthnOrigin
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const reqOrigin = typeof request.headers.origin === 'string' ? request.headers.origin : '';
  const xfHost =
    typeof request.headers['x-forwarded-host'] === 'string'
      ? request.headers['x-forwarded-host'].split(',')[0].trim()
      : '';
  const hostHeader = xfHost || (typeof request.headers.host === 'string' ? request.headers.host : '');
  const reqHostname = hostHeader.split(':')[0];

  if (config.webauthnRpId === 'auto' && reqOrigin) {
    try {
      const parsed = new URL(reqOrigin);
      if (!reqHostname || parsed.hostname === reqHostname) {
        return { rpID: parsed.hostname, expectedOrigin: reqOrigin };
      }
    } catch {
      // fall through
    }
  }

  if (reqOrigin && configuredOrigins.includes(reqOrigin)) {
    const parsed = new URL(reqOrigin);
    return {
      rpID: config.webauthnRpId === 'auto' ? parsed.hostname : config.webauthnRpId,
      expectedOrigin: reqOrigin
    };
  }

  return {
    rpID: config.webauthnRpId === 'auto' ? reqHostname || 'localhost' : config.webauthnRpId,
    expectedOrigin: configuredOrigins[0] ?? config.webauthnOrigin
  };
}

async function recordAuthEvent(params: {
  userId?: string | null;
  email?: string;
  eventType: string;
  success: boolean;
  ipAddress: string;
  userAgent: string;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(schema.authEvents).values({
    userId: params.userId ?? null,
    email: params.email ?? '',
    eventType: params.eventType,
    success: params.success,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadataJson: params.metadata ?? {}
  });
}

async function generateRecoveryCodesForUser(userId: string): Promise<string[]> {
  await db.delete(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, userId));
  const plainCodes: string[] = [];
  for (let i = 0; i < 10; i++) {
    const raw = generateOpaqueToken(6).replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toUpperCase();
    const formatted = `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
    plainCodes.push(formatted);
    await db.insert(schema.recoveryCodes).values({
      userId,
      codeHash: sha256Hex(`${userId}:${formatted}`)
    });
  }
  return plainCodes;
}

export async function authRoutes(app: FastifyInstance) {
  // Current session info (works even before MFA completion so UI knows what step is next)
  app.get('/api/auth/me', { preHandler: authenticateRequest }, async (request) => {
    const auth = request.auth!;
    const policy = await getSetting<SecurityPolicy>('security_policy', DEFAULT_SECURITY_POLICY);
    const mfaMandatory = policy.mfaRequiredForAll || auth.role === 'admin';
    const stepUpValid =
      Boolean(auth.stepUpVerifiedAt) &&
      Date.now() - auth.stepUpVerifiedAt!.getTime() <= policy.stepUpWindowMinutes * 60 * 1000;

    return {
      user: {
        id: auth.userId,
        name: auth.name,
        email: auth.email,
        role: auth.role,
        isReviewer: auth.isReviewer,
        mustChangePassword: auth.mustChangePassword
      },
      csrfToken: auth.csrfSecret,
      mfaVerified: auth.mfaVerified,
      hasTotpEnrolled: auth.hasTotpEnrolled,
      hasMfaEnrolled: auth.hasMfaEnrolled,
      hasPasskeyEnrolled: auth.hasPasskeyEnrolled,
      mfaMandatory,
      passkeyRequiredForAdmin: auth.role === 'admin' && policy.passkeyRequiredForAdmins,
      stepUpValid
    };
  });

  // Password strength check helper
  app.post(
    '/api/auth/password/check-strength',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
    },
    async (request) => {
      const body = z
        .object({ password: z.string(), hints: z.array(z.string()).optional() })
        .parse(request.body);
      return evaluatePasswordStrength(body.password, body.hints ?? []);
    }
  );

  // Inspect invitation token
  app.get(
    '/api/auth/invite/inspect',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { token } = z.object({ token: z.string().min(10) }).parse(request.query);
      const [inv] = await db
        .select()
        .from(schema.invitations)
        .where(eq(schema.invitations.tokenHash, sha256Hex(token)))
        .limit(1);

      if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) {
        return reply.code(400).send({ error: 'Invitation is invalid or has expired' });
      }
      return { name: inv.name, email: inv.email, role: inv.role };
    }
  );

  // Accept invitation & set password
  app.post(
    '/api/auth/invite/accept',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const body = AcceptInvitationSchema.parse(request.body);
      const [inv] = await db
        .select()
        .from(schema.invitations)
        .where(eq(schema.invitations.tokenHash, sha256Hex(body.token)))
        .limit(1);

      if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) {
        return reply.code(400).send({ error: 'Invitation is invalid or has expired' });
      }

      const strength = evaluatePasswordStrength(body.password, [inv.name, inv.email]);
      if (!strength.acceptable) {
        return reply.code(400).send({
          error: 'Password does not meet security requirements',
          feedback: strength.feedback
        });
      }

      const passwordHash = await hashPassword(body.password);

      const user = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, inv.email))
          .limit(1);

        let createdUser;
        if (existing) {
          const [updated] = await tx
            .update(schema.users)
            .set({ passwordHash, isActive: true, mustChangePassword: false, updatedAt: new Date() })
            .where(eq(schema.users.id, existing.id))
            .returning();
          createdUser = updated;
        } else {
          const [inserted] = await tx
            .insert(schema.users)
            .values({
              name: inv.name,
              email: inv.email,
              passwordHash,
              role: inv.role,
              isReviewer: inv.isReviewer,
              isActive: true,
              mustChangePassword: false
            })
            .returning();
          createdUser = inserted;

          const scope = inv.scopeJson;
          for (const orgId of scope.organisationIds ?? []) {
            await tx.insert(schema.userScopes).values({ userId: createdUser.id, organisationId: orgId });
          }
          for (const buId of scope.businessUnitIds ?? []) {
            await tx.insert(schema.userScopes).values({ userId: createdUser.id, businessUnitId: buId });
          }
          for (const sysId of scope.aiSystemIds ?? []) {
            await tx.insert(schema.userScopes).values({ userId: createdUser.id, aiSystemId: sysId });
          }
        }

        await tx
          .update(schema.invitations)
          .set({ acceptedAt: new Date() })
          .where(eq(schema.invitations.id, inv.id));

        return createdUser;
      });

      const { csrfSecret } = await createSession({
        userId: user.id,
        mfaVerified: false,
        authMethod: 'password',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? '',
        reply
      });

      await recordAuthEvent({
        userId: user.id,
        email: user.email,
        eventType: 'invitation_accepted',
        success: true,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? ''
      });

      await writeAuditLog({
        actorId: user.id,
        actorRole: user.role,
        action: 'user.invitation_accepted',
        entityType: 'user',
        entityId: user.id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? ''
      });

      return {
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
        csrfToken: csrfSecret,
        requiresMfaEnrolment: true
      };
    }
  );

  // Login with email + password
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      const body = LoginPasswordSchema.parse(request.body);
      const policy = await getSetting<SecurityPolicy>('security_policy', DEFAULT_SECURITY_POLICY);

      const [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, body.email))
        .limit(1);

      const genericError = { error: 'Invalid email or password' };

      if (!user || !user.passwordHash || !user.isActive) {
        await recordAuthEvent({
          email: body.email,
          eventType: 'login_password',
          success: false,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? '',
          metadata: { reason: 'unknown_or_inactive' }
        });
        return reply.code(401).send(genericError);
      }

      if (user.lockedUntil && user.lockedUntil > new Date()) {
        await recordAuthEvent({
          userId: user.id,
          email: user.email,
          eventType: 'login_locked',
          success: false,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? ''
        });
        return reply.code(429).send({
          error: 'Account temporarily locked due to repeated failed attempts. Please try again later.'
        });
      }

      const valid = await verifyPassword(user.passwordHash, body.password);
      if (!valid) {
        const nextAttempts = user.failedLoginAttempts + 1;
        const shouldLock = nextAttempts >= policy.maxFailedLoginAttempts;
        // Progressive lockout: base lockoutMinutes * 2^(excess) capped at 60m
        const lockMinutes = shouldLock
          ? Math.min(60, policy.lockoutMinutes * Math.pow(2, nextAttempts - policy.maxFailedLoginAttempts))
          : 0;
        await db
          .update(schema.users)
          .set({
            failedLoginAttempts: nextAttempts,
            lockedUntil: shouldLock ? new Date(Date.now() + lockMinutes * 60 * 1000) : null
          })
          .where(eq(schema.users.id, user.id));

        await recordAuthEvent({
          userId: user.id,
          email: user.email,
          eventType: 'login_password',
          success: false,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? '',
          metadata: { attempts: nextAttempts, locked: shouldLock }
        });
        return reply.code(401).send(genericError);
      }

      await db
        .update(schema.users)
        .set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
        .where(eq(schema.users.id, user.id));

      const [totp] = await db
        .select()
        .from(schema.totpSecrets)
        .where(and(eq(schema.totpSecrets.userId, user.id), eq(schema.totpSecrets.verified, true)))
        .limit(1);

      const passkeys = await db
        .select({ id: schema.webauthnCredentials.id })
        .from(schema.webauthnCredentials)
        .where(
          and(eq(schema.webauthnCredentials.userId, user.id), isNull(schema.webauthnCredentials.revokedAt))
        );

      const hasMfaEnrolled = Boolean(totp) || passkeys.length > 0;
      const mfaMandatory = policy.mfaRequiredForAll || user.role === 'admin';
      const mfaVerified = !mfaMandatory;

      const { csrfSecret } = await createSession({
        userId: user.id,
        mfaVerified,
        authMethod: 'password',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? '',
        reply
      });

      await recordAuthEvent({
        userId: user.id,
        email: user.email,
        eventType: 'login_password',
        success: true,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? ''
      });

      await writeAuditLog({
        actorId: user.id,
        actorRole: user.role,
        action: 'auth.login_password',
        entityType: 'session',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? '',
        afterJson: { mfaVerified }
      });

      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          isReviewer: user.isReviewer,
          mustChangePassword: user.mustChangePassword
        },
        csrfToken: csrfSecret,
        mfaVerified,
        hasMfaEnrolled,
        requiresMfaEnrolment: mfaMandatory && !hasMfaEnrolled
      };
    }
  );

  // Logout
  app.post('/api/auth/logout', { preHandler: authenticateRequest }, async (request, reply) => {
    const auth = request.auth!;
    await db
      .update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(eq(schema.sessions.id, auth.sessionId));
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'auth.logout',
      entityType: 'session',
      entityId: auth.sessionId,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? ''
    });

    return { ok: true };
  });

  // Forgot password (generic response to prevent user enumeration)
  app.post(
    '/api/auth/password/forgot',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request) => {
      const { email } = z.object({ email: z.string().trim().email().toLowerCase() }).parse(request.body);
      const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);

      if (user && user.isActive) {
        const rawToken = generateOpaqueToken(32);
        await db.insert(schema.passwordResetTokens).values({
          userId: user.id,
          tokenHash: sha256Hex(rawToken),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000)
        });
        const resetUrl = `${config.appBaseUrl}/reset-password?token=${rawToken}`;
        await emailProvider.send({
          to: user.email,
          subject: 'FRAME Assessment Platform - Password Reset',
          text: `A password reset was requested for your account. Use this single-use link within 1 hour: ${resetUrl}`
        });
      }

      return {
        message: 'If an active account exists for that email address, a password reset link has been sent.'
      };
    }
  );

  // Complete password reset
  app.post(
    '/api/auth/password/reset',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const body = z
        .object({ token: z.string().min(16), password: PasswordSchema })
        .parse(request.body);

      const [resetRow] = await db
        .select()
        .from(schema.passwordResetTokens)
        .where(eq(schema.passwordResetTokens.tokenHash, sha256Hex(body.token)))
        .limit(1);

      if (!resetRow || resetRow.usedAt || resetRow.expiresAt < new Date()) {
        return reply.code(400).send({ error: 'Password reset token is invalid or expired' });
      }

      const [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, resetRow.userId))
        .limit(1);
      if (!user) {
        return reply.code(400).send({ error: 'Password reset token is invalid' });
      }

      const strength = evaluatePasswordStrength(body.password, [user.name, user.email]);
      if (!strength.acceptable) {
        return reply.code(400).send({
          error: 'Password does not meet security requirements',
          feedback: strength.feedback
        });
      }

      const passwordHash = await hashPassword(body.password);
      const now = new Date();

      await db.transaction(async (tx) => {
        await tx
          .update(schema.users)
          .set({ passwordHash, mustChangePassword: false, failedLoginAttempts: 0, lockedUntil: null, updatedAt: now })
          .where(eq(schema.users.id, user.id));
        await tx
          .update(schema.passwordResetTokens)
          .set({ usedAt: now })
          .where(eq(schema.passwordResetTokens.id, resetRow.id));
        // Revoke all existing sessions on password reset
        await tx
          .update(schema.sessions)
          .set({ revokedAt: now })
          .where(eq(schema.sessions.userId, user.id));
      });

      await writeAuditLog({
        actorId: user.id,
        actorRole: user.role,
        action: 'auth.password_reset',
        entityType: 'user',
        entityId: user.id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? ''
      });

      return { ok: true };
    }
  );

  // Change own password
  app.post('/api/auth/password/change', { preHandler: authenticateRequest }, async (request, reply) => {
    const auth = request.auth!;
    const body = z
      .object({ currentPassword: z.string(), newPassword: PasswordSchema })
      .parse(request.body);

    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, auth.userId)).limit(1);
    if (!user || !user.passwordHash || !(await verifyPassword(user.passwordHash, body.currentPassword))) {
      return reply.code(400).send({ error: 'Current password is incorrect' });
    }

    const strength = evaluatePasswordStrength(body.newPassword, [user.name, user.email]);
    if (!strength.acceptable) {
      return reply.code(400).send({
        error: 'New password does not meet security requirements',
        feedback: strength.feedback
      });
    }

    const passwordHash = await hashPassword(body.newPassword);
    await db
      .update(schema.users)
      .set({ passwordHash, mustChangePassword: false, updatedAt: new Date() })
      .where(eq(schema.users.id, user.id));

    await writeAuditLog({
      actorId: user.id,
      actorRole: user.role,
      action: 'auth.password_changed',
      entityType: 'user',
      entityId: user.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? ''
    });

    return { ok: true };
  });

  // --- TOTP Enrolment & Verification ---
  app.post('/api/auth/mfa/totp/setup', { preHandler: authenticateRequest }, async (request) => {
    const auth = request.auth!;
    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({
      issuer: 'FRAME Assessment Platform',
      label: auth.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret
    });

    const { encryptedSecret, keyVersion } = encryptTotpSecret(secret.base32);
    await db
      .insert(schema.totpSecrets)
      .values({
        userId: auth.userId,
        encryptedSecret,
        keyVersion,
        verified: false
      })
      .onConflictDoUpdate({
        target: schema.totpSecrets.userId,
        set: {
          encryptedSecret,
          keyVersion,
          verified: false,
          updatedAt: new Date()
        }
      });

    const otpauthUrl = totp.toString();
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

    return {
      manualKey: secret.base32,
      otpauthUrl,
      qrDataUrl
    };
  });

  app.post('/api/auth/mfa/totp/verify-setup', { preHandler: authenticateRequest }, async (request, reply) => {
    const auth = request.auth!;
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(request.body);

    const [record] = await db
      .select()
      .from(schema.totpSecrets)
      .where(eq(schema.totpSecrets.userId, auth.userId))
      .limit(1);
    if (!record) {
      return reply.code(400).send({ error: 'TOTP setup has not been initiated' });
    }

    const plainSecret = decryptTotpSecret(record.encryptedSecret, record.keyVersion);
    const totp = new OTPAuth.TOTP({
      issuer: 'FRAME Assessment Platform',
      label: auth.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(plainSecret)
    });

    const delta = totp.validate({ token: code, window: 1 });
    if (delta === null) {
      return reply.code(400).send({ error: 'Invalid verification code' });
    }

    await db
      .update(schema.totpSecrets)
      .set({ verified: true, updatedAt: new Date() })
      .where(eq(schema.totpSecrets.id, record.id));

    const recoveryCodes = await generateRecoveryCodesForUser(auth.userId);
    await rotateSession(request, reply, { mfaVerified: true, stepUpVerifiedAt: new Date() });

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'auth.totp_enrolled',
      entityType: 'user',
      entityId: auth.userId,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? ''
    });

    return { ok: true, recoveryCodes };
  });

  app.post(
    '/api/auth/mfa/totp/verify',
    {
      preHandler: authenticateRequest,
      config: { rateLimit: { max: 10, timeWindow: '5 minutes' } }
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(request.body);

      const [record] = await db
        .select()
        .from(schema.totpSecrets)
        .where(and(eq(schema.totpSecrets.userId, auth.userId), eq(schema.totpSecrets.verified, true)))
        .limit(1);

      if (!record) {
        return reply.code(400).send({ error: 'TOTP is not enrolled' });
      }

      const plainSecret = decryptTotpSecret(record.encryptedSecret, record.keyVersion);
      const totp = new OTPAuth.TOTP({
        issuer: 'FRAME Assessment Platform',
        label: auth.email,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(plainSecret)
      });

      const delta = totp.validate({ token: code, window: 1 });
      if (delta === null) {
        await recordAuthEvent({
          userId: auth.userId,
          email: auth.email,
          eventType: 'mfa_totp',
          success: false,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? ''
        });
        return reply.code(401).send({ error: 'Invalid authenticator code' });
      }

      await rotateSession(request, reply, { mfaVerified: true, stepUpVerifiedAt: new Date() });
      await recordAuthEvent({
        userId: auth.userId,
        email: auth.email,
        eventType: 'mfa_totp',
        success: true,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? ''
      });

      return { ok: true, csrfToken: request.auth!.csrfSecret };
    }
  );

  // Recovery code verification
  app.post(
    '/api/auth/mfa/recovery/verify',
    {
      preHandler: authenticateRequest,
      config: { rateLimit: { max: 8, timeWindow: '5 minutes' } }
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { code } = z.object({ code: z.string().trim().min(6) }).parse(request.body);
      const normalized = code.toUpperCase();
      const targetHash = sha256Hex(`${auth.userId}:${normalized}`);

      const [match] = await db
        .select()
        .from(schema.recoveryCodes)
        .where(
          and(
            eq(schema.recoveryCodes.userId, auth.userId),
            eq(schema.recoveryCodes.codeHash, targetHash),
            isNull(schema.recoveryCodes.usedAt)
          )
        )
        .limit(1);

      if (!match) {
        await recordAuthEvent({
          userId: auth.userId,
          email: auth.email,
          eventType: 'mfa_recovery_code',
          success: false,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? ''
        });
        return reply.code(401).send({ error: 'Invalid or already used recovery code' });
      }

      await db
        .update(schema.recoveryCodes)
        .set({ usedAt: new Date() })
        .where(eq(schema.recoveryCodes.id, match.id));

      await rotateSession(request, reply, { mfaVerified: true, stepUpVerifiedAt: new Date() });
      await recordAuthEvent({
        userId: auth.userId,
        email: auth.email,
        eventType: 'mfa_recovery_code',
        success: true,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? ''
      });

      return { ok: true, csrfToken: request.auth!.csrfSecret };
    }
  );

  app.post('/api/auth/mfa/recovery/regenerate', { preHandler: requireStepUp }, async (request) => {
    const auth = request.auth!;
    const recoveryCodes = await generateRecoveryCodesForUser(auth.userId);
    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'auth.recovery_codes_regenerated',
      entityType: 'user',
      entityId: auth.userId,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? ''
    });
    return { recoveryCodes };
  });

  // --- Passkeys (WebAuthn / FIDO2) ---
  app.post('/api/auth/passkey/register/options', { preHandler: authenticateRequest }, async (request) => {
    const auth = request.auth!;
    const { rpID } = getWebAuthnContext(request);
    const existing = await db
      .select()
      .from(schema.webauthnCredentials)
      .where(
        and(eq(schema.webauthnCredentials.userId, auth.userId), isNull(schema.webauthnCredentials.revokedAt))
      );

    const options = await generateRegistrationOptions({
      rpName: config.webauthnRpName,
      rpID,
      userName: auth.email,
      userDisplayName: auth.name,
      userID: new TextEncoder().encode(auth.userId),
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId,
        transports: c.transports as AuthenticatorTransport[]
      })),
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required'
      }
    });

    await db.insert(schema.webauthnChallenges).values({
      userId: auth.userId,
      challenge: options.challenge,
      purpose: 'registration',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    });

    return options;
  });

  app.post('/api/auth/passkey/register/verify', { preHandler: authenticateRequest }, async (request, reply) => {
    const auth = request.auth!;
    const body = z
      .object({
        response: z.any(),
        friendlyName: z.string().trim().min(1).max(80).default('Passkey')
      })
      .parse(request.body);

    const [challengeRow] = await db
      .select()
      .from(schema.webauthnChallenges)
      .where(
        and(
          eq(schema.webauthnChallenges.userId, auth.userId),
          eq(schema.webauthnChallenges.purpose, 'registration')
        )
      )
      .orderBy(desc(schema.webauthnChallenges.createdAt))
      .limit(1);

    if (!challengeRow || challengeRow.expiresAt < new Date()) {
      return reply.code(400).send({ error: 'Passkey registration challenge expired' });
    }

    const { rpID, expectedOrigin } = getWebAuthnContext(request);
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge: challengeRow.challenge,
        expectedOrigin,
        expectedRPID: rpID,
        requireUserVerification: true
      });
    } catch (err) {
      return reply.code(400).send({
        error: `Passkey registration failed: ${(err as Error).message}`
      });
    }

    if (!verification.verified || !verification.registrationInfo) {
      return reply.code(400).send({ error: 'Passkey registration verification failed' });
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    await db.insert(schema.webauthnCredentials).values({
      userId: auth.userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: (body.response?.response?.transports as string[]) ?? [],
      friendlyName: body.friendlyName,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp
    });

    await db.delete(schema.webauthnChallenges).where(eq(schema.webauthnChallenges.id, challengeRow.id));

    await rotateSession(request, reply, { mfaVerified: true, stepUpVerifiedAt: new Date() });

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'auth.passkey_registered',
      entityType: 'webauthn_credential',
      entityId: credential.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      afterJson: { friendlyName: body.friendlyName }
    });

    return { ok: true, csrfToken: request.auth!.csrfSecret };
  });

  // Passwordless / Discoverable Passkey Login
  app.post(
    '/api/auth/passkey/login/options',
    { config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } },
    async (request) => {
      const { rpID } = getWebAuthnContext(request);
      const options = await generateAuthenticationOptions({
        rpID,
        userVerification: 'required'
      });

      await db.insert(schema.webauthnChallenges).values({
        challenge: options.challenge,
        purpose: 'authentication',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000)
      });

      return options;
    }
  );

  app.post(
    '/api/auth/passkey/login/verify',
    { config: { rateLimit: { max: 15, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      const body = z.object({ response: z.any(), challenge: z.string() }).parse(request.body);

      const [challengeRow] = await db
        .select()
        .from(schema.webauthnChallenges)
        .where(
          and(
            eq(schema.webauthnChallenges.challenge, body.challenge),
            eq(schema.webauthnChallenges.purpose, 'authentication')
          )
        )
        .limit(1);

      if (!challengeRow || challengeRow.expiresAt < new Date()) {
        return reply.code(400).send({ error: 'Authentication challenge invalid or expired' });
      }

      const credId = body.response?.id as string | undefined;
      if (!credId) {
        return reply.code(400).send({ error: 'Missing credential identifier' });
      }

      const [cred] = await db
        .select()
        .from(schema.webauthnCredentials)
        .where(
          and(
            eq(schema.webauthnCredentials.credentialId, credId),
            isNull(schema.webauthnCredentials.revokedAt)
          )
        )
        .limit(1);

      if (!cred) {
        return reply.code(401).send({ error: 'Passkey not recognised' });
      }

      const [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, cred.userId))
        .limit(1);

      if (!user || !user.isActive) {
        return reply.code(401).send({ error: 'Account unavailable' });
      }

      const { rpID, expectedOrigin } = getWebAuthnContext(request);
      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response: body.response,
          expectedChallenge: challengeRow.challenge,
          expectedOrigin,
          expectedRPID: rpID,
          requireUserVerification: true,
          credential: {
            id: cred.credentialId,
            publicKey: new Uint8Array(Buffer.from(cred.publicKey, 'base64url')),
            counter: cred.counter,
            transports: cred.transports as AuthenticatorTransport[]
          }
        });
      } catch (err) {
        await recordAuthEvent({
          userId: user.id,
          email: user.email,
          eventType: 'login_passkey',
          success: false,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? '',
          metadata: { reason: (err as Error).message }
        });
        return reply.code(400).send({
          error: `Passkey verification failed: ${(err as Error).message}`
        });
      }

      if (!verification.verified) {
        await recordAuthEvent({
          userId: user.id,
          email: user.email,
          eventType: 'login_passkey',
          success: false,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? ''
        });
        return reply.code(401).send({ error: 'Passkey verification failed' });
      }

      await db
        .update(schema.webauthnCredentials)
        .set({
          counter: verification.authenticationInfo.newCounter,
          lastUsedAt: new Date()
        })
        .where(eq(schema.webauthnCredentials.id, cred.id));

      await db.delete(schema.webauthnChallenges).where(eq(schema.webauthnChallenges.id, challengeRow.id));
      await db
        .update(schema.users)
        .set({ lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null })
        .where(eq(schema.users.id, user.id));

      const { csrfSecret } = await createSession({
        userId: user.id,
        mfaVerified: true, // Passkey login is full MFA-equivalent
        authMethod: 'passkey',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? '',
        reply
      });

      await recordAuthEvent({
        userId: user.id,
        email: user.email,
        eventType: 'login_passkey',
        success: true,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? ''
      });

      await writeAuditLog({
        actorId: user.id,
        actorRole: user.role,
        action: 'auth.login_passkey',
        entityType: 'session',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? ''
      });

      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          isReviewer: user.isReviewer,
          mustChangePassword: user.mustChangePassword
        },
        csrfToken: csrfSecret,
        mfaVerified: true
      };
    }
  );

  app.get('/api/auth/passkeys', { preHandler: authenticateRequest }, async (request) => {
    const auth = request.auth!;
    const rows = await db
      .select({
        id: schema.webauthnCredentials.id,
        friendlyName: schema.webauthnCredentials.friendlyName,
        deviceType: schema.webauthnCredentials.deviceType,
        backedUp: schema.webauthnCredentials.backedUp,
        lastUsedAt: schema.webauthnCredentials.lastUsedAt,
        createdAt: schema.webauthnCredentials.createdAt
      })
      .from(schema.webauthnCredentials)
      .where(
        and(eq(schema.webauthnCredentials.userId, auth.userId), isNull(schema.webauthnCredentials.revokedAt))
      );
    return { passkeys: rows };
  });

  app.delete('/api/auth/passkeys/:id', { preHandler: requireStepUp }, async (request, reply) => {
    const auth = request.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [updated] = await db
      .update(schema.webauthnCredentials)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(schema.webauthnCredentials.id, id), eq(schema.webauthnCredentials.userId, auth.userId))
      )
      .returning();
    if (!updated) return reply.code(404).send({ error: 'Passkey not found' });

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'auth.passkey_revoked',
      entityType: 'webauthn_credential',
      entityId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? ''
    });
    return { ok: true };
  });

  // Step-up via password + TOTP
  app.post('/api/auth/step-up/verify', { preHandler: requireFullAuth }, async (request, reply) => {
    const auth = request.auth!;
    const { password, totpCode } = z
      .object({ password: z.string().min(1), totpCode: z.string().optional() })
      .parse(request.body);

    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, auth.userId)).limit(1);
    if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, password))) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const [totpRow] = await db
      .select()
      .from(schema.totpSecrets)
      .where(and(eq(schema.totpSecrets.userId, auth.userId), eq(schema.totpSecrets.verified, true)))
      .limit(1);

    if (totpRow) {
      if (!totpCode) {
        return reply.code(400).send({ error: 'Authenticator code required' });
      }
      const plainSecret = decryptTotpSecret(totpRow.encryptedSecret, totpRow.keyVersion);
      const totp = new OTPAuth.TOTP({
        issuer: 'FRAME Assessment Platform',
        label: auth.email,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(plainSecret)
      });
      if (totp.validate({ token: totpCode, window: 1 }) === null) {
        return reply.code(401).send({ error: 'Invalid authenticator code' });
      }
    }

    await rotateSession(request, reply, { stepUpVerifiedAt: new Date() });
    return { ok: true, csrfToken: request.auth!.csrfSecret };
  });

  // Active sessions list & remote revoke
  app.get('/api/auth/sessions', { preHandler: authenticateRequest }, async (request) => {
    const auth = request.auth!;
    const rows = await db
      .select({
        id: schema.sessions.id,
        ipAddress: schema.sessions.ipAddress,
        userAgent: schema.sessions.userAgent,
        authMethod: schema.sessions.authMethod,
        lastActiveAt: schema.sessions.lastActiveAt,
        createdAt: schema.sessions.createdAt
      })
      .from(schema.sessions)
      .where(and(eq(schema.sessions.userId, auth.userId), isNull(schema.sessions.revokedAt)))
      .orderBy(desc(schema.sessions.lastActiveAt));

    return {
      sessions: rows.map((r) => ({ ...r, isCurrent: r.id === auth.sessionId }))
    };
  });

  app.delete('/api/auth/sessions/:id', { preHandler: authenticateRequest }, async (request, reply) => {
    const auth = request.auth!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [updated] = await db
      .update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.sessions.id, id), eq(schema.sessions.userId, auth.userId)))
      .returning();
    if (!updated) return reply.code(404).send({ error: 'Session not found' });
    return { ok: true };
  });
}
