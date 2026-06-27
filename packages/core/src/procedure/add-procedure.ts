/**
 * Use case: add a procedure to a matter (DOMAIN-SPEC §3, §4.2).
 *
 * - Authorization: management or the matter owner (DOMAIN-SPEC §2.2) — a role
 *   check alone is not enough (a LAWYER must not edit another lawyer's matter).
 * - Type must be allowed for the matter's category.
 * - Per-matter order is allocated INSIDE the guarded insert via a correlated
 *   `max("order")+1` subquery, with a retry loop on unique-constraint collisions —
 *   atomic and gap-free without a separate counter row (D1 has no interactive tx).
 */
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { matterProcedures, matters } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps, type MatterCategory } from "../types.js";
import { requireRole } from "../permissions.js";
import { assertMatterAccess, matterWriteAccessExists } from "../matter/access.js";
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

  // Preconditions (read-only): matter exists, caller can access it, it's not
  // archived, and the type is allowed for its category. These don't need to be in
  // the same atomic unit as the write — they gate it.
  const [matter] = await deps.db
    .select({ id: matters.id, category: matters.category, ownerId: matters.ownerId, status: matters.status })
    .from(matters)
    .where(eq(matters.id, input.matterId))
    .limit(1);
  if (!matter) throw new DomainError("NOT_FOUND", "案件不存在");
  await assertMatterAccess(deps.db, matter, auth);
  if (matter.status === "ARCHIVED") throw new DomainError("INVALID_STATE", "案件已归档，只读，不能新增程序");

  const category = matter.category as MatterCategory;
  if (!isProcedureAllowed(category, input.type as never)) {
    throw new DomainError(
      "VALIDATION",
      `程序类型 ${input.type} 不适用于 ${category}（可选：${PROCEDURES_BY_CATEGORY[category].join("、")}）`,
    );
  }

  // Single atomic write that does everything the interactive transaction did:
  //  - allocates "order" inline via a correlated `coalesce(max("order"),0)+1`
  //    subquery (no separate counter row to leave gaps in);
  //  - re-checks authorization AND archived status at WRITE time via
  //    `WHERE matterWriteAccessExists(...)` — if the matter was archived OR the
  //    caller lost owner/member access (a concurrent setMatterTeam) since the
  //    preflight above, it inserts 0 rows and we reject.
  // Two concurrent adds can compute the same max+1; one wins, the other trips
  // unique(matterId, order) and RETRIES (the failed insert is atomic — it wrote
  // nothing), recomputing a fresh max+1. created_at is epoch seconds, matching
  // drizzle's integer timestamp. Works identically on libSQL and D1.
  const id = deps.ids.newId();
  const createdSec = Math.floor(now.getTime() / 1000);
  const MAX_ATTEMPTS = 5;
  let inserted: Array<{ order: number }> = [];
  for (let attempt = 1; ; attempt++) {
    try {
      inserted = (await deps.db.all(sql`
        insert into ${matterProcedures}
          ("id", "matter_id", "type", "engagement", "order", "case_number", "handling_agency", "handler", "status", "created_at")
        select ${id}, ${input.matterId}, ${input.type}, ${input.engagement},
          (select coalesce(max("order"), 0) + 1 from "MatterProcedure" where "matter_id" = ${input.matterId}),
          ${input.caseNumber ?? null}, ${input.handlingAgency ?? null}, ${input.handler ?? null}, 'PENDING', ${createdSec}
        where ${matterWriteAccessExists(auth, input.matterId)}
        returning "order"
      `)) as Array<{ order: number }>;
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/UNIQUE/i.test(msg) && attempt < MAX_ATTEMPTS) continue;
      throw err;
    }
  }
  if (inserted.length === 0) throw new DomainError("INVALID_STATE", "案件已归档或无写入权限，不能新增程序");
  const order = inserted[0].order;

  const result = { id, matterId: input.matterId, type: input.type, engagement: input.engagement, order };

  await deps.audit.record(auth, {
    action: "PROCEDURE_CREATE",
    targetType: "Procedure",
    targetId: result.id,
    detail: { matterId: result.matterId, type: result.type, engagement: result.engagement, order: result.order },
  });
  return result;
}
