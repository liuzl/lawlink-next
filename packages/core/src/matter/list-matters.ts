/** Use cases: list matters, and fetch one matter with its procedures + parties. */
import { desc, eq } from "drizzle-orm";
import { matterProcedures, matters, parties } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps } from "../types.js";

export async function listMatters(deps: Deps, _auth: AuthContext) {
  // TODO(P1 permissions): scope by role/visibility (DOMAIN-SPEC §2.2).
  return await deps.db
    .select()
    .from(matters)
    .orderBy(desc(matters.createdAt))
    .limit(100);
}

export async function getMatter(deps: Deps, _auth: AuthContext, rawInput: { matterId: string }) {
  const [matter] = await deps.db
    .select()
    .from(matters)
    .where(eq(matters.id, rawInput.matterId))
    .limit(1);
  if (!matter) throw new DomainError("NOT_FOUND", "案件不存在");

  const procedures = await deps.db
    .select()
    .from(matterProcedures)
    .where(eq(matterProcedures.matterId, matter.id))
    .orderBy(matterProcedures.order);

  const matterParties = await deps.db
    .select()
    .from(parties)
    .where(eq(parties.matterId, matter.id));

  return { ...matter, procedures, parties: matterParties };
}
