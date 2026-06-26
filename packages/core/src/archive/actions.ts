/** Archive (归档) — completeness gating + read-only lock (DOMAIN-SPEC §6.6, §M9). */
import { z } from "zod";
import { eq } from "drizzle-orm";
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
  summary: z.string().min(1).max(5000),
  /** item name -> present? */
  checklist: z.record(z.string(), z.boolean()).default({}),
  /** Required when archiving despite missing required items (audited override). */
  forceReason: z.string().max(500).optional(),
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

  return await deps.db.transaction(async (tx) => {
    const [m] = await tx
      .select({ category: matters.category, ownerId: matters.ownerId, status: matters.status })
      .from(matters)
      .where(eq(matters.id, input.matterId))
      .limit(1);
    if (!m) throw new DomainError("NOT_FOUND", "案件不存在");
    assertMatterAccess(m, auth);
    if (m.status === "ARCHIVED") throw new DomainError("INVALID_STATE", "案件已归档");

    const required = requiredChecklist(m.category as MatterCategory);
    const missing = required.filter((item) => input.checklist[item] !== true);
    if (missing.length > 0 && !input.forceReason) {
      throw new DomainError(
        "VALIDATION",
        `归档材料缺 ${missing.length} 项必备项（${missing.join("、")}）。如确认强制归档，请填写强制归档理由。`,
      );
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
    await tx.update(matters).set({ status: "ARCHIVED" }).where(eq(matters.id, input.matterId));

    return {
      matterId: input.matterId,
      archiveId: id,
      status: "ARCHIVED" as const,
      missingItems: missing,
      forced: missing.length > 0,
    };
  });
}
