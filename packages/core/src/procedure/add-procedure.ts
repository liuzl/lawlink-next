/**
 * Use case: add a procedure to a matter (DOMAIN-SPEC §3, §4.2).
 *
 * - Authorization: management or the matter owner (DOMAIN-SPEC §2.2) — a role
 *   check alone is not enough (a LAWYER must not edit another lawyer's matter).
 * - Type must be allowed for the matter's category.
 * - Per-matter order is allocated from an ATOMIC counter (not SELECT-max+1),
 *   so concurrent adds get distinct orders without racing the unique constraint.
 */
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { counters, matterProcedures, matters } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps, type MatterCategory } from "../types.js";
import { requireRole } from "../permissions.js";
import { assertMatterAccess } from "../matter/access.js";
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
      .select({ category: matters.category, ownerId: matters.ownerId })
      .from(matters)
      .where(eq(matters.id, input.matterId))
      .limit(1);
    if (!matter) throw new DomainError("NOT_FOUND", "案件不存在");
    assertMatterAccess(matter, auth);

    const category = matter.category as MatterCategory;
    if (!isProcedureAllowed(category, input.type as never)) {
      throw new DomainError(
        "VALIDATION",
        `程序类型 ${input.type} 不适用于 ${category}（可选：${PROCEDURES_BY_CATEGORY[category].join("、")}）`,
      );
    }

    // Atomic per-matter order — no read-then-write race against unique(matterId, order).
    const [counter] = await tx
      .insert(counters)
      .values({ key: `proc-order-${input.matterId}`, value: 1 })
      .onConflictDoUpdate({ target: counters.key, set: { value: sql`${counters.value} + 1` } })
      .returning({ value: counters.value });
    const order = counter.value;

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
