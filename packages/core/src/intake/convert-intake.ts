/**
 * Use case: convert an intake to a formal Matter (转为正式案件) — DOMAIN-SPEC §5.1.
 *
 * Approval action: only ADMIN / PRINCIPAL_LAWYER. The whole conversion runs in
 * one transaction; the intake is claimed atomically (status NOT IN terminal) so
 * concurrent conversions cannot both win, and an internalCode is allocated from
 * an atomic per-year/category counter (DOMAIN-SPEC §6.1).
 */
import { z } from "zod";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { counters, documentFolders, intakes, matterMembers, matters, parties } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps, type MatterCategory } from "../types.js";
import { requireRole } from "../permissions.js";
import { INTERNAL_CODE_PREFIX, counterKey } from "../matter/internal-code.js";
import { DEFAULT_FOLDERS } from "../document/folders.js";

const TERMINAL = ["CONVERTED", "DECLINED"] as const;

export const ConvertIntakeInput = z.object({ intakeId: z.string().min(1) });

export interface ConvertResult {
  matterId: string;
  internalCode: string;
  intakeId: string;
  status: "CONVERTED";
}

export async function convertIntake(
  deps: Deps,
  auth: AuthContext,
  rawInput: unknown,
): Promise<ConvertResult> {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER");
  const { intakeId } = ConvertIntakeInput.parse(rawInput);
  const now = deps.clock.now();
  const year = now.getFullYear();

  // Preflight read (precise errors): the intake exists and isn't already terminal.
  const [intake] = await deps.db
    .select({ title: intakes.title, category: intakes.category, claimAmount: intakes.claimAmount, clientName: intakes.clientName, status: intakes.status })
    .from(intakes)
    .where(eq(intakes.id, intakeId))
    .limit(1);
  if (!intake) throw new DomainError("NOT_FOUND", "收案不存在");
  if ((TERMINAL as readonly string[]).includes(intake.status)) {
    throw new DomainError("INVALID_STATE", `收案已是终态 ${intake.status}，不能转化`);
  }

  // The WHOLE conversion runs in one batch() — a single transaction on libSQL AND
  // D1 (D1 has no interactive transactions). `preState` = the intake is still
  // non-terminal; every dependent write carries it, and the claim UPDATE (the
  // intake → CONVERTED transition) is ordered LAST so all dependent writes see the
  // pre-state. A concurrent conversion that committed first leaves the intake
  // CONVERTED, so this batch's preState is false everywhere → Matter/members/
  // parties/folders all no-op and the claim returns 0 rows → reject (only the
  // counter — statement 0 — may bump, a harmless code gap on the rare double
  // convert). internalCode is formatted in SQL (printf) from the just-incremented
  // Counter via a correlated subquery. epoch seconds throughout.
  const prefix = INTERNAL_CODE_PREFIX[intake.category as MatterCategory] ?? "SP";
  const key = counterKey(year, prefix);
  const matterId = deps.ids.newId();
  const createdSec = Math.floor(now.getTime() / 1000);
  const preState = sql`exists (select 1 from "Intake" where "id" = ${intakeId} and "status" not in ('CONVERTED', 'DECLINED'))`;

  const counterUpsert = deps.db
    .insert(counters)
    .values({ key, value: 1 })
    .onConflictDoUpdate({ target: counters.key, set: { value: sql`${counters.value} + 1` } });

  const matterInsert = deps.db.insert(matters).select(sql`
    select ${matterId},
      printf('LL-%d-%s-%04d', ${year}, ${prefix}, (select "value" from "Counter" where "key" = ${key})),
      ${intake.title}, ${intake.category}, 'PENDING_ACCEPTANCE', ${intake.claimAmount ?? null}, ${intake.clientName}, null, ${auth.userId}, ${intakeId}, ${createdSec}
    where ${preState}
  `).returning({ internalCode: matters.internalCode });

  const memberInsert = deps.db.insert(matterMembers).select(sql`
    select ${deps.ids.newId()}, ${matterId}, ${auth.userId}, 'LEAD', ${createdSec}
    where ${preState}
  `);

  const partiesUpdate = deps.db.update(parties).set({ matterId }).where(and(eq(parties.intakeId, intakeId), preState));

  const folderNames = DEFAULT_FOLDERS[intake.category as MatterCategory] ?? DEFAULT_FOLDERS.CIVIL_COMMERCIAL;
  const folderValues = folderNames.map(
    (name, i) => sql`(${deps.ids.newId()}, ${matterId}, ${name}, ${i}, 1, ${createdSec}, ${createdSec})`,
  );
  const foldersInsert = deps.db
    .insert(documentFolders)
    .select(sql`select * from (values ${sql.join(folderValues, sql`, `)}) where ${preState}`);

  const claim = deps.db
    .update(intakes)
    .set({ status: "CONVERTED" })
    .where(and(eq(intakes.id, intakeId), notInArray(intakes.status, [...TERMINAL])))
    .returning({ id: intakes.id });

  const batchResults = await deps.db.batch([counterUpsert, matterInsert, memberInsert, partiesUpdate, foldersInsert, claim]);
  if ((batchResults[5] as unknown[]).length === 0) {
    throw new DomainError("INVALID_STATE", "收案已被并发转化，不能重复转化");
  }
  const internalCode = (batchResults[1] as { internalCode: string }[])[0].internalCode;
  const result = { matterId, internalCode, intakeId, status: "CONVERTED" as const };

  await deps.audit.record(auth, {
    action: "INTAKE_CONVERT",
    targetType: "Matter",
    targetId: result.matterId,
    detail: { internalCode: result.internalCode, intakeId: result.intakeId },
  });
  return result;
}
