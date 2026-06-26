/**
 * Matter visibility / access (DOMAIN-SPEC §2.2). Enforced in core, not the shell.
 *
 * - ADMIN / PRINCIPAL_LAWYER: all matters (management/audit lens).
 * - LAWYER: own matters (ownerId) OR matters they are a team member of.
 * - ASSISTANT: matters they are a team member of (no ownership).
 * - FINANCE: no matter-body access here (finance works its own ledger surface).
 *
 * Membership lives in the MatterMember roster; the owner is also carried there as
 * the LEAD member, but we keep the cheap ownerId short-circuit so owner/management
 * checks never touch the DB. Only a non-owner case-worker triggers the roster
 * query. Access is async because membership is a stored relation.
 */
import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import { matterMembers, matters } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps } from "../types.js";
import { isManagement } from "../permissions.js";

/** Is this user on the matter's team roster (any membership role)? */
export async function isMatterMember(db: Deps["db"], matterId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: matterMembers.id })
    .from(matterMembers)
    .where(and(eq(matterMembers.matterId, matterId), eq(matterMembers.userId, userId)))
    .limit(1);
  return !!row;
}

export async function canAccessMatter(
  db: Deps["db"],
  matter: { id: string; ownerId: string },
  auth: AuthContext,
): Promise<boolean> {
  if (isManagement(auth)) return true;
  if (auth.role === "LAWYER" && matter.ownerId === auth.userId) return true;
  // Team membership grants access to case-working roles (not FINANCE).
  if (auth.role === "LAWYER" || auth.role === "ASSISTANT") {
    return isMatterMember(db, matter.id, auth.userId);
  }
  return false;
}

/** Throw NOT_FOUND (not FORBIDDEN) so callers can't probe matter existence. */
export async function assertMatterAccess(
  db: Deps["db"],
  matter: { id: string; ownerId: string },
  auth: AuthContext,
): Promise<void> {
  if (!(await canAccessMatter(db, matter, auth))) throw new DomainError("NOT_FOUND", "案件不存在");
}

/**
 * A `matters`-row visibility predicate for aggregate views that scan across many
 * matters (matter list, schedule, dashboard) — the single source of truth so
 * those surfaces agree with assertMatterAccess. Apply the result to a query whose
 * FROM/JOIN includes the `matters` table. Returns:
 *  - `undefined` → no restriction (management sees all matters);
 *  - an SQL condition → restrict to the caller's owned + member matters;
 *  - `null` → the caller can see no matters (the caller should short-circuit to
 *    an empty result rather than run the query).
 */
export async function matterVisibilityCondition(
  db: Deps["db"],
  auth: AuthContext,
): Promise<SQL | undefined | null> {
  if (isManagement(auth)) return undefined;
  if (auth.role !== "LAWYER" && auth.role !== "ASSISTANT") return null;
  const rows = await db
    .select({ matterId: matterMembers.matterId })
    .from(matterMembers)
    .where(eq(matterMembers.userId, auth.userId));
  const ids = rows.map((r) => r.matterId);
  if (auth.role === "LAWYER") {
    return ids.length ? or(eq(matters.ownerId, auth.userId), inArray(matters.id, ids)) : eq(matters.ownerId, auth.userId);
  }
  // ASSISTANT: membership-only — nothing to show without memberships.
  return ids.length ? inArray(matters.id, ids) : null;
}
