/**
 * Dashboard aggregation (工作台) — DOMAIN-SPEC §M1. Surfaces the proactive-alert
 * payoff: upcoming deadlines + expiring preservations across the caller's
 * visible matters, plus headline counts. Visibility per §2.2.
 */
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { deadlines, intakes, matterProcedures, matters, preservations } from "@lawlink/db";
import { type AuthContext, type Deps } from "../types.js";
import { isManagement } from "../permissions.js";

const HORIZON_DAYS = 30;

export async function getDashboard(deps: Deps, auth: AuthContext) {
  const now = deps.clock.now();
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 86400000);

  // Matter visibility: management = all; LAWYER = own; others = none.
  const canSeeAny = isManagement(auth) || auth.role === "LAWYER";
  const matterVis = isManagement(auth) ? undefined : eq(matters.ownerId, auth.userId);

  const empty = {
    counts: { activeMatters: 0, pendingIntakes: 0, upcomingDeadlines: 0, expiringPreservations: 0 },
    upcomingDeadlines: [] as unknown[],
    expiringPreservations: [] as unknown[],
    horizonDays: HORIZON_DAYS,
  };
  if (!canSeeAny) return empty;

  const [{ activeMatters }] = await deps.db
    .select({ activeMatters: sql<number>`count(*)` })
    .from(matters)
    .where(and(inArray(matters.status, ["PENDING_ACCEPTANCE", "IN_PROGRESS", "ON_HOLD"]), matterVis));

  // Pending intakes: management sees all; others see their own submissions.
  const intakeScope = isManagement(auth) ? undefined : eq(intakes.createdById, auth.userId);
  const [{ pendingIntakes }] = await deps.db
    .select({ pendingIntakes: sql<number>`count(*)` })
    .from(intakes)
    .where(and(inArray(intakes.status, ["INTAKE", "PENDING_CONFIRMATION"]), intakeScope));

  const upcomingDeadlines = await deps.db
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
    .innerJoin(matterProcedures, eq(deadlines.procedureId, matterProcedures.id))
    .innerJoin(matters, eq(deadlines.matterId, matters.id))
    .where(
      and(
        eq(deadlines.completed, false),
        eq(matterProcedures.engagement, "ENGAGED"),
        lte(deadlines.dueAt, horizon),
        matterVis,
      ),
    )
    .orderBy(asc(deadlines.dueAt))
    .limit(50);

  const expiringPreservations = await deps.db
    .select({
      id: preservations.id,
      type: preservations.type,
      propertyType: preservations.propertyType,
      respondent: preservations.respondent,
      expiryDate: preservations.expiryDate,
      status: preservations.status,
      matterId: preservations.matterId,
      internalCode: matters.internalCode,
      matterTitle: matters.title,
    })
    .from(preservations)
    .innerJoin(matters, eq(preservations.matterId, matters.id))
    .where(
      and(
        inArray(preservations.status, ["ACTIVE", "RENEWED"]),
        lte(preservations.expiryDate, horizon),
        matterVis,
      ),
    )
    .orderBy(asc(preservations.expiryDate))
    .limit(50);

  return {
    counts: {
      activeMatters: Number(activeMatters),
      pendingIntakes: Number(pendingIntakes),
      upcomingDeadlines: upcomingDeadlines.length,
      expiringPreservations: expiringPreservations.length,
    },
    upcomingDeadlines,
    expiringPreservations,
    horizonDays: HORIZON_DAYS,
  };
}
