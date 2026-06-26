/**
 * Write guard: a matter must be accessible AND not archived for case-body edits
 * (DOMAIN-SPEC §6.6 — archived matters are read-only). Finance writes are
 * intentionally NOT gated by this (late payments on closed cases).
 */
import { eq } from "drizzle-orm";
import { matters } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps } from "../types.js";
import { assertMatterAccess } from "./access.js";

export async function assertMatterWritable(
  db: Deps["db"],
  auth: AuthContext,
  matterId: string,
): Promise<{ ownerId: string }> {
  const [m] = await db
    .select({ ownerId: matters.ownerId, status: matters.status })
    .from(matters)
    .where(eq(matters.id, matterId))
    .limit(1);
  if (!m) throw new DomainError("NOT_FOUND", "案件不存在");
  assertMatterAccess(m, auth);
  if (m.status === "ARCHIVED") {
    throw new DomainError("INVALID_STATE", "案件已归档，处于只读状态，不能修改");
  }
  return m;
}
