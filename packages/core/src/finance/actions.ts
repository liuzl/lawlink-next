/** Finance: billings, fee entries, commission auto-calc (DOMAIN-SPEC §4.11, §6.3). */
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { commissionPlans, feeEntries, matters } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps } from "../types.js";
import { isManagement, requireRole } from "../permissions.js";
import { assertMatterAccess } from "../matter/access.js";
import { fromCents, percentOfCents, toCents } from "./money.js";

const AMOUNT = z.string().regex(/^\d+(\.\d{1,2})?$/, "金额格式应为最多两位小数");

/**
 * Finance access (DOMAIN-SPEC §2.2): FINANCE is a firm-wide finance role and
 * intentionally sees/edits every matter's financial fields (not the case body);
 * management likewise. A LAWYER is scoped to matters they own. ASSISTANT: none.
 */
async function assertFinanceAccess(db: Deps["db"], auth: AuthContext, matterId: string) {
  const [m] = await db.select({ ownerId: matters.ownerId }).from(matters).where(eq(matters.id, matterId)).limit(1);
  if (!m) throw new DomainError("NOT_FOUND", "案件不存在");
  if (isManagement(auth) || auth.role === "FINANCE") return; // firm-wide finance (§2.2)
  if (auth.role === "LAWYER" && m.ownerId === auth.userId) return;
  throw new DomainError("NOT_FOUND", "案件不存在");
}

// ── commission plan ───────────────────────────────────────────────────────────
export const SetCommissionPlanInput = z.object({
  matterId: z.string().min(1),
  plans: z
    .array(
      z.object({
        userId: z.string().min(1),
        percent: z.coerce.number().min(0).max(100),
        label: z.string().max(60).optional(),
      }),
    )
    .max(20),
});

/** Replace the matter's commission plan. Lead/management only (not FINANCE). */
export async function setCommissionPlan(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER");
  const input = SetCommissionPlanInput.parse(rawInput);
  const [m] = await deps.db.select({ id: matters.id, ownerId: matters.ownerId }).from(matters).where(eq(matters.id, input.matterId)).limit(1);
  if (!m) throw new DomainError("NOT_FOUND", "案件不存在");
  await assertMatterAccess(deps.db, m, auth); // management or owner (lead)

  // Quantize to 2 decimals FIRST, then validate the sum in the same
  // representation that is persisted (so stored percents can't drift past 100%).
  const quantized = input.plans.map((p) => ({ ...p, percent: Math.round(p.percent * 100) / 100 }));
  const sum = quantized.reduce((s, p) => s + p.percent, 0);
  if (sum > 100) throw new DomainError("VALIDATION", `分成比例之和 ${sum}% 不能超过 100%`);

  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    await tx.delete(commissionPlans).where(eq(commissionPlans.matterId, input.matterId));
    if (quantized.length > 0) {
      await tx.insert(commissionPlans).values(
        quantized.map((p) => ({
          id: deps.ids.newId(),
          matterId: input.matterId,
          userId: p.userId,
          percent: p.percent.toFixed(2),
          label: p.label ?? null,
          active: true,
          createdAt: now,
        })),
      );
    }
  });
  await deps.audit.record(auth, {
    action: "COMMISSION_PLAN_SET",
    targetType: "Matter",
    targetId: input.matterId,
    detail: { count: quantized.length },
  });
  return { matterId: input.matterId, count: input.plans.length };
}

// ── fee entry ─────────────────────────────────────────────────────────────────
export const CreateFeeEntryInput = z.object({
  matterId: z.string().min(1),
  type: z.enum(["RECEIVABLE", "RECEIVED", "REFUND", "COST"]),
  amount: AMOUNT,
  occurredAt: z.coerce.date().optional(),
  payerOrPayee: z.string().max(120).optional(),
  method: z.string().max(40).optional(),
  note: z.string().max(300).optional(),
});

/** Record a fee entry. A RECEIVED entry atomically spawns COMMISSION children
 * per the active plan (DOMAIN-SPEC §6.3). COMMISSION rows are system-generated. */
export async function createFeeEntry(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER", "FINANCE");
  const input = CreateFeeEntryInput.parse(rawInput);
  await assertFinanceAccess(deps.db, auth, input.matterId);
  const now = deps.clock.now();
  const occurredAt = input.occurredAt ?? now;

  const result = await deps.db.transaction(async (tx) => {
    const id = deps.ids.newId();
    await tx.insert(feeEntries).values({
      id,
      matterId: input.matterId,
      billingId: null,
      type: input.type,
      amount: input.amount,
      occurredAt,
      invoiceNo: null,
      payerOrPayee: input.payerOrPayee ?? null,
      method: input.method ?? null,
      note: input.note ?? null,
      parentFeeEntryId: null,
      beneficiaryUserId: null,
      recordedById: auth.userId,
      createdAt: now,
    });

    let commissions = 0;
    if (input.type === "RECEIVED") {
      const plans = await tx
        .select()
        .from(commissionPlans)
        .where(and(eq(commissionPlans.matterId, input.matterId), eq(commissionPlans.active, true)));
      const receivedCents = toCents(input.amount);
      // Cumulative (telescoping) allocation: each share is the difference of
      // running-cumulative rounded amounts, so the children sum EXACTLY to
      // round(received × Σpercent) and can never overpay the received amount.
      let cumPercent = 0;
      let prevCumCents = 0;
      for (const plan of plans) {
        cumPercent += Number(plan.percent);
        const cumCents = percentOfCents(receivedCents, cumPercent);
        const shareCents = cumCents - prevCumCents;
        prevCumCents = cumCents;
        if (shareCents === 0) continue;
        await tx.insert(feeEntries).values({
          id: deps.ids.newId(),
          matterId: input.matterId,
          billingId: null,
          type: "COMMISSION",
          amount: `-${fromCents(shareCents)}`,
          occurredAt,
          invoiceNo: null,
          payerOrPayee: null,
          method: null,
          note: plan.label ?? null,
          parentFeeEntryId: id,
          beneficiaryUserId: plan.userId,
          recordedById: auth.userId,
          createdAt: now,
        });
        commissions++;
      }
    }
    return { id, type: input.type, amount: input.amount, commissionsGenerated: commissions };
  });

  await deps.audit.record(auth, {
    action: "FEE_ENTRY_CREATE",
    targetType: "FeeEntry",
    targetId: result.id,
    detail: { type: result.type, amount: result.amount, commissions: result.commissionsGenerated },
  });
  return result;
}

export const DeleteFeeEntryInput = z.object({ feeEntryId: z.string().min(1) });

/** Delete a fee entry; a RECEIVED entry cascades its COMMISSION children.
 * A system-generated COMMISSION row cannot be deleted directly. */
export async function deleteFeeEntry(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER", "FINANCE");
  const { feeEntryId } = DeleteFeeEntryInput.parse(rawInput);

  const [entry] = await deps.db
    .select({ matterId: feeEntries.matterId, type: feeEntries.type, parentFeeEntryId: feeEntries.parentFeeEntryId })
    .from(feeEntries)
    .where(eq(feeEntries.id, feeEntryId))
    .limit(1);
  if (!entry) throw new DomainError("NOT_FOUND", "流水不存在");
  await assertFinanceAccess(deps.db, auth, entry.matterId);
  // System-generated commission rows are never deletable directly (even if
  // orphaned) — they are managed via their RECEIVED parent.
  if (entry.type === "COMMISSION") {
    throw new DomainError("INVALID_STATE", "分成条目由实收自动生成，请删除对应实收记录");
  }

  await deps.db.transaction(async (tx) => {
    // Only a RECEIVED entry owns commission children to cascade.
    if (entry.type === "RECEIVED") {
      await tx.delete(feeEntries).where(eq(feeEntries.parentFeeEntryId, feeEntryId));
    }
    await tx.delete(feeEntries).where(eq(feeEntries.id, feeEntryId));
  });
  await deps.audit.record(auth, {
    action: "FEE_ENTRY_DELETE",
    targetType: "FeeEntry",
    targetId: feeEntryId,
    detail: { type: entry.type },
  });
  return { id: feeEntryId, deleted: true };
}

export async function getMatterFinance(deps: Deps, auth: AuthContext, rawInput: { matterId: string }) {
  await assertFinanceAccess(deps.db, auth, rawInput.matterId);
  const entries = await deps.db
    .select()
    .from(feeEntries)
    .where(eq(feeEntries.matterId, rawInput.matterId))
    .orderBy(asc(feeEntries.occurredAt));
  const plan = await deps.db
    .select()
    .from(commissionPlans)
    .where(eq(commissionPlans.matterId, rawInput.matterId));

  const sumCents = (type: string) =>
    entries.filter((e) => e.type === type).reduce((s, e) => s + toCents(e.amount), 0);
  const received = sumCents("RECEIVED");
  const refund = sumCents("REFUND");
  return {
    entries,
    plan,
    summary: {
      receivable: fromCents(sumCents("RECEIVABLE")),
      received: fromCents(received),
      refund: fromCents(refund),
      cost: fromCents(sumCents("COST")),
      commission: fromCents(sumCents("COMMISSION")),
      netReceived: fromCents(received - refund),
    },
  };
}
