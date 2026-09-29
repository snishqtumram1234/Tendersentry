// Tamper-evident audit trail (spec §16, CLAUDE.md rule 13): every critical mutation writes an
// audit event in the SAME transaction as the mutation, chained by hash. Must be called with a
// Prisma transaction client (`tx`) so a failed mutation cannot produce an orphan audit event.
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

export interface AuditInput {
  action: string; // e.g. "LOGIN_SUCCESS", "RULE_APPROVED", "BID_SUBMITTED"
  entityType: string;
  entityId?: string | null;
  actorId?: string | null;
  actorRole?: string | null;
  actorPortal?: string | null;
  organisationId?: string | null;
  tenderId?: string | null;
  bidId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  evidenceRefs?: unknown;
  ip?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
}

const GENESIS_HASH = "0".repeat(64);
const CHAIN_LOCK_KEY = BigInt("0x" + createHash("sha256").update("ts_audit_chain").digest("hex").slice(0, 15));

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeys((value as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return value;
}

/**
 * Appends one audit event inside `tx`, chained to the previous event's hash.
 * Uses a transaction-scoped advisory lock so concurrent writers (through the
 * Supavisor transaction pooler) still serialise correctly (spec §7.0, §16).
 */
export async function writeAudit(tx: Prisma.TransactionClient, input: AuditInput): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CHAIN_LOCK_KEY})`;

  const last = await tx.auditEvent.findFirst({ orderBy: { id: "desc" }, select: { hash: true } });
  const prevHash = last?.hash ?? GENESIS_HASH;

  const code = `AUD-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8)}`;
  const occurredAt = new Date();

  const body = {
    code,
    occurredAt: occurredAt.toISOString(),
    actorId: input.actorId ?? null,
    actorRole: input.actorRole ?? null,
    actorPortal: input.actorPortal ?? null,
    organisationId: input.organisationId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    tenderId: input.tenderId ?? null,
    bidId: input.bidId ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    reason: input.reason ?? null,
    evidenceRefs: input.evidenceRefs ?? null,
    ip: input.ip ?? null,
    sessionId: input.sessionId ?? null,
    requestId: input.requestId ?? null,
    prevHash,
  };

  const hash = createHash("sha256").update(prevHash + canonicalJson(body)).digest("hex");

  await tx.auditEvent.create({
    data: {
      code,
      occurredAt,
      actorId: input.actorId ?? undefined,
      actorRole: input.actorRole ?? undefined,
      actorPortal: input.actorPortal ?? undefined,
      organisationId: input.organisationId ?? undefined,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? undefined,
      tenderId: input.tenderId ?? undefined,
      bidId: input.bidId ?? undefined,
      before: input.before as Prisma.InputJsonValue,
      after: input.after as Prisma.InputJsonValue,
      reason: input.reason ?? undefined,
      evidenceRefs: input.evidenceRefs as Prisma.InputJsonValue,
      ip: input.ip ?? undefined,
      sessionId: input.sessionId ?? undefined,
      requestId: input.requestId ?? undefined,
      prevHash,
      hash,
    },
  });
}

export interface ChainVerificationResult {
  ok: boolean;
  checked: number;
  firstBrokenLinkId: string | null;
}

/** Recomputes the hash chain and reports the first broken link, if any (spec §16, GET /api/audit/verify-chain). */
export async function verifyChain(tx: Prisma.TransactionClient | typeof import("../lib/prisma.js").prisma): Promise<ChainVerificationResult> {
  let prevHash = GENESIS_HASH;
  let checked = 0;
  const batchSize = 1000;
  let cursor: bigint | undefined;

  for (;;) {
    const batch = await tx.auditEvent.findMany({
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (batch.length === 0) break;

    for (const row of batch) {
      const body = {
        code: row.code,
        occurredAt: row.occurredAt.toISOString(),
        actorId: row.actorId,
        actorRole: row.actorRole,
        actorPortal: row.actorPortal,
        organisationId: row.organisationId,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        tenderId: row.tenderId,
        bidId: row.bidId,
        before: row.before,
        after: row.after,
        reason: row.reason,
        evidenceRefs: row.evidenceRefs,
        ip: row.ip,
        sessionId: row.sessionId,
        requestId: row.requestId,
        prevHash: row.prevHash,
      };
      const expected = createHash("sha256").update(prevHash + canonicalJson(body)).digest("hex");
      checked++;
      if (row.prevHash !== prevHash || row.hash !== expected) {
        return { ok: false, checked, firstBrokenLinkId: row.id.toString() };
      }
      prevHash = row.hash;
    }
    cursor = batch[batch.length - 1]!.id;
  }
  return { ok: true, checked, firstBrokenLinkId: null };
}
