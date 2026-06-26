/** Use case: list intakes (most recent first). */
import { desc } from "drizzle-orm";
import { intakes } from "@lawlink/db";
import type { AuthContext, Deps } from "../types.js";

export async function listIntakes(deps: Deps, _auth: AuthContext) {
  // TODO(P1 permissions): scope by role/visibility (DOMAIN-SPEC §2.2).
  return await deps.db
    .select()
    .from(intakes)
    .orderBy(desc(intakes.createdAt))
    .limit(100);
}
