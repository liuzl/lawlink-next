/**
 * User directory reads (用户). Minimal slice: list firm users so settings (e.g.
 * the legal-rep picker) and future assignment UIs can reference real accounts.
 * Full user provisioning/management lands in its own increment.
 */
import { asc, eq } from "drizzle-orm";
import { users } from "@lawlink/db";
import { type AuthContext, type Deps } from "../types.js";
import { requireRole } from "../permissions.js";

/** List firm users (ADMIN). Never returns the password hash. */
export async function listUsers(deps: Deps, auth: AuthContext, rawInput?: { activeOnly?: boolean }) {
  requireRole(auth, "ADMIN");
  const base = deps.db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      active: users.active,
      createdAt: users.createdAt,
    })
    .from(users);
  const rows = rawInput?.activeOnly
    ? await base.where(eq(users.active, true)).orderBy(asc(users.name))
    : await base.orderBy(asc(users.name));
  return rows;
}
