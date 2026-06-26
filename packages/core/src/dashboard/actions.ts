/**
 * Dashboard aggregation (工作台) — DOMAIN-SPEC §M1. Surfaces the proactive-alert
 * payoff: upcoming deadlines + expiring preservations across the caller's
 * visible matters, plus headline counts. Visibility per §2.2.
 */
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { deadlines, intakes, matterProcedures, matters, preservations } from "@lawlink/db";
import { type AuthContext, type Deps } from "../types.js";
import { isManagement } from "../permissions.js";
import { matterVisibilityCondition } from "../matter/access.js";

const HORIZON_DAYS = 30;

export async function getDashboard(deps: Deps, auth: AuthContext) {
  const now = deps.clock.now();
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 86400000);

  const empty = {
    counts: { activeMatters: 0, pendingIntakes: 0, upcomingDeadlines: 0, expiringPreservations: 0 },
    upcomingDeadlines: [] as unknown[],
    expiringPreservations: [] as unknown[],
    horizonDays: HORIZON_DAYS,
  };
  // Membership-aware matter visibility (management all / owned+member / none) —
  // the same scope as the matter list and schedule, so assigned members see their
  // matters' proactive deadline/preservation alerts here too.
  const matterVis = await matterVisibilityCondition(deps.db, auth);
  if (matterVis === null) return empty;

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

  // Deadlines: join procedures matter-scoped (procedure.matterId = deadline.matterId)
  // so a drifted row can't be judged by another matter's procedure engagement.
  const dlProcJoin = and(
    eq(deadlines.procedureId, matterProcedures.id),
    eq(matterProcedures.matterId, deadlines.matterId),
  );
  const dlWhere = and(
    eq(deadlines.completed, false),
    eq(matterProcedures.engagement, "ENGAGED"),
    lte(deadlines.dueAt, horizon),
    matterVis,
  );
  const [{ dlCount }] = await deps.db
    .select({ dlCount: sql<number>`count(*)` })
    .from(deadlines)
    .innerJoin(matterProcedures, dlProcJoin)
    .innerJoin(matters, eq(deadlines.matterId, matters.id))
    .where(dlWhere);
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
    .innerJoin(matterProcedures, dlProcJoin)
    .innerJoin(matters, eq(deadlines.matterId, matters.id))
    .where(dlWhere)
    .orderBy(asc(deadlines.dueAt))
    .limit(50);

  const presWhere = and(
    inArray(preservations.status, ["ACTIVE", "RENEWED"]),
    lte(preservations.expiryDate, horizon),
    matterVis,
  );
  const [{ presCount }] = await deps.db
    .select({ presCount: sql<number>`count(*)` })
    .from(preservations)
    .innerJoin(matters, eq(preservations.matterId, matters.id))
    .where(presWhere);
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
    .where(presWhere)
    .orderBy(asc(preservations.expiryDate))
    .limit(50);

  return {
    counts: {
      activeMatters: Number(activeMatters),
      pendingIntakes: Number(pendingIntakes),
      // Real totals (not capped by the 50-row preview lists).
      upcomingDeadlines: Number(dlCount),
      expiringPreservations: Number(presCount),
    },
    upcomingDeadlines,
    expiringPreservations,
    horizonDays: HORIZON_DAYS,
  };
}
