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
