/**
 * 报表 — firm-wide analytics (management lens, DOMAIN-SPEC §M-reports).
 *
 * Read-only aggregation over matters / intakes / feeEntries / archiveRecords for
 * a period. ADMIN / PRINCIPAL_LAWYER only (firm-wide stats). Money is summed in
 * integer cents (TEXT amounts) and returned as decimal strings.
 */
import { z } from "zod";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { archiveRecords, feeEntries, intakes, matters, users } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps } from "../types.js";
import { requireRole } from "../permissions.js";
import { fromCents, toCents } from "../finance/money.js";
import { resolvePeriod, type ReportPreset } from "./period.js";

const ACTIVE_STATUSES = ["PENDING_ACCEPTANCE", "IN_PROGRESS", "ON_HOLD"] as const;

const DATE = z.string().regex(/^\d{4}-\d{1,2}-\d{1,2}$/, "日期格式应为 YYYY-MM-DD");
export const GetReportInput = z.object({
  preset: z.enum(["month", "quarter", "year", "lastYear"]).optional(),
  start: DATE.optional(),
  end: DATE.optional(),
});

export async function getReport(deps: Deps, auth: AuthContext, rawInput?: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER"); // firm-wide management lens
  const input = GetReportInput.parse(rawInput ?? {});
  let period;
  try {
    period = resolvePeriod(deps.clock.now(), input as { preset?: ReportPreset; start?: string; end?: string });
  } catch (err) {
    throw new DomainError("VALIDATION", err instanceof Error ? err.message : "无效的统计区间");
  }
  const { start, end } = period;
  const inPeriod = (col: SQLiteColumn) => and(gte(col, start), lt(col, end));

  // ── Portfolio (point-in-time) ────────────────────────────────────────────
  const [{ total }] = await deps.db.select({ total: sql<number>`count(*)` }).from(matters);
  const [{ active }] = await deps.db
    .select({ active: sql<number>`count(*)` })
    .from(matters)
    .where(inArray(matters.status, [...ACTIVE_STATUSES]));
  const [{ archived }] = await deps.db
    .select({ archived: sql<number>`count(*)` })
    .from(matters)
    .where(eq(matters.status, "ARCHIVED"));
  const byCategory = await deps.db
    .select({ category: matters.category, count: sql<number>`count(*)` })
    .from(matters)
    .groupBy(matters.category);
  const byStatus = await deps.db
    .select({ status: matters.status, count: sql<number>`count(*)` })
    .from(matters)
    .groupBy(matters.status);

  // ── Period activity ──────────────────────────────────────────────────────
  const [{ newMatters }] = await deps.db
    .select({ newMatters: sql<number>`count(*)` })
    .from(matters)
    .where(inPeriod(matters.createdAt));
  const [{ newIntakes }] = await deps.db
    .select({ newIntakes: sql<number>`count(*)` })
    .from(intakes)
    .where(inPeriod(intakes.createdAt));
  const [{ closedMatters }] = await deps.db
    .select({ closedMatters: sql<number>`count(*)` })
    .from(archiveRecords)
    .where(inPeriod(archiveRecords.archivedAt));

  // Finance for the period: sum TEXT amounts in cents, by type.
  const feeRows = await deps.db
    .select({ type: feeEntries.type, amount: feeEntries.amount })
    .from(feeEntries)
    .where(inPeriod(feeEntries.occurredAt));
  const cents = (type: string) =>
    feeRows.filter((f) => f.type === type).reduce((s, f) => s + toCents(f.amount), 0);
  const receivedCents = cents("RECEIVED");
  const refundCents = cents("REFUND");
  const finance = {
    receivable: fromCents(cents("RECEIVABLE")),
    received: fromCents(receivedCents),
    refund: fromCents(refundCents),
    cost: fromCents(cents("COST")),
    commission: fromCents(cents("COMMISSION")),
    netReceived: fromCents(receivedCents - refundCents),
  };

  // ── By lawyer ────────────────────────────────────────────────────────────
  const activeOwned = await deps.db
    .select({ ownerId: matters.ownerId, count: sql<number>`count(*)` })
    .from(matters)
    .where(inArray(matters.status, [...ACTIVE_STATUSES]))
    .groupBy(matters.ownerId);
  const receivedRows = await deps.db
    .select({ ownerId: matters.ownerId, amount: feeEntries.amount })
    .from(feeEntries)
    .innerJoin(matters, eq(feeEntries.matterId, matters.id))
    .where(and(eq(feeEntries.type, "RECEIVED"), inPeriod(feeEntries.occurredAt)));

  const ownedMap = new Map(activeOwned.map((r) => [r.ownerId, Number(r.count)]));
  const receivedMap = new Map<string, number>();
  for (const r of receivedRows) {
    receivedMap.set(r.ownerId, (receivedMap.get(r.ownerId) ?? 0) + toCents(r.amount));
  }
  const ownerIds = [...new Set([...ownedMap.keys(), ...receivedMap.keys()])];
  const nameRows = ownerIds.length
    ? await deps.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ownerIds))
    : [];
  const nameMap = new Map(nameRows.map((u) => [u.id, u.name]));
  const byLawyer = ownerIds
    .map((id) => ({
      userId: id,
      name: nameMap.get(id) ?? id.slice(0, 8),
      activeOwned: ownedMap.get(id) ?? 0,
      receivedInPeriod: fromCents(receivedMap.get(id) ?? 0),
    }))
    .sort((a, b) => toCents(b.receivedInPeriod) - toCents(a.receivedInPeriod));

  return {
    period: { start: start.toISOString(), end: end.toISOString(), label: period.label },
    portfolio: {
      total: Number(total),
      active: Number(active),
      archived: Number(archived),
      byCategory: byCategory.map((r) => ({ category: r.category, count: Number(r.count) })),
      byStatus: byStatus.map((r) => ({ status: r.status, count: Number(r.count) })),
    },
    activity: {
      newMatters: Number(newMatters),
      newIntakes: Number(newIntakes),
      closedMatters: Number(closedMatters),
      finance,
    },
    byLawyer,
  };
}
