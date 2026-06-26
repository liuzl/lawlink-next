/** Audit sink factory + a no-op for tests/contexts without auditing. */
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
      } catch {
        /* best-effort: auditing failures must not break the operation */
      }
    },
  };
}

/** A sink that records nothing (tests / non-audited contexts). */
export const noopAuditSink: AuditSink = { async record() {} };

/** List recent audit entries (ADMIN only — audit lens, DOMAIN-SPEC §7). */
export async function listAudit(
  deps: Deps,
  auth: AuthContext,
  rawInput?: { action?: string; limit?: number },
) {
  requireRole(auth, "ADMIN");
  const limit = Math.min(rawInput?.limit ?? 100, 500);
  const where = rawInput?.action ? eq(auditLogs.action, rawInput.action) : undefined;
  return await deps.db
    .select()
    .from(auditLogs)
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}
