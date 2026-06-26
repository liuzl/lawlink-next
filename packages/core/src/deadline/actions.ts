/** Deadline use cases (DOMAIN-SPEC §6.4, §9.1). */
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { deadlines, matterProcedures, matters } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps, type MatterCategory } from "../types.js";
import { requireRole } from "../permissions.js";
import { assertMatterAccess } from "../matter/access.js";
import { computeDeadlines, type DeadlineEvent } from "./rules.js";

type Tx = Parameters<Parameters<Deps["db"]["transaction"]>[0]>[0];

/** Load a procedure's matter (category + owner) and assert the caller may edit it. */
async function authorizedMatterOfProcedure(
  db: Deps["db"] | Tx,
  auth: AuthContext,
  procedureId: string,
): Promise<{ matterId: string; category: MatterCategory }> {
  const [proc] = await db
    .select({ matterId: matterProcedures.matterId })
    .from(matterProcedures)
    .where(eq(matterProcedures.id, procedureId))
    .limit(1);
  if (!proc) throw new DomainError("NOT_FOUND", "程序不存在");

  const [matter] = await db
    .select({ category: matters.category, ownerId: matters.ownerId })
    .from(matters)
    .where(eq(matters.id, proc.matterId))
    .limit(1);
  if (!matter) throw new DomainError("NOT_FOUND", "案件不存在");
  assertMatterAccess(matter, auth);
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

  return await deps.db.transaction(async (tx) => {
    const { matterId, category } = await authorizedMatterOfProcedure(tx, auth, input.procedureId);
    const computed = computeDeadlines(category, input.event as DeadlineEvent, input.eventDate);

    // Idempotent: drop any previous auto deadlines for this procedure+event.
    await tx
      .delete(deadlines)
      .where(
        and(
          eq(deadlines.procedureId, input.procedureId),
          eq(deadlines.autoComputed, true),
          eq(deadlines.sourceEvent, input.event),
        ),
      );

    if (computed.length > 0) {
      await tx.insert(deadlines).values(
        computed.map((d) => ({
          id: deps.ids.newId(),
          procedureId: input.procedureId,
          matterId,
          category: d.category,
          title: d.title,
          dueAt: d.dueAt,
          basis: d.basis,
          sourceEvent: input.event,
          autoComputed: true,
          completed: false,
          createdAt: now,
        })),
      );
    }

    return { procedureId: input.procedureId, event: input.event, created: computed.length, deadlines: computed };
  });
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
  return { id, title: input.title, dueAt: input.dueAt };
}

/** List a matter's deadlines (due-date ascending). Visibility enforced. */
export async function listMatterDeadlines(
  deps: Deps,
  auth: AuthContext,
  rawInput: { matterId: string },
) {
  const [matter] = await deps.db
    .select({ ownerId: matters.ownerId })
    .from(matters)
    .where(eq(matters.id, rawInput.matterId))
    .limit(1);
  if (!matter) throw new DomainError("NOT_FOUND", "案件不存在");
  assertMatterAccess(matter, auth);

  return await deps.db
    .select()
    .from(deadlines)
    .where(eq(deadlines.matterId, rawInput.matterId))
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
    .select({ ownerId: matters.ownerId })
    .from(matters)
    .where(eq(matters.id, dl.matterId))
    .limit(1);
  if (!matter) throw new DomainError("NOT_FOUND", "案件不存在");
  assertMatterAccess(matter, auth);

  await deps.db
    .update(deadlines)
    .set({ completed: true, completedAt: deps.clock.now() })
    .where(eq(deadlines.id, deadlineId));
  return { id: deadlineId, completed: true };
}
