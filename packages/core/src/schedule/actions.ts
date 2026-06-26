/**
 * 日程 — unified agenda of time-bound items across the caller's visible matters
 * (DOMAIN-SPEC §M-schedule): hearings, statutory deadlines, preservation expiries
 * and due tasks, merged and sorted. Visibility per §2.2 (management all, LAWYER
 * own, others none) — the same matter scope the dashboard uses.
 */
import { z } from "zod";
import { and, eq, getTableColumns, gte, inArray, lte } from "drizzle-orm";
import { deadlines, hearings, matterProcedures, matters, preservations, tasks } from "@lawlink/db";
import { type AuthContext, type Deps } from "../types.js";
import { matterVisibilityCondition } from "../matter/access.js";

export type ScheduleKind = "HEARING" | "DEADLINE" | "PRESERVATION" | "TASK";

export interface ScheduleItem {
  kind: ScheduleKind;
  id: string;
  title: string;
  at: string; // ISO instant the item is due / happens
  matterId: string | null;
  internalCode: string | null;
  matterTitle: string | null;
  meta?: Record<string, unknown>;
}

export const GetScheduleInput = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export async function getSchedule(deps: Deps, auth: AuthContext, rawInput?: unknown) {
  const input = GetScheduleInput.parse(rawInput ?? {});
  const now = deps.clock.now();
  // Default window: last 30 days … next 120 days. Cap the span at ~1 year.
  const from = input.from ?? new Date(now.getTime() - 30 * 86400000);
  let to = input.to ?? new Date(now.getTime() + 120 * 86400000);
  if (to.getTime() - from.getTime() > 400 * 86400000) {
    to = new Date(from.getTime() + 400 * 86400000);
  }

  // Membership-aware visibility (management all / owned+member / none) — the same
  // scope as the matter list and dashboard, so an assigned member sees the matter's
  // hearings/deadlines/preservations/tasks in their agenda.
  const matterVis = await matterVisibilityCondition(deps.db, auth);
  if (matterVis === null) return { from: from.toISOString(), to: to.toISOString(), items: [] as ScheduleItem[] };

  // Hearings (ENGAGED procedures only; matter-scoped join so a drifted row can't
  // borrow another matter's engagement).
  const hearingRows = await deps.db
    .select({
      ...getTableColumns(hearings),
      internalCode: matters.internalCode,
      matterTitle: matters.title,
    })
    .from(hearings)
    .innerJoin(
      matterProcedures,
      and(eq(hearings.procedureId, matterProcedures.id), eq(matterProcedures.matterId, hearings.matterId)),
    )
    .innerJoin(matters, eq(hearings.matterId, matters.id))
    .where(
      and(
        eq(matterProcedures.engagement, "ENGAGED"),
        gte(hearings.startsAt, from),
        lte(hearings.startsAt, to),
        matterVis,
      ),
    );

  const deadlineRows = await deps.db
    .select({
      id: deadlines.id,
      title: deadlines.title,
      category: deadlines.category,
      dueAt: deadlines.dueAt,
      matterId: deadlines.matterId,
      internalCode: matters.internalCode,
      matterTitle: matters.title,
    })
    .from(deadlines)
    .innerJoin(
      matterProcedures,
      and(eq(deadlines.procedureId, matterProcedures.id), eq(matterProcedures.matterId, deadlines.matterId)),
    )
    .innerJoin(matters, eq(deadlines.matterId, matters.id))
    .where(
      and(
        eq(deadlines.completed, false),
        eq(matterProcedures.engagement, "ENGAGED"),
        gte(deadlines.dueAt, from),
        lte(deadlines.dueAt, to),
        matterVis,
      ),
    );

  const presRows = await deps.db
    .select({
      id: preservations.id,
      propertyType: preservations.propertyType,
      respondent: preservations.respondent,
      status: preservations.status,
      expiryDate: preservations.expiryDate,
      matterId: preservations.matterId,
      internalCode: matters.internalCode,
      matterTitle: matters.title,
    })
    .from(preservations)
    .innerJoin(matters, eq(preservations.matterId, matters.id))
    .where(
      and(
        // Only LIVE preservations are agenda obligations — exclude LIFTED/EXPIRED
        // (matches the dashboard) so cancelled/lapsed rows aren't resurrected as
        // current deadlines. Status-leading also lets the (status,expiry) index apply.
        inArray(preservations.status, ["ACTIVE", "RENEWED"]),
        gte(preservations.expiryDate, from),
        lte(preservations.expiryDate, to),
        matterVis,
      ),
    );

  const taskRows = await deps.db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueAt: tasks.dueAt,
      matterId: tasks.matterId,
      internalCode: matters.internalCode,
      matterTitle: matters.title,
    })
    .from(tasks)
    .innerJoin(matters, eq(tasks.matterId, matters.id))
    .where(and(eq(tasks.completed, false), gte(tasks.dueAt, from), lte(tasks.dueAt, to), matterVis));

  const items: ScheduleItem[] = [
    ...hearingRows.map((h) => ({
      kind: "HEARING" as const,
      id: h.id,
      title: h.title,
      at: h.startsAt.toISOString(),
      matterId: h.matterId,
      internalCode: h.internalCode,
      matterTitle: h.matterTitle,
      meta: { room: h.room, judge: h.judge },
    })),
    ...deadlineRows.map((d) => ({
      kind: "DEADLINE" as const,
      id: d.id,
      title: d.title,
      at: d.dueAt.toISOString(),
      matterId: d.matterId,
      internalCode: d.internalCode,
      matterTitle: d.matterTitle,
      meta: { category: d.category },
    })),
    ...presRows.map((p) => ({
      kind: "PRESERVATION" as const,
      id: p.id,
      title: `保全到期（${p.propertyType}）`,
      at: p.expiryDate.toISOString(),
      matterId: p.matterId,
      internalCode: p.internalCode,
      matterTitle: p.matterTitle,
      meta: { status: p.status, respondent: p.respondent },
    })),
    ...taskRows.map((t) => ({
      kind: "TASK" as const,
      id: t.id,
      title: t.title,
      at: (t.dueAt as Date).toISOString(),
      matterId: t.matterId,
      internalCode: t.internalCode,
      matterTitle: t.matterTitle,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return { from: from.toISOString(), to: to.toISOString(), items };
}
