import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { Role } from '@frame/shared';

export interface UserScopeEntry {
  organisationId: string | null;
  businessUnitId: string | null;
  aiSystemId: string | null;
}

export async function getUserScopes(userId: string): Promise<UserScopeEntry[]> {
  return db
    .select({
      organisationId: schema.userScopes.organisationId,
      businessUnitId: schema.userScopes.businessUnitId,
      aiSystemId: schema.userScopes.aiSystemId
    })
    .from(schema.userScopes)
    .where(eq(schema.userScopes.userId, userId));
}

export function isEntityInScope(
  role: Role,
  scopes: UserScopeEntry[],
  target: {
    organisationId?: string | null;
    businessUnitId?: string | null;
    aiSystemId?: string | null;
  }
): boolean {
  if (role === 'admin') return true;
  if (scopes.length === 0) return false;

  return scopes.some((s) => {
    if (s.aiSystemId && target.aiSystemId && s.aiSystemId === target.aiSystemId) {
      return true;
    }
    if (s.businessUnitId && target.businessUnitId && s.businessUnitId === target.businessUnitId) {
      return true;
    }
    if (
      s.organisationId &&
      !s.businessUnitId &&
      !s.aiSystemId &&
      target.organisationId &&
      s.organisationId === target.organisationId
    ) {
      return true;
    }
    return false;
  });
}
