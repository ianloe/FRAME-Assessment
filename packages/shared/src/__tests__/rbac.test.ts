import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasPermission, getPermissionsMatrix } from '../rbac.js';

describe('RBAC permissions', () => {
  const admin = { id: 'a1', role: 'admin' as const, isReviewer: false };
  const user = { id: 'u1', role: 'user' as const, isReviewer: false };
  const reviewerUser = { id: 'u2', role: 'user' as const, isReviewer: true };
  const auditor = { id: 'aud1', role: 'auditor' as const, isReviewer: false };

  it('grants admin management permissions and denies user/auditor', () => {
    assert.equal(hasPermission(admin, 'users:manage'), true);
    assert.equal(hasPermission(user, 'users:manage'), false);
    assert.equal(hasPermission(auditor, 'users:manage'), false);
  });

  it('enforces four-eyes principle on assessment review', () => {
    assert.equal(hasPermission(reviewerUser, 'assessment:review', { inScope: true, isOwnerOrAuthor: false }), true);
    assert.equal(hasPermission(reviewerUser, 'assessment:review', { inScope: true, isOwnerOrAuthor: true }), false);
    assert.equal(hasPermission(admin, 'assessment:review', { inScope: true, isOwnerOrAuthor: true }), false);
    assert.equal(hasPermission(user, 'assessment:review', { inScope: true, isOwnerOrAuthor: false }), false);
    assert.equal(hasPermission(auditor, 'assessment:review', { inScope: true, isOwnerOrAuthor: false }), false);
  });

  it('keeps auditor strictly read-only on assessments and allows audit findings only for auditor', () => {
    assert.equal(hasPermission(auditor, 'assessment:view', { inScope: true }), true);
    assert.equal(hasPermission(auditor, 'assessment:answer', { inScope: true }), false);
    assert.equal(hasPermission(auditor, 'assessment:edit', { inScope: true }), false);
    assert.equal(hasPermission(auditor, 'ai_system:create', { inScope: true }), false);
    assert.equal(hasPermission(auditor, 'audit_finding:create', { inScope: true }), true);
    assert.equal(hasPermission(admin, 'audit_finding:create', { inScope: true }), false);
    assert.equal(hasPermission(user, 'audit_finding:create', { inScope: true }), false);
  });

  it('allows user to archive own drafts only', () => {
    assert.equal(
      hasPermission(user, 'assessment:archive_own_draft', { inScope: true, isOwnerOrAuthor: true, isDraft: true }),
      true
    );
    assert.equal(
      hasPermission(user, 'assessment:archive_own_draft', { inScope: true, isOwnerOrAuthor: false, isDraft: true }),
      false
    );
    assert.equal(
      hasPermission(user, 'assessment:archive_own_draft', { inScope: true, isOwnerOrAuthor: true, isDraft: false }),
      false
    );
  });

  it('generates permissions matrix from live definitions', () => {
    const matrix = getPermissionsMatrix();
    assert.ok(matrix.length >= 20);
    assert.ok(matrix.some((r) => r.permission === 'audit_finding:create'));
  });
});
