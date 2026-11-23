import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as OTPAuth from 'otpauth';
import { eq } from 'drizzle-orm';
import { buildApp } from '../app.js';
import { db, pool, schema } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { runSeed } from '../db/seed.js';
import { hashPassword } from '../services/crypto.js';

function extractCookie(setCookieHeader: string | string[] | undefined): string {
  if (!setCookieHeader) return '';
  const arr = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  const first = arr[0] ?? '';
  return first.split(';')[0] ?? '';
}

describe('FRAME API Integration Tests', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminCookie = '';
  let adminCsrf = '';
  let userCookie = '';
  let userCsrf = '';
  let reviewerCookie = '';
  let reviewerCsrf = '';
  let auditorCookie = '';
  let auditorCsrf = '';
  let orgId = '';
  let systemId = '';
  let assessmentId = '';

  before(async () => {
    await runMigrations();
    await runSeed();
    app = await buildApp();

    // Ensure test org and users exist cleanly
    const [existingOrg] = await db
      .select()
      .from(schema.organisations)
      .where(eq(schema.organisations.slug, 'test-org-int'))
      .limit(1);

    if (existingOrg) {
      orgId = existingOrg.id;
    } else {
      const [org] = await db
        .insert(schema.organisations)
        .values({ name: 'Integration Test Org', slug: 'test-org-int' })
        .returning();
      orgId = org.id;
    }

    const passHash = await hashPassword('StrongTestPass2026!@#');

    const ensureUser = async (email: string, name: string, role: string, isReviewer: boolean) => {
      const [existing] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      if (existing) return existing;
      const [created] = await db
        .insert(schema.users)
        .values({ email, name, role, isReviewer, passwordHash: passHash, isActive: true })
        .returning();
      if (role !== 'admin') {
        await db.insert(schema.userScopes).values({ userId: created.id, organisationId: orgId });
      }
      return created;
    };

    const admin = await ensureUser('int-admin@frame.local', 'Int Admin', 'admin', true);
    const user = await ensureUser('int-user@frame.local', 'Int User', 'user', false);
    const reviewer = await ensureUser('int-reviewer@frame.local', 'Int Reviewer', 'user', true);
    const auditor = await ensureUser('int-auditor@frame.local', 'Int Auditor', 'auditor', false);

    // Helper to login + enrol TOTP
    const loginAndEnrolMfa = async (email: string) => {
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email, password: 'StrongTestPass2026!@#' }
      });
      assert.equal(loginRes.statusCode, 200);
      const cookie = extractCookie(loginRes.headers['set-cookie']);
      let csrf = loginRes.json().csrfToken as string;

      const meRes = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie }
      });
      const me = meRes.json();

      if (!me.hasMfaEnrolled) {
        const setupRes = await app.inject({
          method: 'POST',
          url: '/api/auth/mfa/totp/setup',
          headers: { cookie, 'x-csrf-token': csrf }
        });
        assert.equal(setupRes.statusCode, 200);
        const { manualKey } = setupRes.json() as { manualKey: string };
        const totp = new OTPAuth.TOTP({
          algorithm: 'SHA1',
          digits: 6,
          period: 30,
          secret: OTPAuth.Secret.fromBase32(manualKey)
        });
        const verifyRes = await app.inject({
          method: 'POST',
          url: '/api/auth/mfa/totp/verify-setup',
          headers: { cookie, 'x-csrf-token': csrf },
          payload: { code: totp.generate() }
        });
        assert.equal(verifyRes.statusCode, 200);
        const newCookie = extractCookie(verifyRes.headers['set-cookie']) || cookie;
        const meAfter = await app.inject({
          method: 'GET',
          url: '/api/auth/me',
          headers: { cookie: newCookie }
        });
        csrf = meAfter.json().csrfToken;
        return { cookie: newCookie, csrf };
      } else if (!me.mfaVerified) {
        // Re-setup TOTP for deterministic test run
        const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
        await db.delete(schema.totpSecrets).where(eq(schema.totpSecrets.userId, u.id));
        const setupRes = await app.inject({
          method: 'POST',
          url: '/api/auth/mfa/totp/setup',
          headers: { cookie, 'x-csrf-token': csrf }
        });
        const { manualKey } = setupRes.json() as { manualKey: string };
        const totp = new OTPAuth.TOTP({
          algorithm: 'SHA1',
          digits: 6,
          period: 30,
          secret: OTPAuth.Secret.fromBase32(manualKey)
        });
        const verifyRes = await app.inject({
          method: 'POST',
          url: '/api/auth/mfa/totp/verify-setup',
          headers: { cookie, 'x-csrf-token': csrf },
          payload: { code: totp.generate() }
        });
        const newCookie = extractCookie(verifyRes.headers['set-cookie']) || cookie;
        const meAfter = await app.inject({
          method: 'GET',
          url: '/api/auth/me',
          headers: { cookie: newCookie }
        });
        csrf = meAfter.json().csrfToken;
        return { cookie: newCookie, csrf };
      }
      return { cookie, csrf };
    };

    void admin;
    void user;
    void reviewer;
    void auditor;

    const a = await loginAndEnrolMfa('int-admin@frame.local');
    adminCookie = a.cookie;
    adminCsrf = a.csrf;

    const u = await loginAndEnrolMfa('int-user@frame.local');
    userCookie = u.cookie;
    userCsrf = u.csrf;

    const r = await loginAndEnrolMfa('int-reviewer@frame.local');
    reviewerCookie = r.cookie;
    reviewerCsrf = r.csrf;

    const aud = await loginAndEnrolMfa('int-auditor@frame.local');
    auditorCookie = aud.cookie;
    auditorCsrf = aud.csrf;
  });

  after(async () => {
    await app.close();
    await pool.end();
  });

  it('rejects weak/breached passwords on strength check', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password/check-strength',
      payload: { password: 'password1234' }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().acceptable, false);
  });

  it('allows scoped User to create AI system and complete + submit a full assessment', async () => {
    const sysRes = await app.inject({
      method: 'POST',
      url: '/api/ai-systems',
      headers: { cookie: userCookie, 'x-csrf-token': userCsrf },
      payload: {
        organisationId: orgId,
        name: 'Integration Test Agent',
        description: 'Automated governance test system',
        lifecycleStage: 'pilot',
        deploymentType: 'autonomous_agent',
        riskTier: 'high',
        targetMaturityLevel: 3
      }
    });
    assert.equal(sysRes.statusCode, 201);
    systemId = sysRes.json().id;

    const assRes = await app.inject({
      method: 'POST',
      url: '/api/assessments',
      headers: { cookie: userCookie, 'x-csrf-token': userCsrf },
      payload: {
        aiSystemId: systemId,
        title: 'Integration Full FRAME Assessment',
        scopeType: 'full',
        assessmentType: 'pre_deployment'
      }
    });
    assert.equal(assRes.statusCode, 201);
    assessmentId = assRes.json().id;

    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/assessments/${assessmentId}`,
      headers: { cookie: userCookie }
    });
    assert.equal(detailRes.statusCode, 200);
    const dims = detailRes.json().dimensions as Array<{ questions: Array<{ id: string }> }>;
    const allQs = dims.flatMap((d) => d.questions);
    assert.equal(allQs.length, 40);

    for (const q of allQs) {
      const saveRes = await app.inject({
        method: 'PUT',
        url: `/api/assessments/${assessmentId}/responses`,
        headers: { cookie: userCookie, 'x-csrf-token': userCsrf },
        payload: {
          questionId: q.id,
          rating: 3,
          rationale: 'Verified governance documentation and controls.',
          confidence: 'high',
          isNa: false
        }
      });
      assert.equal(saveRes.statusCode, 200);
    }

    const submitRes = await app.inject({
      method: 'POST',
      url: `/api/assessments/${assessmentId}/submit`,
      headers: { cookie: userCookie, 'x-csrf-token': userCsrf },
      payload: { narrativeSummary: 'Ready for independent review.' }
    });
    assert.equal(submitRes.statusCode, 200);
    assert.equal(submitRes.json().status, 'submitted');
  });

  it('enforces four-eyes principle and allows a different Reviewer to approve', async () => {
    // Author cannot approve own submission even if reviewer
    const selfReview = await app.inject({
      method: 'POST',
      url: `/api/assessments/${assessmentId}/review`,
      headers: { cookie: userCookie, 'x-csrf-token': userCsrf },
      payload: { decision: 'approved', reason: 'Self approval attempt' }
    });
    assert.equal(selfReview.statusCode, 403);

    // Different Reviewer approves
    const revRes = await app.inject({
      method: 'POST',
      url: `/api/assessments/${assessmentId}/review`,
      headers: { cookie: reviewerCookie, 'x-csrf-token': reviewerCsrf },
      payload: { decision: 'approved', reason: 'Independent review verified all 40 indicators.' }
    });
    assert.equal(revRes.statusCode, 200);
    assert.equal(revRes.json().status, 'approved');
    assert.ok(revRes.json().approvedSnapshotJson);
  });

  it('denies every write action for Auditor, but allows viewing and Audit Findings', async () => {
    const denyCreateSys = await app.inject({
      method: 'POST',
      url: '/api/ai-systems',
      headers: { cookie: auditorCookie, 'x-csrf-token': auditorCsrf },
      payload: {
        organisationId: orgId,
        name: 'Forbidden System',
        description: 'Should fail',
        lifecycleStage: 'idea',
        deploymentType: 'assistant'
      }
    });
    assert.equal(denyCreateSys.statusCode, 403);

    const denyCreateAss = await app.inject({
      method: 'POST',
      url: '/api/assessments',
      headers: { cookie: auditorCookie, 'x-csrf-token': auditorCsrf },
      payload: { aiSystemId: systemId, title: 'Forbidden' }
    });
    assert.equal(denyCreateAss.statusCode, 403);

    const denyManageUsers = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { cookie: auditorCookie }
    });
    assert.equal(denyManageUsers.statusCode, 403);

    // Auditor can view assessment and record Audit Finding
    const viewRes = await app.inject({
      method: 'GET',
      url: `/api/assessments/${assessmentId}`,
      headers: { cookie: auditorCookie }
    });
    assert.equal(viewRes.statusCode, 200);

    const findingRes = await app.inject({
      method: 'POST',
      url: '/api/audit-findings',
      headers: { cookie: auditorCookie, 'x-csrf-token': auditorCsrf },
      payload: {
        aiSystemId: systemId,
        assessmentId,
        title: 'Sample independent audit observation',
        observation: 'Verify quarterly escalation drill log retention.',
        severity: 'low'
      }
    });
    assert.equal(findingRes.statusCode, 201);
  });

  it('verifies audit log hash-chain integrity and exports A4 PDF and DOCX reports', async () => {
    const verifyRes = await app.inject({
      method: 'POST',
      url: '/api/audit-logs/verify',
      headers: { cookie: adminCookie, 'x-csrf-token': adminCsrf }
    });
    assert.equal(verifyRes.statusCode, 200);
    assert.equal(verifyRes.json().valid, true);
    assert.ok(verifyRes.json().totalRows > 5);

    const pdfRes = await app.inject({
      method: 'GET',
      url: `/api/reports/assessments/${assessmentId}/pdf`,
      headers: { cookie: adminCookie }
    });
    assert.equal(pdfRes.statusCode, 200);
    assert.ok(pdfRes.rawPayload.subarray(0, 4).toString('ascii') === '%PDF');

    const docxRes = await app.inject({
      method: 'GET',
      url: `/api/reports/assessments/${assessmentId}/docx`,
      headers: { cookie: adminCookie }
    });
    assert.equal(docxRes.statusCode, 200);
    assert.equal(docxRes.rawPayload[0], 0x50);
    assert.equal(docxRes.rawPayload[1], 0x4b);

    const sysPdfRes = await app.inject({
      method: 'GET',
      url: `/api/reports/systems/${systemId}/pdf`,
      headers: { cookie: adminCookie }
    });
    assert.equal(sysPdfRes.statusCode, 200);
    assert.ok(sysPdfRes.rawPayload.subarray(0, 4).toString('ascii') === '%PDF');
  });

  it('allows Admin to create a user directly with an initial password without email', async () => {
    const email = `direct-${Date.now()}@frame.local`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { cookie: adminCookie, 'x-csrf-token': adminCsrf },
      payload: {
        name: 'Direct Created User',
        email,
        password: 'DirectUserPass2026!@#',
        role: 'user',
        isReviewer: false,
        mustChangePassword: true,
        organisationIds: [orgId]
      }
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().email, email);
  });
});
