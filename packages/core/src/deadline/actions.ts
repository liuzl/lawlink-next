/** Deadline use cases (DOMAIN-SPEC §6.4, §9.1). */
import { z } from "zod";
import { and, asc, eq, getTableColumns, notInArray, sql } from "drizzle-orm";
import { deadlines, matterProcedures, matters } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps, type MatterCategory } from "../types.js";
import { requireRole } from "../permissions.js";
import { assertMatterAccess, matterWriteAccessExists } from "../matter/access.js";
import { computeDeadlines, type DeadlineEvent } from "./rules.js";

type Tx = Parameters<Parameters<Deps["db"]["transaction"]>[0]>[0];

/** Load a procedure's matter (category + owner), assert the caller may edit it,
 * and reject INFORMATIONAL procedures (metadata-only, never in aggregates §3.2). */
async function authorizedMatterOfProcedure(
  db: Deps["db"] | Tx,
  auth: AuthContext,
  procedureId: string,
): Promise<{ matterId: string; category: MatterCategory }> {
  const [proc] = await db
    .select({ matterId: matterProcedures.matterId, engagement: matterProcedures.engagement })
    .from(matterProcedures)
    .where(eq(matterProcedures.id, procedureId))
    .limit(1);
  if (!proc) throw new DomainError("NOT_FOUND", "程序不存在");
  if (proc.engagement === "INFORMATIONAL") {
    throw new DomainError("VALIDATION", "前序参考程序仅作元数据，不进入期限聚合，不能添加/推算期限");
  }

  const [matter] = await db
    .select({ id: matters.id, category: matters.category, ownerId: matters.ownerId, status: matters.status })
    .from(matters)
    .where(eq(matters.id, proc.matterId))
    .limit(1);
  if (!matter) throw new DomainError("NOT_FOUND", "案件不存在");
  await assertMatterAccess(db as Deps["db"], matter, auth);
  if (matter.status === "ARCHIVED") throw new DomainError("INVALID_STATE", "案件已归档，只读，不能修改期限");
  return { matterId: proc.matterId, category: matter.category as MatterCategory };
}

const EVENTS = [
  "JUDGMENT_SERVED",
  "RULING_SERVED",
  "COMPLAINT_SERVED",
  "JUDGMENT_EFFECTIVE",
  "PERFORMANCE_DUE",
  "ARBITRATION_AWARD_RECEIVED",
] as const;

export const ApplyDeadlineRulesInput = z.object({
  procedureId: z.string().min(1),
  event: z.enum(EVENTS),
  eventDate: z.coerce.date(),
});

/** Compute statutory deadlines from an event and persist them on the procedure.
 * Re-running for the same (procedure, event) replaces the prior auto set. */
export async function applyDeadlineRules(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER");
  const input = ApplyDeadlineRulesInput.parse(rawInput);
  const now = deps.clock.now();

  // Preflight (gate): procedure exists + ENGAGED, matter accessible + not
  // archived. Reads don't need to share the atomic unit with the writes.
  const { matterId, category } = await authorizedMatterOfProcedure(deps.db, auth, input.procedureId);
  const computed = computeDeadlines(category, input.event as DeadlineEvent, input.eventDate);

  // Idempotent UPSERT by natural key (procedure, event, category) + prune, all in
  // ONE batch() — a single transaction on libSQL AND D1 (D1 has no interactive
  // transactions). There is no unique index on the natural key, so each upsert is
  // an UPDATE-in-place (preserves id + completed/completedAt — never wipes a
  // lawyer's "已完成" mark) followed by an INSERT-if-absent. Every write carries
  // matterWriteAccessExists so an archive/access-loss landing after the preflight
  // (TOCTOU) no-ops the whole set; the claim (statement 0) returns the matter row
  // iff still writable so we reject accurately instead of reporting a silent
  // no-op as success. epoch seconds throughout.
  const createdSec = Math.floor(now.getTime() / 1000);
  const matterGuard = matterWriteAccessExists(auth, matterId);

  const claim = deps.db.select({ id: matters.id }).from(matters).where(and(eq(matters.id, matterId), matterGuard));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stmts: any[] = [claim];
  for (const d of computed) {
    const keyMatch = and(
      eq(deadlines.procedureId, input.procedureId),
      eq(deadlines.autoComputed, true),
      eq(deadlines.sourceEvent, input.event),
      eq(deadlines.category, d.category),
    );
    stmts.push(
      deps.db.update(deadlines).set({ title: d.title, dueAt: d.dueAt, basis: d.basis }).where(and(keyMatch, matterGuard)),
    );
    const dueAtSec = Math.floor(d.dueAt.getTime() / 1000);
    stmts.push(
      deps.db.insert(deadlines).select(sql`
        select ${deps.ids.newId()}, ${input.procedureId}, ${matterId}, ${d.category}, ${d.title}, ${dueAtSec}, ${d.basis ?? null}, ${input.event}, 1, 0, null, ${createdSec}
        where not exists (select 1 from "Deadline" where "procedure_id" = ${input.procedureId} and "auto_computed" = 1 and "source_event" = ${input.event} and "category" = ${d.category})
          and ${matterGuard}
      `),
    );
  }
  // Prune obsolete auto deadlines: categories no longer produced by the rules
  // (e.g. a corrected JUDGMENT_EFFECTIVE that no longer emits ENFORCEMENT).
  const keep = computed.map((d) => d.category);
  stmts.push(
    deps.db.delete(deadlines).where(
      and(
        eq(deadlines.procedureId, input.procedureId),
        eq(deadlines.autoComputed, true),
        eq(deadlines.sourceEvent, input.event),
        keep.length > 0 ? notInArray(deadlines.category, keep) : undefined,
        matterGuard,
      ),
    ),
  );

  const results = await deps.db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
  if ((results[0] as unknown[]).length === 0) {
    throw new DomainError("INVALID_STATE", "案件已归档或无写入权限，不能推算期限");
  }

  const result = { procedureId: input.procedureId, matterId, event: input.event, created: computed.length, deadlines: computed };

  await deps.audit.record(auth, {
    action: "DEADLINE_RULES_APPLY",
    targetType: "Procedure",
    targetId: result.procedureId,
    detail: {
      matterId: result.matterId,
      event: result.event,
      eventDate: input.eventDate.toISOString(),
      created: result.created,
    },
  });
  return result;
}

export const AddDeadlineInput = z.object({
  procedureId: z.string().min(1),
  title: z.string().min(1).max(200),
  dueAt: z.coerce.date(),
  category: z.string().max(40).default("CUSTOM"),
  basis: z.string().max(300).optional(),
});

/** Add a manual deadline to a procedure. */
export async function addDeadline(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER");
  const input = AddDeadlineInput.parse(rawInput);
  const { matterId } = await authorizedMatterOfProcedure(deps.db, auth, input.procedureId);

  const id = deps.ids.newId();
  await deps.db.insert(deadlines).values({
    id,
    procedureId: input.procedureId,
    matterId,
    category: input.category,
    title: input.title,
    dueAt: input.dueAt,
    basis: input.basis ?? null,
    sourceEvent: null,
    autoComputed: false,
    completed: false,
    createdAt: deps.clock.now(),
  });
  await deps.audit.record(auth, {
    action: "DEADLINE_CREATE",
    targetType: "Deadline",
    targetId: id,
    detail: { matterId, procedureId: input.procedureId, category: input.category, dueAt: input.dueAt.toISOString() },
  });
  return { id, title: input.title, dueAt: input.dueAt };
}

/** List a matter's deadlines (due-date ascending). Visibility enforced. */
export async function listMatterDeadlines(
  deps: Deps,
  auth: AuthContext,
  rawInput: { matterId: string },
) {
  const [matter] = await deps.db
    .select({ id: matters.id, ownerId: matters.ownerId })
    .from(matters)
    .where(eq(matters.id, rawInput.matterId))
    .limit(1);
  if (!matter) throw new DomainError("NOT_FOUND", "案件不存在");
  await assertMatterAccess(deps.db, matter, auth);

  // Only ENGAGED procedures' deadlines enter aggregates (DOMAIN-SPEC §3.2).
  return await deps.db
    .select(getTableColumns(deadlines))
    .from(deadlines)
    .innerJoin(matterProcedures, eq(deadlines.procedureId, matterProcedures.id))
    .where(
      and(eq(deadlines.matterId, rawInput.matterId), eq(matterProcedures.engagement, "ENGAGED")),
    )
    .orderBy(asc(deadlines.dueAt));
}

export const CompleteDeadlineInput = z.object({ deadlineId: z.string().min(1) });

/** Mark a deadline complete. */
export async function completeDeadline(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER");
  const { deadlineId } = CompleteDeadlineInput.parse(rawInput);

  const [dl] = await deps.db
    .select({ matterId: deadlines.matterId })
    .from(deadlines)
    .where(eq(deadlines.id, deadlineId))
    .limit(1);
  if (!dl) throw new DomainError("NOT_FOUND", "期限不存在");

  const [matter] = await deps.db
    .select({ id: matters.id, ownerId: matters.ownerId, status: matters.status })
    .from(matters)
    .where(eq(matters.id, dl.matterId))
    .limit(1);
  if (!matter) throw new DomainError("NOT_FOUND", "案件不存在");
  await assertMatterAccess(deps.db, matter, auth);
  if (matter.status === "ARCHIVED") throw new DomainError("INVALID_STATE", "案件已归档，只读");

  await deps.db
    .update(deadlines)
    .set({ completed: true, completedAt: deps.clock.now() })
    .where(eq(deadlines.id, deadlineId));
  await deps.audit.record(auth, {
    action: "DEADLINE_COMPLETE",
    targetType: "Deadline",
    targetId: deadlineId,
    detail: { matterId: dl.matterId },
  });
  return { id: deadlineId, completed: true };
}
