/** Use cases: list matters, and fetch one matter with its procedures + parties.
 * Visibility is enforced here (DOMAIN-SPEC §2.2) — see ./access. */
import { desc, eq } from "drizzle-orm";
import { matterProcedures, matters, parties } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps } from "../types.js";
import { isManagement, maskId } from "../permissions.js";
import { assertMatterAccess } from "./access.js";

export async function listMatters(deps: Deps, auth: AuthContext) {
  // Management sees all; a LAWYER sees their own; others see none (until membership).
  const condition = isManagement(auth)
    ? undefined
    : auth.role === "LAWYER"
      ? eq(matters.ownerId, auth.userId)
      : null;
  if (condition === null) return [];

  return await deps.db
    .select()
    .from(matters)
    .where(condition)
    .orderBy(desc(matters.createdAt))
    .limit(100);
}

export async function getMatter(deps: Deps, auth: AuthContext, rawInput: { matterId: string }) {
  const [matter] = await deps.db
    .select()
    .from(matters)
    .where(eq(matters.id, rawInput.matterId))
    .limit(1);
  if (!matter) throw new DomainError("NOT_FOUND", "案件不存在");
  assertMatterAccess(matter, auth);

  const procedures = await deps.db
    .select()
    .from(matterProcedures)
    .where(eq(matterProcedures.matterId, matter.id))
    .orderBy(matterProcedures.order);

  const matterParties = await deps.db
    .select()
    .from(parties)
    .where(eq(parties.matterId, matter.id));

  // §9.4: full ID numbers only for management or the matter owner (主办).
  const fullId = isManagement(auth) || matter.ownerId === auth.userId;
  const maskedParties = matterParties.map((p) => ({ ...p, idNumber: maskId(p.idNumber, fullId) }));

  return { ...matter, procedures, parties: maskedParties };
}
