/** Audit sink factory + a no-op for tests/contexts without auditing. */
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { auditLogs } from "@lawlink/db";
import {
  type AuditSink,
  type AuthContext,
  type Clock,
  type Deps,
  type IdGen,
} from "../types.js";
import { requireRole } from "../permissions.js";

/** Build a DB-backed audit sink. `ctx` carries request metadata (ip/userAgent).
 * record() swallows its own errors so auditing never breaks the main op. */
export function createAuditSink(
  db: Deps["db"],
  ids: IdGen,
  clock: Clock,
  ctx?: { ip?: string; userAgent?: string },
): AuditSink {
  return {
    async record(actor, entry) {
      try {
        await db.insert(auditLogs).values({
          id: ids.newId(),
          userId: actor.userId,
          action: entry.action,
          targetType: entry.targetType ?? null,
          targetId: entry.targetId ?? null,
          detailJson: entry.detail !== undefined ? JSON.stringify(entry.detail) : null,
          ip: ctx?.ip ?? null,
          userAgent: ctx?.userAgent ?? null,
          createdAt: clock.now(),
        });
      } catch (err) {
        // Best-effort: auditing failures must not break (or roll back) the
        // operation — but they must not be invisible either. A silently empty
        // audit trail is itself a compliance failure, so emit a structured
        // signal operators can alert/count on.
        console.error(
          JSON.stringify({
            level: "error",
            event: "audit.record.failed",
            action: entry.action,
            actorId: actor.userId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    },
    // Rebind to another db handle (e.g. a transaction) keeping the SAME ctx, so
    // audit rows written through a nested transactional use case still carry the
    // request's ip/userAgent.
    withDb(newDb) {
      return createAuditSink(newDb, ids, clock, ctx);
    },
  };
}

/** A sink that records nothing (tests / non-audited contexts). */
export const noopAuditSink: AuditSink = { async record() {} };

/** Validate listing params: coerce + clamp limit to a finite [1, 500] so a
 * negative/NaN value can't ride SQLite's "negative LIMIT = unbounded" quirk. */
export const ListAuditInput = z.object({
  action: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(500).catch(100),
});

/** List recent audit entries (ADMIN only — audit lens, DOMAIN-SPEC §7). */
export async function listAudit(
  deps: Deps,
  auth: AuthContext,
  rawInput?: { action?: string; limit?: number },
) {
  requireRole(auth, "ADMIN");
  const { action, limit } = ListAuditInput.parse(rawInput ?? {});
  const where = action ? eq(auditLogs.action, action) : undefined;
  return await deps.db
    .select()
    .from(auditLogs)
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}
