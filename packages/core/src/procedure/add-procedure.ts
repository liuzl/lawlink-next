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
import { eq, max, sql } from "drizzle-orm";
import { counters, matterProcedures, matters } from "@lawlink/db";
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

  // Atomic per-matter order from a counter. The counter SELF-INITIALIZES from the
  // current MAX(order), so matters created before this counter existed don't
  // collide with unique(matterId, order); concurrent callers hit the conflict
  // path and atomically +1. The upsert is a single atomic statement that RETURNS
  // the order — no interactive transaction needed (works on libSQL AND D1). A
  // failed insert below would only leave an unused counter value (a harmless gap,
  // same as case-number allocation).
  const [{ maxOrder }] = await deps.db
    .select({ maxOrder: max(matterProcedures.order) })
    .from(matterProcedures)
    .where(eq(matterProcedures.matterId, input.matterId));
  const seed = (maxOrder ?? 0) + 1;

  const [counter] = await deps.db
    .insert(counters)
    .values({ key: `proc-order-${input.matterId}`, value: seed })
    .onConflictDoUpdate({ target: counters.key, set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value });
  const order = counter.value;

  // Write-time guard (replaces the interactive transaction's in-tx re-read): a
  // correlated INSERT … SELECT … WHERE matterWriteAccessExists(...). If the matter
  // was archived OR the caller lost owner/member access (a concurrent
  // setMatterTeam) between the preflight above and here, this inserts 0 rows and
  // we reject — re-checking authorization AND archived status atomically at write
  // time. created_at is epoch seconds, matching drizzle's integer timestamp.
  const id = deps.ids.newId();
  const createdSec = Math.floor(now.getTime() / 1000);
  const inserted = (await deps.db.all(sql`
    insert into ${matterProcedures}
      ("id", "matter_id", "type", "engagement", "order", "case_number", "handling_agency", "handler", "status", "created_at")
    select ${id}, ${input.matterId}, ${input.type}, ${input.engagement}, ${order},
      ${input.caseNumber ?? null}, ${input.handlingAgency ?? null}, ${input.handler ?? null}, 'PENDING', ${createdSec}
    where ${matterWriteAccessExists(auth, input.matterId)}
    returning "id"
  `)) as unknown[];
  if (inserted.length === 0) throw new DomainError("INVALID_STATE", "案件已归档或无写入权限，不能新增程序");

  const result = { id, matterId: input.matterId, type: input.type, engagement: input.engagement, order };

  await deps.audit.record(auth, {
    action: "PROCEDURE_CREATE",
    targetType: "Procedure",
    targetId: result.id,
    detail: { matterId: result.matterId, type: result.type, engagement: result.engagement, order: result.order },
  });
  return result;
}
