/** Finance: billings, fee entries, commission auto-calc (DOMAIN-SPEC §4.11, §6.3). */
import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { commissionPlans, feeEntries, matters } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps } from "../types.js";
import { isManagement, requireRole } from "../permissions.js";
import { assertMatterOwnerAccess, matterOwnerAccessExists } from "../matter/access.js";
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
  assertMatterOwnerAccess(m, auth); // owner (主办) or management — NOT team members

  // Quantize to 2 decimals FIRST, then validate the sum in the same
  // representation that is persisted (so stored percents can't drift past 100%).
  const quantized = input.plans.map((p) => ({ ...p, percent: Math.round(p.percent * 100) / 100 }));
  const sum = quantized.reduce((s, p) => s + p.percent, 0);
  if (sum > 100) throw new DomainError("VALIDATION", `分成比例之和 ${sum}% 不能超过 100%`);

  const now = deps.clock.now();
  const createdSec = Math.floor(now.getTime() / 1000);
  // Replace the plan atomically AND authorization-atomically. A claim returns the
  // matter row iff the caller is STILL owner/management; the guarded delete and
  // insert carry the same owner predicate, so if ownership changed since the
  // preflight every write no-ops. All in one batch() — one transaction on libSQL
  // AND D1 — so a stale owner can neither wipe nor replace finance-sensitive plan
  // data, and the plan is never wiped without its replacement.
  const guard = matterOwnerAccessExists(auth, input.matterId);
  const ownerCond = isManagement(auth)
    ? undefined
    : auth.role === "LAWYER"
      ? eq(matters.ownerId, auth.userId)
      : sql`1=0`;
  const claim = deps.db.select({ id: matters.id }).from(matters).where(and(eq(matters.id, input.matterId), ownerCond));
  const del = deps.db.delete(commissionPlans).where(and(eq(commissionPlans.matterId, input.matterId), guard));
  let results;
  if (quantized.length > 0) {
    // Guarded multi-row insert: SELECT * FROM (VALUES …) WHERE <owner guard> — the
    // VALUES columns are in CommissionPlan's schema order; the constant guard
    // includes all rows or none. `active` is the integer 1 (boolean column).
    const rows = sql.join(
      quantized.map(
        (p) =>
          sql`(${deps.ids.newId()}, ${input.matterId}, ${p.userId}, ${p.percent.toFixed(2)}, ${p.label ?? null}, 1, ${createdSec})`,
      ),
      sql`, `,
    );
    const ins = deps.db.insert(commissionPlans).select(sql`select * from (values ${rows}) where ${guard}`);
    results = await deps.db.batch([claim, del, ins]);
  } else {
    results = await deps.db.batch([claim, del]);
  }
  if ((results[0] as unknown[]).length === 0) throw new DomainError("NOT_FOUND", "案件不存在");
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

  const id = deps.ids.newId();
  const occurredSec = Math.floor(occurredAt.getTime() / 1000);
  const createdSec = Math.floor(now.getTime() / 1000);

  // Write-time finance-access guard (mirrors assertFinanceAccess): management and
  // FINANCE are firm-wide; a LAWYER may write only while still the matter owner.
  // Embedded in EVERY ledger insert so a caller who loses ownership between the
  // preflight and the write can't book a row (no archived check — finance edits
  // are allowed on closed matters by design). On a 0-row insert we re-run
  // assertFinanceAccess to surface the precise access-loss / missing-matter error.
  const financeAccess =
    isManagement(auth) || auth.role === "FINANCE"
      ? sql`1=1`
      : auth.role === "LAWYER"
        ? sql`m."owner_id" = ${auth.userId}`
        : sql`0=1`;
  const financeGuard = sql`exists (select 1 from "Matter" m where m."id" = ${input.matterId} and (${financeAccess}))`;

  // A non-RECEIVED entry spawns no commissions — a single guarded insert.
  if (input.type !== "RECEIVED") {
    const inserted = (await deps.db.all(sql`
      insert into ${feeEntries}
        ("id", "matter_id", "billing_id", "type", "amount", "occurred_at", "invoice_no", "payer_or_payee", "method", "note", "parent_fee_entry_id", "beneficiary_user_id", "recorded_by_id", "created_at")
      select ${id}, ${input.matterId}, null, ${input.type}, ${input.amount}, ${occurredSec}, null, ${input.payerOrPayee ?? null}, ${input.method ?? null}, ${input.note ?? null}, null, null, ${auth.userId}, ${createdSec}
      where ${financeGuard}
      returning "id"
    `)) as unknown[];
    if (inserted.length === 0) {
      await assertFinanceAccess(deps.db, auth, input.matterId); // throws if access lost / matter gone
      throw new DomainError("INVALID_STATE", "记账失败，请重试");
    }
    await deps.audit.record(auth, {
      action: "FEE_ENTRY_CREATE",
      targetType: "FeeEntry",
      targetId: id,
      detail: { type: input.type, amount: input.amount, commissions: 0 },
    });
    return { id, type: input.type, amount: input.amount, commissionsGenerated: 0 };
  }

  // A RECEIVED entry atomically spawns COMMISSION children per the active plan.
  // The plan is read, then the parent + all children insert in ONE batch() — a
  // single transaction on libSQL AND D1 (D1 has no interactive transactions). To
  // stop a concurrent setCommissionPlan from booking commissions against a plan
  // that changed between the read and the write (silent ledger corruption), the
  // PARENT insert is guarded by a compare-and-swap on the active plan-id SET
  // (setCommissionPlan rewrites rows with fresh ids, so the id set is a faithful
  // fingerprint) PLUS financeGuard; if either fails the parent inserts 0 rows. On
  // 0 rows we re-check access (reject) else retry with the new plan. The children
  // chain off `exists(parent)` within the same batch, so a failed guard cascades
  // them to no-ops too — children never outlive their parent, and the telescoping
  // share math stays exact in JS. epoch seconds.
  const receivedCents = toCents(input.amount);
  const MAX_ATTEMPTS = 5;
  let commissionsGenerated = 0;
  for (let attempt = 1; ; attempt++) {
    const plans = await deps.db
      .select()
      .from(commissionPlans)
      .where(and(eq(commissionPlans.matterId, input.matterId), eq(commissionPlans.active, true)))
      .orderBy(asc(commissionPlans.id));
    const planIds = plans.map((p) => p.id);

    // Cumulative (telescoping) allocation: each share is the difference of
    // running-cumulative rounded amounts, so the children sum EXACTLY to
    // round(received × Σpercent) and can never overpay the received amount.
    const children: { id: string; amount: string; note: string | null; userId: string }[] = [];
    let cumPercent = 0;
    let prevCumCents = 0;
    for (const plan of plans) {
      cumPercent += Number(plan.percent);
      const cumCents = percentOfCents(receivedCents, cumPercent);
      const shareCents = cumCents - prevCumCents;
      prevCumCents = cumCents;
      if (shareCents === 0) continue;
      children.push({ id: deps.ids.newId(), amount: `-${fromCents(shareCents)}`, note: plan.label ?? null, userId: plan.userId });
    }

    // CAS: the active plan-id set for this matter is exactly what we just read.
    const idsUnchanged = planIds.length
      ? sql` and not exists (select 1 from "CommissionPlan" where "matter_id" = ${input.matterId} and "active" = 1 and "id" not in (${sql.join(planIds.map((i) => sql`${i}`), sql`, `)}))`
      : sql``;
    const cas = sql`(select count(*) from "CommissionPlan" where "matter_id" = ${input.matterId} and "active" = 1) = ${planIds.length}${idsUnchanged}`;

    const parentIns = deps.db
      .insert(feeEntries)
      .select(sql`
        select ${id}, ${input.matterId}, null, 'RECEIVED', ${input.amount}, ${occurredSec}, null, ${input.payerOrPayee ?? null}, ${input.method ?? null}, ${input.note ?? null}, null, null, ${auth.userId}, ${createdSec}
        where ${cas} and ${financeGuard}
      `)
      .returning({ id: feeEntries.id });
    const childIns = children.map((c) =>
      deps.db.insert(feeEntries).select(sql`
        select ${c.id}, ${input.matterId}, null, 'COMMISSION', ${c.amount}, ${occurredSec}, null, null, null, ${c.note}, ${id}, ${c.userId}, ${auth.userId}, ${createdSec}
        where exists (select 1 from "FeeEntry" where "id" = ${id})
      `),
    );

    const results = await deps.db.batch([parentIns, ...childIns] as [typeof parentIns, ...typeof childIns]);
    if ((results[0] as unknown[]).length > 0) {
      commissionsGenerated = children.length;
      break;
    }
    // Parent no-op: either finance access was lost OR the plan changed since the
    // read. Re-check access (throws NOT_FOUND if lost — no unauthorized ledger
    // write); if access is intact it was the CAS, so retry with the new plan.
    await assertFinanceAccess(deps.db, auth, input.matterId);
    if (attempt >= MAX_ATTEMPTS) {
      throw new DomainError("CONFLICT", "分成方案在记账时被并发修改，请重试");
    }
  }
  const result = { id, type: input.type, amount: input.amount, commissionsGenerated };

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

  // Cascade + delete atomically in one batch() (one transaction on libSQL AND D1
  // — D1 has no interactive transactions). Only a RECEIVED entry owns commission
  // children to cascade; a non-RECEIVED entry deletes just itself.
  const delSelf = deps.db.delete(feeEntries).where(eq(feeEntries.id, feeEntryId));
  if (entry.type === "RECEIVED") {
    await deps.db.batch([
      deps.db.delete(feeEntries).where(eq(feeEntries.parentFeeEntryId, feeEntryId)),
      delSelf,
    ]);
  } else {
    await delSelf;
  }
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
