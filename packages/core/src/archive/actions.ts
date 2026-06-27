/** Archive (归档) — completeness gating + read-only lock (DOMAIN-SPEC §6.6, §M9). */
import { z } from "zod";
import { and, eq, ne, sql } from "drizzle-orm";
import { archiveRecords, matters } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps, type MatterCategory } from "../types.js";
import { requireRole } from "../permissions.js";
import { assertMatterAccess, matterWriteAccessExists } from "../matter/access.js";
import { requiredChecklist } from "./checklists.js";

/** The required checklist for a matter (for the UI to render). */
export async function getArchiveChecklist(deps: Deps, auth: AuthContext, rawInput: { matterId: string }) {
  const [m] = await deps.db
    .select({ id: matters.id, category: matters.category, ownerId: matters.ownerId, status: matters.status })
    .from(matters)
    .where(eq(matters.id, rawInput.matterId))
    .limit(1);
  if (!m) throw new DomainError("NOT_FOUND", "案件不存在");
  await assertMatterAccess(deps.db, m, auth);
  return { required: requiredChecklist(m.category as MatterCategory), status: m.status };
}

export const ArchiveMatterInput = z.object({
  matterId: z.string().min(1),
  summary: z.string().trim().min(1).max(5000),
  /** item name -> present? */
  checklist: z.record(z.string(), z.boolean()).default({}),
  /** Required when archiving despite missing required items (audited override).
   * Trimmed + non-empty so " " can't authorize a forced archive. */
  forceReason: z.string().trim().min(1).max(500).optional(),
});

/**
 * Archive a matter: evaluate the completeness checklist, then lock it read-only.
 * Missing required items block archiving UNLESS an explicit forceReason is given
 * (recorded for audit) — an improvement over the original's silent boolean.
 */
export async function archiveMatter(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER"); // approval action
  const input = ArchiveMatterInput.parse(rawInput);
  const now = deps.clock.now();

  // Preflight reads (gate the write; not part of the atomic unit).
  const [m] = await deps.db
    .select({ id: matters.id, category: matters.category, ownerId: matters.ownerId, status: matters.status })
    .from(matters)
    .where(eq(matters.id, input.matterId))
    .limit(1);
  if (!m) throw new DomainError("NOT_FOUND", "案件不存在");
  await assertMatterAccess(deps.db, m, auth);

  const readExisting = async () => {
    const [existing] = await deps.db
      .select()
      .from(archiveRecords)
      .where(eq(archiveRecords.matterId, input.matterId))
      .limit(1);
    return {
      matterId: input.matterId,
      archiveId: existing?.id ?? null,
      status: "ARCHIVED" as const,
      missingItems: existing ? (JSON.parse(existing.missingItems) as string[]) : [],
      forced: !!existing?.forceReason,
      alreadyArchived: true,
    };
  };

  // Idempotent: an already-archived matter returns its existing record rather
  // than failing a retry.
  if (m.status === "ARCHIVED") return readExisting();

  const required = requiredChecklist(m.category as MatterCategory);
  const missing = required.filter((item) => input.checklist[item] !== true);
  if (missing.length > 0 && !input.forceReason) {
    throw new DomainError(
      "VALIDATION",
      `归档材料缺 ${missing.length} 项必备项（${missing.join("、")}）。如确认强制归档，请填写强制归档理由。`,
    );
  }

  // Atomically claim the archive transition AND write its record in one batch()
  // — one transaction on libSQL AND D1 (D1 has no interactive transactions). The
  // claim transitions only if the matter is still non-archived (race-safe single
  // archive) AND the caller STILL has write access at write time
  // (matterWriteAccessExists) — re-checking authorization atomically rather than
  // trusting the preflight read, matching the addProcedure guard. (Archive is
  // management-only via requireRole, so this is mainly defensive/pattern parity,
  // but it closes the TOCTOU window if the role requirement ever widens.) The
  // record insert is guarded by NOT EXISTS so a concurrent archive (committed
  // first — batches serialize as transactions) makes our insert a no-op instead
  // of a duplicate-key failure. archived_at is epoch seconds.
  const id = deps.ids.newId();
  const archivedSec = Math.floor(now.getTime() / 1000);
  const claim = deps.db
    .update(matters)
    .set({ status: "ARCHIVED" })
    .where(and(eq(matters.id, input.matterId), ne(matters.status, "ARCHIVED"), matterWriteAccessExists(auth, input.matterId)))
    .returning({ id: matters.id });
  const ins = deps.db.insert(archiveRecords).select(sql`
    select ${id}, ${input.matterId}, ${input.summary}, ${JSON.stringify(input.checklist)},
      ${JSON.stringify(missing)}, ${input.forceReason ?? null}, ${auth.userId}, ${archivedSec}
    where not exists (select 1 from "ArchiveRecord" where "matter_id" = ${input.matterId})
  `);
  const results = await deps.db.batch([claim, ins]);
  const claimed = (results[0] as unknown[]).length === 1;

  // A concurrent archiver won the claim; return its record (no second audit).
  if (!claimed) return readExisting();

  const result = {
    matterId: input.matterId,
    archiveId: id,
    status: "ARCHIVED" as const,
    missingItems: missing,
    forced: missing.length > 0,
    alreadyArchived: false,
  };

  if (!result.alreadyArchived) {
    await deps.audit.record(auth, {
      action: "MATTER_ARCHIVE",
      targetType: "Matter",
      targetId: input.matterId,
      detail: { forced: result.forced, missingCount: result.missingItems.length },
    });
  }
  return result;
}
