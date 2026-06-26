/** Use cases: list matters, and fetch one matter with its procedures + parties.
 * Visibility is enforced here (DOMAIN-SPEC §2.2) — see ./access. */
import { desc, eq, inArray, or } from "drizzle-orm";
import { matterMembers, matterProcedures, matters, parties } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps } from "../types.js";
import { isManagement, maskId } from "../permissions.js";
import { assertMatterAccess } from "./access.js";

export async function listMatters(deps: Deps, auth: AuthContext) {
  // Management sees all matters.
  if (isManagement(auth)) {
    return deps.db.select().from(matters).orderBy(desc(matters.createdAt)).limit(100);
  }
  // Case-working roles see matters they own (LAWYER) or are a team member of.
  // FINANCE / others get nothing from the matter list.
  if (auth.role !== "LAWYER" && auth.role !== "ASSISTANT") return [];

  const memberRows = await deps.db
    .select({ matterId: matterMembers.matterId })
    .from(matterMembers)
    .where(eq(matterMembers.userId, auth.userId));
  const memberIds = memberRows.map((r) => r.matterId);

  // LAWYER also sees owned matters even if (legacy) not in the roster. ASSISTANT
  // is membership-only — with no memberships there is nothing to show.
  const condition =
    auth.role === "LAWYER"
      ? memberIds.length
        ? or(eq(matters.ownerId, auth.userId), inArray(matters.id, memberIds))
        : eq(matters.ownerId, auth.userId)
      : memberIds.length
        ? inArray(matters.id, memberIds)
        : null;
  if (condition === null) return [];

  return deps.db
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
