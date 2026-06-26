/**
 * Permission helpers (DOMAIN-SPEC §2.2). Enforced inside the core layer, so
 * every entry shell (API/CLI/MCP) gets the same checks — never UI-only.
 */
import { DomainError, type AuthContext, type Role } from "./types.js";

/** Throw FORBIDDEN unless the caller holds one of the allowed roles. */
export function requireRole(auth: AuthContext, ...allowed: Role[]): void {
  if (!allowed.includes(auth.role)) {
    throw new DomainError(
      "FORBIDDEN",
      `需要角色 ${allowed.join(" / ")}，当前为 ${auth.role}`,
    );
  }
}

/** Management roles that see/act across the whole firm (admin/approval lens). */
export function isManagement(auth: AuthContext): boolean {
  return auth.role === "ADMIN" || auth.role === "PRINCIPAL_LAWYER";
}

/** Mask all but first-3/last-2 unless `full` (DOMAIN-SPEC §9.4). */
export function maskId(idNumber: string | null, full: boolean): string | null {
  if (!idNumber) return null;
  if (full) return idNumber;
  if (idNumber.length <= 5) return "*".repeat(idNumber.length);
  return idNumber.slice(0, 3) + "*".repeat(idNumber.length - 5) + idNumber.slice(-2);
}

/** Full id only for management; everyone else sees a masked value. */
export function maskIdNumber(idNumber: string | null, auth: AuthContext): string | null {
  return maskId(idNumber, isManagement(auth));
}
