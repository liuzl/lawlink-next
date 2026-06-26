/** Archive (归档) — completeness gating + read-only lock (DOMAIN-SPEC §6.6, §M9). */
import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { archiveRecords, matters } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps, type MatterCategory } from "../types.js";
import { requireRole } from "../permissions.js";
import { assertMatterAccess } from "../matter/access.js";
import { requiredChecklist } from "./checklists.js";

/** The required checklist for a matter (for the UI to render). */
export async function getArchiveChecklist(deps: Deps, auth: AuthContext, rawInput: { matterId: string }) {
  const [m] = await deps.db
    .select({ category: matters.category, ownerId: matters.ownerId, status: matters.status })
    .from(matters)
    .where(eq(matters.id, rawInput.matterId))
    .limit(1);
  if (!m) throw new DomainError("NOT_FOUND", "案件不存在");
  assertMatterAccess(m, auth);
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

  const result = await deps.db.transaction(async (tx) => {
    const [m] = await tx
      .select({ category: matters.category, ownerId: matters.ownerId, status: matters.status })
      .from(matters)
      .where(eq(matters.id, input.matterId))
      .limit(1);
    if (!m) throw new DomainError("NOT_FOUND", "案件不存在");
    assertMatterAccess(m, auth);

    // Idempotent: an already-archived matter returns its existing record rather
    // than failing a retry.
    if (m.status === "ARCHIVED") {
      const [existing] = await tx
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
    }

    const required = requiredChecklist(m.category as MatterCategory);
    const missing = required.filter((item) => input.checklist[item] !== true);
    if (missing.length > 0 && !input.forceReason) {
      throw new DomainError(
        "VALIDATION",
        `归档材料缺 ${missing.length} 项必备项（${missing.join("、")}）。如确认强制归档，请填写强制归档理由。`,
      );
    }

    // Atomically claim the archive transition (race-safe single archive).
    const claimed = await tx
      .update(matters)
      .set({ status: "ARCHIVED" })
      .where(and(eq(matters.id, input.matterId), ne(matters.status, "ARCHIVED")))
      .returning({ id: matters.id });
    if (claimed.length === 0) {
      const [existing] = await tx
        .select()
        .from(archiveRecords)
        .where(eq(archiveRecords.matterId, input.matterId))
        .limit(1);
      return {
        matterId: input.matterId,
        archiveId: existing?.id ?? null,
        status: "ARCHIVED" as const,
        missingItems: [],
        forced: !!existing?.forceReason,
        alreadyArchived: true,
      };
    }

    const id = deps.ids.newId();
    await tx.insert(archiveRecords).values({
      id,
      matterId: input.matterId,
      summary: input.summary,
      checklistJson: JSON.stringify(input.checklist),
      missingItems: JSON.stringify(missing),
      forceReason: input.forceReason ?? null,
      archivedById: auth.userId,
      archivedAt: now,
    });

    return {
      matterId: input.matterId,
      archiveId: id,
      status: "ARCHIVED" as const,
      missingItems: missing,
      forced: missing.length > 0,
      alreadyArchived: false,
    };
  });

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
