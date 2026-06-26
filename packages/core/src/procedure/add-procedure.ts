/**
 * Use case: add a procedure to a matter (DOMAIN-SPEC §3, §4.2).
 *
 * Validates the procedure type is allowed for the matter's category, and
 * allocates the next per-matter order atomically within a transaction.
 */
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { matterProcedures, matters } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps, type MatterCategory } from "../types.js";
import { requireRole } from "../permissions.js";
import { PROCEDURES_BY_CATEGORY, isProcedureAllowed } from "./types.js";

export const AddProcedureInput = z.object({
  matterId: z.string().min(1),
  type: z.string().min(1),
  engagement: z.enum(["ENGAGED", "INFORMATIONAL"]).default("ENGAGED"),
  caseNumber: z.string().max(120).optional(),
  handlingAgency: z.string().max(120).optional(),
  handler: z.string().max(120).optional(),
});

export async function addProcedure(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER");
  const input = AddProcedureInput.parse(rawInput);
  const now = deps.clock.now();

  return await deps.db.transaction(async (tx) => {
    const [matter] = await tx
      .select({ category: matters.category })
      .from(matters)
      .where(eq(matters.id, input.matterId))
      .limit(1);
    if (!matter) throw new DomainError("NOT_FOUND", "案件不存在");

    const category = matter.category as MatterCategory;
    if (!isProcedureAllowed(category, input.type as never)) {
      throw new DomainError(
        "VALIDATION",
        `程序类型 ${input.type} 不适用于 ${category}（可选：${PROCEDURES_BY_CATEGORY[category].join("、")}）`,
      );
    }

    const [last] = await tx
      .select({ order: matterProcedures.order })
      .from(matterProcedures)
      .where(eq(matterProcedures.matterId, input.matterId))
      .orderBy(desc(matterProcedures.order))
      .limit(1);
    const order = (last?.order ?? 0) + 1;

    const id = deps.ids.newId();
    await tx.insert(matterProcedures).values({
      id,
      matterId: input.matterId,
      type: input.type,
      engagement: input.engagement,
      order,
      caseNumber: input.caseNumber ?? null,
      handlingAgency: input.handlingAgency ?? null,
      handler: input.handler ?? null,
      status: "PENDING",
      createdAt: now,
    });

    return { id, matterId: input.matterId, type: input.type, engagement: input.engagement, order };
  });
}
