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
import { and, eq } from "drizzle-orm";
import { matterMembers } from "@lawlink/db";
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
