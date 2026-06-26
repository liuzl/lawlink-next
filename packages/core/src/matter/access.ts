/**
 * Matter visibility / access (DOMAIN-SPEC §2.2). Enforced in core, not the shell.
 *
 * - ADMIN / PRINCIPAL_LAWYER: all matters (management/audit lens).
 * - LAWYER: own matters (ownerId). Team membership lands with MatterMember later.
 * - ASSISTANT / FINANCE: no matter-body access yet (membership/finance scoping TBD).
 */
import { DomainError, type AuthContext } from "../types.js";
import { isManagement } from "../permissions.js";

export function canAccessMatter(matter: { ownerId: string }, auth: AuthContext): boolean {
  if (isManagement(auth)) return true;
  if (auth.role === "LAWYER" && matter.ownerId === auth.userId) return true;
  return false;
}

/** Throw NOT_FOUND (not FORBIDDEN) so callers can't probe matter existence. */
export function assertMatterAccess(matter: { ownerId: string }, auth: AuthContext): void {
  if (!canAccessMatter(matter, auth)) throw new DomainError("NOT_FOUND", "案件不存在");
}
