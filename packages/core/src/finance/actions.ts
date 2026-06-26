/** Finance: billings, fee entries, commission auto-calc (DOMAIN-SPEC §4.11, §6.3). */
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { commissionPlans, feeEntries, matters } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps } from "../types.js";
import { isManagement, requireRole } from "../permissions.js";
import { assertMatterAccess } from "../matter/access.js";
import { fromCents, percentOfCents, toCents } from "./money.js";

const AMOUNT = z.string().regex(/^\d+(\.\d{1,2})?$/, "金额格式应为最多两位小数");

/** Finance access: management & FINANCE see all; LAWYER sees own; else none. */
async function assertFinanceAccess(db: Deps["db"], auth: AuthContext, matterId: string) {
  const [m] = await db.select({ ownerId: matters.ownerId }).from(matters).where(eq(matters.id, matterId)).limit(1);
  if (!m) throw new DomainError("NOT_FOUND", "案件不存在");
  if (isManagement(auth) || auth.role === "FINANCE") return;
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
  const [m] = await deps.db.select({ ownerId: matters.ownerId }).from(matters).where(eq(matters.id, input.matterId)).limit(1);
  if (!m) throw new DomainError("NOT_FOUND", "案件不存在");
  assertMatterAccess(m, auth); // management or owner (lead)

  const sum = input.plans.reduce((s, p) => s + p.percent, 0);
  if (sum > 100) throw new DomainError("VALIDATION", `分成比例之和 ${sum}% 不能超过 100%`);

  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    await tx.delete(commissionPlans).where(eq(commissionPlans.matterId, input.matterId));
    if (input.plans.length > 0) {
      await tx.insert(commissionPlans).values(
        input.plans.map((p) => ({
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

  return await deps.db.transaction(async (tx) => {
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
      for (const plan of plans) {
        const shareCents = percentOfCents(receivedCents, plan.percent);
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
  if (entry.type === "COMMISSION" && entry.parentFeeEntryId) {
    throw new DomainError("INVALID_STATE", "分成条目由实收自动生成，请删除对应实收记录");
  }

  await deps.db.transaction(async (tx) => {
    await tx.delete(feeEntries).where(eq(feeEntries.parentFeeEntryId, feeEntryId));
    await tx.delete(feeEntries).where(eq(feeEntries.id, feeEntryId));
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
