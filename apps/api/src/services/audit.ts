import { desc, asc, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { sha256Hex } from './crypto.js';

export interface AuditEntryInput {
  actorId?: string | null;
  actorRole?: string;
  action: string;
  entityType: string;
  entityId?: string;
  ipAddress?: string;
  userAgent?: string;
  beforeJson?: unknown;
  afterJson?: unknown;
}

const GENESIS_HASH = '0'.repeat(64);
const AUDIT_LOCK_KEY = 42424201;

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) {
        sorted[key] = canonicalize(v);
      }
    }
    return sorted;
  }
  return value;
}

function computeRowHash(params: {
  seq: number;
  actorId: string | null;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeJson: unknown;
  afterJson: unknown;
  prevHash: string;
  createdAtIso: string;
}): string {
  const canonical = JSON.stringify({
    seq: params.seq,
    actorId: params.actorId,
    actorRole: params.actorRole,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    beforeJson: canonicalize(params.beforeJson),
    afterJson: canonicalize(params.afterJson),
    prevHash: params.prevHash,
    createdAtIso: params.createdAtIso
  });
  return sha256Hex(canonical);
}

export async function writeAuditLog(entry: AuditEntryInput): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`);
    const [latest] = await tx
      .select({ seq: schema.auditLogs.seq, rowHash: schema.auditLogs.rowHash })
      .from(schema.auditLogs)
      .orderBy(desc(schema.auditLogs.seq))
      .limit(1);

    const nextSeq = latest ? Number(latest.seq) + 1 : 1;
    const prevHash = latest ? latest.rowHash : GENESIS_HASH;
    const createdAt = new Date();
    const createdAtIso = createdAt.toISOString();
    const actorId = entry.actorId ?? null;
    const actorRole = entry.actorRole ?? 'system';
    const entityId = entry.entityId ?? '';

    const rowHash = computeRowHash({
      seq: nextSeq,
      actorId,
      actorRole,
      action: entry.action,
      entityType: entry.entityType,
      entityId,
      beforeJson: entry.beforeJson ?? null,
      afterJson: entry.afterJson ?? null,
      prevHash,
      createdAtIso
    });

    await tx.insert(schema.auditLogs).values({
      seq: nextSeq,
      actorId,
      actorRole,
      action: entry.action,
      entityType: entry.entityType,
      entityId,
      ipAddress: entry.ipAddress ?? '',
      userAgent: entry.userAgent ?? '',
      beforeJson: entry.beforeJson ?? null,
      afterJson: entry.afterJson ?? null,
      prevHash,
      rowHash,
      createdAt
    });
  });
}

export async function verifyAuditLogChain(): Promise<{
  valid: boolean;
  totalRows: number;
  brokenAtSeq?: number;
  reason?: string;
}> {
  const rows = await db
    .select()
    .from(schema.auditLogs)
    .orderBy(asc(schema.auditLogs.seq));

  let expectedPrevHash = GENESIS_HASH;
  let expectedSeq = 1;

  for (const row of rows) {
    if (Number(row.seq) !== expectedSeq) {
      return {
        valid: false,
        totalRows: rows.length,
        brokenAtSeq: Number(row.seq),
        reason: `Sequence gap: expected ${expectedSeq}, found ${row.seq}`
      };
    }
    if (row.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        totalRows: rows.length,
        brokenAtSeq: Number(row.seq),
        reason: `prevHash mismatch at seq ${row.seq}`
      };
    }
    const recomputed = computeRowHash({
      seq: Number(row.seq),
      actorId: row.actorId ?? null,
      actorRole: row.actorRole,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      beforeJson: row.beforeJson ?? null,
      afterJson: row.afterJson ?? null,
      prevHash: row.prevHash,
      createdAtIso: row.createdAt.toISOString()
    });
    if (recomputed !== row.rowHash) {
      return {
        valid: false,
        totalRows: rows.length,
        brokenAtSeq: Number(row.seq),
        reason: `rowHash mismatch at seq ${row.seq} (record modified)`
      };
    }
    expectedPrevHash = row.rowHash;
    expectedSeq++;
  }

  return { valid: true, totalRows: rows.length };
}
