/** Use cases: list matters, and fetch one matter with its procedures + parties.
 * Visibility is enforced here (DOMAIN-SPEC §2.2) — see ./access. */
import { desc, eq } from "drizzle-orm";
import { matterProcedures, matters, parties } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps } from "../types.js";
import { isManagement, maskId } from "../permissions.js";
import { assertMatterAccess, matterVisibilityCondition } from "./access.js";

export async function listMatters(deps: Deps, auth: AuthContext) {
  // Membership-aware visibility (management all / owned+member / none) — shared
  // with the schedule and dashboard via matterVisibilityCondition.
  const vis = await matterVisibilityCondition(deps.db, auth);
  if (vis === null) return [];
  return deps.db
    .select()
    .from(matters)
    .where(vis)
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
  await assertMatterAccess(deps.db, matter, auth);

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
