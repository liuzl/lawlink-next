/**
 * Use case: convert an intake to a formal Matter (转为正式案件) — DOMAIN-SPEC §5.1.
 *
 * Approval action: only ADMIN / PRINCIPAL_LAWYER. The whole conversion runs in
 * one transaction; the intake is claimed atomically (status NOT IN terminal) so
 * concurrent conversions cannot both win, and an internalCode is allocated from
 * an atomic per-year/category counter (DOMAIN-SPEC §6.1).
 */
import { z } from "zod";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { counters, intakes, matters, parties } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps, type MatterCategory } from "../types.js";
import { requireRole } from "../permissions.js";
import { INTERNAL_CODE_PREFIX, counterKey, formatInternalCode } from "../matter/internal-code.js";

const TERMINAL = ["CONVERTED", "DECLINED"] as const;

export const ConvertIntakeInput = z.object({ intakeId: z.string().min(1) });

export interface ConvertResult {
  matterId: string;
  internalCode: string;
  intakeId: string;
  status: "CONVERTED";
}

export async function convertIntake(
  deps: Deps,
  auth: AuthContext,
  rawInput: unknown,
): Promise<ConvertResult> {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER");
  const { intakeId } = ConvertIntakeInput.parse(rawInput);
  const now = deps.clock.now();
  const year = now.getFullYear();

  const result = await deps.db.transaction(async (tx) => {
    // 1. Atomically claim the intake (only if not already terminal).
    const [intake] = await tx
      .update(intakes)
      .set({ status: "CONVERTED" })
      .where(and(eq(intakes.id, intakeId), notInArray(intakes.status, [...TERMINAL])))
      .returning();

    if (!intake) {
      const [existing] = await tx
        .select({ status: intakes.status })
        .from(intakes)
        .where(eq(intakes.id, intakeId))
        .limit(1);
      if (!existing) throw new DomainError("NOT_FOUND", "收案不存在");
      throw new DomainError("INVALID_STATE", `收案已是终态 ${existing.status}，不能转化`);
    }

    // 2. Allocate internalCode from an atomic counter.
    const prefix = INTERNAL_CODE_PREFIX[intake.category as MatterCategory] ?? "SP";
    const key = counterKey(year, prefix);
    const [counter] = await tx
      .insert(counters)
      .values({ key, value: 1 })
      .onConflictDoUpdate({ target: counters.key, set: { value: sql`${counters.value} + 1` } })
      .returning({ value: counters.value });
    const internalCode = formatInternalCode(year, prefix, counter.value);

    // 3. Create the Matter.
    const matterId = deps.ids.newId();
    await tx.insert(matters).values({
      id: matterId,
      internalCode,
      title: intake.title,
      category: intake.category,
      status: "PENDING_ACCEPTANCE",
      claimAmount: intake.claimAmount,
      primaryClientName: intake.clientName,
      ownerId: auth.userId,
      intakeId,
      createdAt: now,
    });

    // 4. Attach the Matter to the intake's existing party rows IN PLACE — do not
    //    copy. Copying would leave duplicate rows in the conflict corpus and
    //    inflate future hit counts. intakeId is kept for provenance.
    await tx.update(parties).set({ matterId }).where(eq(parties.intakeId, intakeId));

    return { matterId, internalCode, intakeId, status: "CONVERTED" as const };
  });

  await deps.audit.record(auth, {
    action: "INTAKE_CONVERT",
    targetType: "Matter",
    targetId: result.matterId,
    detail: { internalCode: result.internalCode, intakeId: result.intakeId },
  });
  return result;
}
