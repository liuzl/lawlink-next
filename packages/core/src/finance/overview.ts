/**
 * Firm-wide finance overview (财务台账) — DOMAIN-SPEC §M-finance.
 *
 * The finance lens: a firm-level roll-up + recent ledger across ALL matters, for
 * management and the FINANCE role (§2.2 — FINANCE sees every matter's finance).
 * Bounded to a window (default 6 months, capped) so the scan stays indexed
 * (FeeEntry_occurred_idx) and never materialises the whole table.
 */
import { z } from "zod";
import { and, desc, eq, gte } from "drizzle-orm";
import { feeEntries, matters } from "@lawlink/db";
import { type AuthContext, type Deps } from "../types.js";
import { requireRole } from "../permissions.js";
import { fromCents, toCents } from "./money.js";

export const FinanceOverviewInput = z.object({
  months: z.coerce.number().int().min(1).max(36).catch(6),
});

export async function getFinanceOverview(deps: Deps, auth: AuthContext, rawInput?: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "FINANCE"); // firm finance lens (§2.2)
  const { months } = FinanceOverviewInput.parse(rawInput ?? {});
  const now = deps.clock.now();
  // First day of the month (months-1) back → an inclusive N-month window.
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);

  // One indexed window scan feeds the summary + the monthly buckets.
  const rows = await deps.db
    .select({ type: feeEntries.type, amount: feeEntries.amount, occurredAt: feeEntries.occurredAt })
    .from(feeEntries)
    .where(gte(feeEntries.occurredAt, start));

  const cents = (type: string) =>
    rows.filter((r) => r.type === type).reduce((s, r) => s + toCents(r.amount), 0);
  const receivedCents = cents("RECEIVED");
  const refundCents = cents("REFUND");
  const summary = {
    receivable: fromCents(cents("RECEIVABLE")),
    received: fromCents(receivedCents),
    refund: fromCents(refundCents),
    cost: fromCents(cents("COST")),
    commission: fromCents(cents("COMMISSION")),
    netReceived: fromCents(receivedCents - refundCents),
  };

  // Monthly net receipts (received − refund) bucketed by YYYY-MM.
  const buckets = new Map<string, number>();
  for (let i = 0; i < months; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    buckets.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, 0);
  }
  for (const r of rows) {
    if (r.type !== "RECEIVED" && r.type !== "REFUND") continue;
    const d = r.occurredAt;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!buckets.has(key)) continue; // outside the labelled window (safety)
    buckets.set(key, buckets.get(key)! + (r.type === "RECEIVED" ? toCents(r.amount) : -toCents(r.amount)));
  }
  const monthly = [...buckets.entries()].map(([month, c]) => ({ month, netReceived: fromCents(c) }));

  // Recent ledger (firm-wide, with matter context) — its own bounded query.
  const ledger = await deps.db
    .select({
      id: feeEntries.id,
      type: feeEntries.type,
      amount: feeEntries.amount,
      occurredAt: feeEntries.occurredAt,
      payerOrPayee: feeEntries.payerOrPayee,
      matterId: feeEntries.matterId,
      internalCode: matters.internalCode,
      matterTitle: matters.title,
    })
    .from(feeEntries)
    .innerJoin(matters, eq(feeEntries.matterId, matters.id))
    .where(and(gte(feeEntries.occurredAt, start)))
    .orderBy(desc(feeEntries.occurredAt))
    .limit(100);

  return {
    months,
    since: start.toISOString(),
    summary,
    monthly,
    ledger: ledger.map((e) => ({ ...e, occurredAt: e.occurredAt.toISOString() })),
  };
}
