/**
 * Use case: decline an intake (标记不接案).
 *
 * Permission-gated state transition (DOMAIN-SPEC §5.1): only ADMIN /
 * PRINCIPAL_LAWYER may decide; only non-terminal intakes may be declined.
 *
 * The terminal-state guard is enforced ATOMICALLY at the storage boundary: a
 * single conditional UPDATE (status NOT IN terminal) — never check-then-act —
 * so two concurrent declines cannot both succeed.
 */
import { z } from "zod";
import { and, eq, notInArray } from "drizzle-orm";
import { intakes } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps } from "../types.js";
import { requireRole } from "../permissions.js";

const TERMINAL = ["CONVERTED", "DECLINED"] as const;

export const DeclineIntakeInput = z.object({
  intakeId: z.string().min(1),
  reason: z.string().min(1).max(500),
});

export async function declineIntake(
  deps: Deps,
  auth: AuthContext,
  rawInput: unknown,
): Promise<{ id: string; status: "DECLINED"; reason: string }> {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER");
  const { intakeId, reason } = DeclineIntakeInput.parse(rawInput);

  // Atomic transition: only rows that are not already terminal are updated.
  const updated = await deps.db
    .update(intakes)
    .set({ status: "DECLINED", declinedReason: reason })
    .where(and(eq(intakes.id, intakeId), notInArray(intakes.status, [...TERMINAL])))
    .returning({ id: intakes.id });

  if (updated.length === 0) {
    // No row changed: disambiguate not-found vs already-terminal for the caller.
    const [existing] = await deps.db
      .select({ status: intakes.status })
      .from(intakes)
      .where(eq(intakes.id, intakeId))
      .limit(1);
    if (!existing) throw new DomainError("NOT_FOUND", "收案不存在");
    throw new DomainError(
      "INVALID_STATE",
      `收案已是终态 ${existing.status}，不能驳回`,
    );
  }

  await deps.audit.record(auth, {
    action: "INTAKE_DECLINE",
    targetType: "Intake",
    targetId: intakeId,
    detail: { reason },
  });
  return { id: intakeId, status: "DECLINED", reason };
}
