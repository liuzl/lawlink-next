/**
 * Use case: decline an intake (标记不接案).
 *
 * Permission-gated state transition (DOMAIN-SPEC §5.1): only ADMIN /
 * PRINCIPAL_LAWYER may decide; only non-terminal intakes may be declined.
 */
import { z } from "zod";
import { eq } from "drizzle-orm";
import { intakes } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps } from "../types.js";
import { requireRole } from "../permissions.js";

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

  const [intake] = await deps.db
    .select()
    .from(intakes)
    .where(eq(intakes.id, intakeId))
    .limit(1);

  if (!intake) throw new DomainError("NOT_FOUND", "收案不存在");
  if (intake.status === "CONVERTED" || intake.status === "DECLINED") {
    throw new DomainError(
      "INVALID_STATE",
      `收案已是终态 ${intake.status}，不能驳回`,
    );
  }

  await deps.db
    .update(intakes)
    .set({ status: "DECLINED", declinedReason: reason })
    .where(eq(intakes.id, intakeId));

  return { id: intakeId, status: "DECLINED", reason };
}
