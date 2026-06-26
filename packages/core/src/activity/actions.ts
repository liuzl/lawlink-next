/** Matter activity: tasks / notes / hearings (DOMAIN-SPEC §4.8, §4.9). */
import { z } from "zod";
import { and, asc, desc, eq, getTableColumns } from "drizzle-orm";
import { hearings, matterProcedures, matters, notes, tasks } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps } from "../types.js";
import { requireRole } from "../permissions.js";
import { assertMatterAccess } from "../matter/access.js";

async function assertMatterEditable(db: Deps["db"], auth: AuthContext, matterId: string) {
  const [m] = await db
    .select({ ownerId: matters.ownerId })
    .from(matters)
    .where(eq(matters.id, matterId))
    .limit(1);
  if (!m) throw new DomainError("NOT_FOUND", "案件不存在");
  assertMatterAccess(m, auth);
}

/** Resolve an ENGAGED procedure's matter and assert edit access (§3.2). */
async function engagedProcedureMatter(db: Deps["db"], auth: AuthContext, procedureId: string) {
  const [p] = await db
    .select({ matterId: matterProcedures.matterId, engagement: matterProcedures.engagement })
    .from(matterProcedures)
    .where(eq(matterProcedures.id, procedureId))
    .limit(1);
  if (!p) throw new DomainError("NOT_FOUND", "程序不存在");
  if (p.engagement === "INFORMATIONAL") {
    throw new DomainError("VALIDATION", "前序参考程序不进入日程聚合，不能添加开庭");
  }
  await assertMatterEditable(db, auth, p.matterId);
  return p.matterId;
}

// ── tasks ───────────────────────────────────────────────────────────────────
export const AddTaskInput = z.object({
  matterId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  assigneeId: z.string().min(1).optional(),
  dueAt: z.coerce.date().optional(),
});

export async function addTask(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER", "ASSISTANT");
  const input = AddTaskInput.parse(rawInput);
  await assertMatterEditable(deps.db, auth, input.matterId);
  const id = deps.ids.newId();
  await deps.db.insert(tasks).values({
    id,
    matterId: input.matterId,
    title: input.title,
    description: input.description ?? null,
    assigneeId: input.assigneeId ?? null,
    dueAt: input.dueAt ?? null,
    completed: false,
    createdById: auth.userId,
    createdAt: deps.clock.now(),
  });
  return { id, title: input.title };
}

export async function listMatterTasks(deps: Deps, auth: AuthContext, rawInput: { matterId: string }) {
  await assertMatterEditable(deps.db, auth, rawInput.matterId);
  return await deps.db
    .select()
    .from(tasks)
    .where(eq(tasks.matterId, rawInput.matterId))
    .orderBy(asc(tasks.completed), asc(tasks.dueAt));
}

export const CompleteTaskInput = z.object({ taskId: z.string().min(1) });

export async function completeTask(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER", "ASSISTANT");
  const { taskId } = CompleteTaskInput.parse(rawInput);
  const [t] = await deps.db.select({ matterId: tasks.matterId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!t) throw new DomainError("NOT_FOUND", "任务不存在");
  await assertMatterEditable(deps.db, auth, t.matterId);
  await deps.db.update(tasks).set({ completed: true, completedAt: deps.clock.now() }).where(eq(tasks.id, taskId));
  return { id: taskId, completed: true };
}

// ── notes ───────────────────────────────────────────────────────────────────
export const AddNoteInput = z.object({
  matterId: z.string().min(1),
  channel: z.enum(["PHONE", "WECHAT", "EMAIL", "MEETING", "COURT", "OTHER"]).default("OTHER"),
  withWhom: z.string().max(120).optional(),
  occurredAt: z.coerce.date().optional(),
  content: z.string().min(1).max(5000),
});

export async function addNote(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER", "ASSISTANT");
  const input = AddNoteInput.parse(rawInput);
  await assertMatterEditable(deps.db, auth, input.matterId);
  const now = deps.clock.now();
  const id = deps.ids.newId();
  await deps.db.insert(notes).values({
    id,
    matterId: input.matterId,
    authorId: auth.userId,
    channel: input.channel,
    withWhom: input.withWhom ?? null,
    occurredAt: input.occurredAt ?? now,
    content: input.content,
    createdAt: now,
  });
  return { id };
}

export async function listMatterNotes(deps: Deps, auth: AuthContext, rawInput: { matterId: string }) {
  await assertMatterEditable(deps.db, auth, rawInput.matterId);
  return await deps.db
    .select()
    .from(notes)
    .where(eq(notes.matterId, rawInput.matterId))
    .orderBy(desc(notes.occurredAt));
}

// ── hearings ──────────────────────────────────────────────────────────────────
export const AddHearingInput = z.object({
  procedureId: z.string().min(1),
  title: z.string().min(1).max(200),
  startsAt: z.coerce.date(),
  room: z.string().max(120).optional(),
  judge: z.string().max(120).optional(),
});

export async function addHearing(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER", "ASSISTANT");
  const input = AddHearingInput.parse(rawInput);
  const matterId = await engagedProcedureMatter(deps.db, auth, input.procedureId);
  const id = deps.ids.newId();
  await deps.db.insert(hearings).values({
    id,
    procedureId: input.procedureId,
    matterId,
    title: input.title,
    room: input.room ?? null,
    address: null,
    judge: input.judge ?? null,
    startsAt: input.startsAt,
    endsAt: null,
    notes: null,
    createdAt: deps.clock.now(),
  });
  return { id, startsAt: input.startsAt };
}

export async function listMatterHearings(deps: Deps, auth: AuthContext, rawInput: { matterId: string }) {
  await assertMatterEditable(deps.db, auth, rawInput.matterId);
  // ENGAGED procedures only (§3.2). Bind the join on BOTH ids so a drifted row
  // (hearing.matterId = A, procedure from matter B) can't leak across matters.
  return await deps.db
    .select(getTableColumns(hearings))
    .from(hearings)
    .innerJoin(
      matterProcedures,
      and(
        eq(hearings.procedureId, matterProcedures.id),
        eq(matterProcedures.matterId, hearings.matterId),
      ),
    )
    .where(and(eq(hearings.matterId, rawInput.matterId), eq(matterProcedures.engagement, "ENGAGED")))
    .orderBy(asc(hearings.startsAt));
}
