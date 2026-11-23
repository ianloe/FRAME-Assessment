import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq, and, isNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import { sha256Hex, generateOpaqueToken } from '../services/crypto.js';
import { DEFAULT_SECURITY_POLICY, getSetting, type SecurityPolicy } from '../services/settings.js';
import { getUserScopes, type UserScopeEntry } from '../services/scope.js';
import { hasPermission, type Permission, type PermissionContext, type Role } from '@frame/shared';

export const SESSION_COOKIE_NAME = 'frame_session';

export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  role: Role;
  isReviewer: boolean;
  mustChangePassword: boolean;
  sessionId: string;
  csrfSecret: string;
  mfaVerified: boolean;
  hasMfaEnrolled: boolean;
  hasPasskeyEnrolled: boolean;
  stepUpVerifiedAt: Date | null;
  scopes: UserScopeEntry[];
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export async function createSession(params: {
  userId: string;
  mfaVerified: boolean;
  authMethod: 'password' | 'passkey';
  ipAddress: string;
  userAgent: string;
  reply: FastifyReply;
}) {
  const policy = await getSetting<SecurityPolicy>('security_policy', DEFAULT_SECURITY_POLICY);
  const rawToken = generateOpaqueToken(32);
  const csrfSecret = generateOpaqueToken(24);
  const now = new Date();
  const idleExpiresAt = new Date(now.getTime() + policy.idleTimeoutMinutes * 60 * 1000);
  const absoluteExpiresAt = new Date(now.getTime() + policy.absoluteTimeoutHours * 60 * 60 * 1000);

  const [session] = await db
    .insert(schema.sessions)
    .values({
      userId: params.userId,
      tokenHash: sha256Hex(rawToken),
      csrfSecret,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      mfaVerified: params.mfaVerified,
      authMethod: params.authMethod,
      stepUpVerifiedAt: params.mfaVerified ? now : null,
      idleExpiresAt,
      absoluteExpiresAt,
      lastActiveAt: now
    })
    .returning();

  params.reply.setCookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.nodeEnv === 'production' && config.appBaseUrl.startsWith('https://'),
    path: '/',
    maxAge: policy.absoluteTimeoutHours * 3600
  });

  return { session, csrfSecret };
}

export async function rotateSession(
  request: FastifyRequest,
  reply: FastifyReply,
  updates: Partial<{ mfaVerified: boolean; stepUpVerifiedAt: Date; authMethod: 'password' | 'passkey' }>
) {
  if (!request.auth) return;
  const oldSessionId = request.auth.sessionId;
  const policy = await getSetting<SecurityPolicy>('security_policy', DEFAULT_SECURITY_POLICY);
  const rawToken = generateOpaqueToken(32);
  const csrfSecret = generateOpaqueToken(24);
  const now = new Date();
  const idleExpiresAt = new Date(now.getTime() + policy.idleTimeoutMinutes * 60 * 1000);
  const absoluteExpiresAt = new Date(now.getTime() + policy.absoluteTimeoutHours * 60 * 60 * 1000);

  await db
    .update(schema.sessions)
    .set({ revokedAt: now })
    .where(eq(schema.sessions.id, oldSessionId));

  const [newSession] = await db
    .insert(schema.sessions)
    .values({
      userId: request.auth.userId,
      tokenHash: sha256Hex(rawToken),
      csrfSecret,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      mfaVerified: updates.mfaVerified ?? request.auth.mfaVerified,
      authMethod: updates.authMethod ?? 'password',
      stepUpVerifiedAt: updates.stepUpVerifiedAt ?? request.auth.stepUpVerifiedAt,
      idleExpiresAt,
      absoluteExpiresAt,
      lastActiveAt: now
    })
    .returning();

  reply.setCookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.nodeEnv === 'production' && config.appBaseUrl.startsWith('https://'),
    path: '/',
    maxAge: policy.absoluteTimeoutHours * 3600
  });

  request.auth.sessionId = newSession.id;
  request.auth.csrfSecret = csrfSecret;
  request.auth.mfaVerified = newSession.mfaVerified;
  request.auth.stepUpVerifiedAt = newSession.stepUpVerifiedAt;
}

export async function authenticateRequest(request: FastifyRequest, reply: FastifyReply) {
  const rawToken = request.cookies[SESSION_COOKIE_NAME];
  if (!rawToken) {
    return reply.code(401).send({ error: 'Authentication required' });
  }

  const tokenHash = sha256Hex(rawToken);
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.tokenHash, tokenHash), isNull(schema.sessions.revokedAt)))
    .limit(1);

  if (!session) {
    return reply.code(401).send({ error: 'Session invalid or expired' });
  }

  const now = new Date();
  if (session.idleExpiresAt < now || session.absoluteExpiresAt < now) {
    await db
      .update(schema.sessions)
      .set({ revokedAt: now })
      .where(eq(schema.sessions.id, session.id));
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return reply.code(401).send({ error: 'Session expired' });
  }

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);

  if (!user || !user.isActive) {
    return reply.code(401).send({ error: 'Account unavailable' });
  }

  // CSRF validation for state-changing methods
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const headerCsrf = request.headers['x-csrf-token'];
    if (typeof headerCsrf !== 'string' || headerCsrf !== session.csrfSecret) {
      return reply.code(403).send({ error: 'Invalid CSRF token' });
    }
  }

  const policy = await getSetting<SecurityPolicy>('security_policy', DEFAULT_SECURITY_POLICY);
  const newIdle = new Date(now.getTime() + policy.idleTimeoutMinutes * 60 * 1000);
  await db
    .update(schema.sessions)
    .set({ lastActiveAt: now, idleExpiresAt: newIdle })
    .where(eq(schema.sessions.id, session.id));

  const [totp] = await db
    .select({ verified: schema.totpSecrets.verified })
    .from(schema.totpSecrets)
    .where(eq(schema.totpSecrets.userId, user.id))
    .limit(1);

  const passkeys = await db
    .select({ id: schema.webauthnCredentials.id })
    .from(schema.webauthnCredentials)
    .where(
      and(eq(schema.webauthnCredentials.userId, user.id), isNull(schema.webauthnCredentials.revokedAt))
    );

  const hasPasskeyEnrolled = passkeys.length > 0;
  const hasMfaEnrolled = Boolean(totp?.verified) || hasPasskeyEnrolled;
  const scopes = await getUserScopes(user.id);

  request.auth = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
    isReviewer: user.isReviewer,
    mustChangePassword: user.mustChangePassword,
    sessionId: session.id,
    csrfSecret: session.csrfSecret,
    mfaVerified: session.mfaVerified,
    hasMfaEnrolled,
    hasPasskeyEnrolled,
    stepUpVerifiedAt: session.stepUpVerifiedAt,
    scopes
  };
}

export async function requireFullAuth(request: FastifyRequest, reply: FastifyReply) {
  await authenticateRequest(request, reply);
  if (reply.sent || !request.auth) return;

  const policy = await getSetting<SecurityPolicy>('security_policy', DEFAULT_SECURITY_POLICY);
  const mfaMandatory = policy.mfaRequiredForAll || request.auth.role === 'admin';

  if (mfaMandatory && (!request.auth.hasMfaEnrolled || !request.auth.mfaVerified)) {
    return reply.code(403).send({
      error: 'Multi-factor authentication required before accessing application data',
      code: request.auth.hasMfaEnrolled ? 'MFA_VERIFICATION_REQUIRED' : 'MFA_ENROLMENT_REQUIRED'
    });
  }

  if (request.auth.role === 'admin' && policy.passkeyRequiredForAdmins && !request.auth.hasPasskeyEnrolled) {
    return reply.code(403).send({
      error: 'Passkey enrolment is required for Administrators',
      code: 'PASSKEY_ENROLMENT_REQUIRED'
    });
  }
}

export async function requireStepUp(request: FastifyRequest, reply: FastifyReply) {
  await requireFullAuth(request, reply);
  if (reply.sent || !request.auth) return;

  const policy = await getSetting<SecurityPolicy>('security_policy', DEFAULT_SECURITY_POLICY);
  const verifiedAt = request.auth.stepUpVerifiedAt;
  const windowMs = policy.stepUpWindowMinutes * 60 * 1000;
  if (!verifiedAt || Date.now() - verifiedAt.getTime() > windowMs) {
    return reply.code(403).send({
      error: 'Step-up re-authentication required for this sensitive action',
      code: 'STEP_UP_REQUIRED'
    });
  }
}

export function assertPermission(
  request: FastifyRequest,
  reply: FastifyReply,
  permission: Permission,
  ctx: PermissionContext = {}
): boolean {
  if (!request.auth) {
    reply.code(401).send({ error: 'Authentication required' });
    return false;
  }
  const allowed = hasPermission(
    { id: request.auth.userId, role: request.auth.role, isReviewer: request.auth.isReviewer },
    permission,
    ctx
  );
  if (!allowed) {
    reply.code(403).send({ error: 'Forbidden: insufficient permissions' });
    return false;
  }
  return true;
}
