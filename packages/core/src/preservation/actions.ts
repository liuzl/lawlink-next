/** Property-preservation use cases (DOMAIN-SPEC §6.5, §9.2). */
import { z } from "zod";
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { matters, preservationRenewals, preservations } from "@lawlink/db";
import { DomainError, type AuthContext, type Deps } from "../types.js";
import { requireRole } from "../permissions.js";
import { assertMatterAccess } from "../matter/access.js";
import { assertMatterWritable } from "../matter/guards.js";
import { DEFAULT_DURATION_DAYS, addDays, type PreservationPropertyType } from "./rules.js";

async function assertCanEditMatter(db: Deps["db"], auth: AuthContext, matterId: string) {
  const [matter] = await db
    .select({ ownerId: matters.ownerId })
    .from(matters)
    .where(eq(matters.id, matterId))
    .limit(1);
  if (!matter) throw new DomainError("NOT_FOUND", "案件不存在");
  assertMatterAccess(matter, auth);
}

const PROPERTY_TYPES = ["BANK_DEPOSIT", "REAL_ESTATE", "VEHICLE", "EQUITY", "IP", "OTHER"] as const;

export const CreatePreservationInput = z.object({
  matterId: z.string().min(1),
  type: z.enum(["PRE_LITIGATION", "IN_LITIGATION", "ENFORCEMENT"]),
  propertyType: z.enum(PROPERTY_TYPES),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "金额格式应为最多两位小数").optional(),
  respondent: z.string().max(200).optional(),
  guaranteeType: z.string().max(60).optional(),
  startDate: z.coerce.date(),
  /** Days; defaults to the statutory cap for the property type if omitted. */
  durationDays: z.coerce.number().int().positive().optional(),
});

export async function createPreservation(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER");
  const input = CreatePreservationInput.parse(rawInput);
  await assertMatterWritable(deps.db, auth, input.matterId);

  const durationDays =
    input.durationDays ?? DEFAULT_DURATION_DAYS[input.propertyType as PreservationPropertyType];
  const expiryDate = addDays(input.startDate, durationDays);

  const id = deps.ids.newId();
  await deps.db.insert(preservations).values({
    id,
    matterId: input.matterId,
    type: input.type,
    propertyType: input.propertyType,
    amount: input.amount ?? null,
    respondent: input.respondent ?? null,
    guaranteeType: input.guaranteeType ?? null,
    startDate: input.startDate,
    durationDays,
    expiryDate,
    status: "ACTIVE",
    ownerId: auth.userId,
    createdAt: deps.clock.now(),
  });
  return { id, durationDays, expiryDate, status: "ACTIVE" as const };
}

export const RenewPreservationInput = z.object({
  preservationId: z.string().min(1),
  newExpiryDate: z.coerce.date(),
  note: z.string().max(300).optional(),
});

export async function renewPreservation(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER");
  const input = RenewPreservationInput.parse(rawInput);
  const now = deps.clock.now();

  return await deps.db.transaction(async (tx) => {
    const [p] = await tx
      .select({ matterId: preservations.matterId, expiryDate: preservations.expiryDate, status: preservations.status })
      .from(preservations)
      .where(eq(preservations.id, input.preservationId))
      .limit(1);
    if (!p) throw new DomainError("NOT_FOUND", "保全不存在");

    const [matter] = await tx
      .select({ ownerId: matters.ownerId, status: matters.status })
      .from(matters)
      .where(eq(matters.id, p.matterId))
      .limit(1);
    if (!matter) throw new DomainError("NOT_FOUND", "案件不存在");
    assertMatterAccess(matter, auth);
    if (matter.status === "ARCHIVED") throw new DomainError("INVALID_STATE", "案件已归档，只读");

    // Renewal extends a STILL-ACTIVE preservation. A lapsed (EXPIRED or
    // past-expiry) or lifted window must NOT be "renewed" — that would hide the
    // lapse; re-protecting after a lapse is a NEW preservation (audit honesty).
    if (p.status === "LIFTED") throw new DomainError("INVALID_STATE", "保全已解除，不能续保");
    if (p.status === "EXPIRED" || p.expiryDate <= now) {
      throw new DomainError("INVALID_STATE", "保全已到期失效，应重新申请保全，而非续保");
    }
    if (input.newExpiryDate <= p.expiryDate) {
      throw new DomainError("VALIDATION", "续保到期日必须晚于当前到期日");
    }

    // Predicate-guarded update: if a concurrent scan flipped it to EXPIRED (or
    // it was lifted) between read and write, 0 rows change → reject.
    const updated = await tx
      .update(preservations)
      .set({ expiryDate: input.newExpiryDate, status: "RENEWED" })
      .where(
        and(
          eq(preservations.id, input.preservationId),
          inArray(preservations.status, ["ACTIVE", "RENEWED"]),
          gte(preservations.expiryDate, now),
        ),
      )
      .returning({ id: preservations.id });
    if (updated.length === 0) {
      throw new DomainError("INVALID_STATE", "保全状态已变更（已到期/已解除），不能续保");
    }

    await tx.insert(preservationRenewals).values({
      id: deps.ids.newId(),
      preservationId: input.preservationId,
      oldExpiryDate: p.expiryDate,
      newExpiryDate: input.newExpiryDate,
      renewedAt: now,
      performedById: auth.userId,
      note: input.note ?? null,
    });

    return { id: input.preservationId, newExpiryDate: input.newExpiryDate, status: "RENEWED" as const };
  });
}

export const LiftPreservationInput = z.object({ preservationId: z.string().min(1) });

export async function liftPreservation(deps: Deps, auth: AuthContext, rawInput: unknown) {
  requireRole(auth, "ADMIN", "PRINCIPAL_LAWYER", "LAWYER");
  const { preservationId } = LiftPreservationInput.parse(rawInput);

  const [p] = await deps.db
    .select({ matterId: preservations.matterId })
    .from(preservations)
    .where(eq(preservations.id, preservationId))
    .limit(1);
  if (!p) throw new DomainError("NOT_FOUND", "保全不存在");
  await assertMatterWritable(deps.db, auth, p.matterId);

  await deps.db.update(preservations).set({ status: "LIFTED" }).where(eq(preservations.id, preservationId));
  return { id: preservationId, status: "LIFTED" as const };
}

export async function listMatterPreservations(
  deps: Deps,
  auth: AuthContext,
  rawInput: { matterId: string },
) {
  await assertCanEditMatter(deps.db, auth, rawInput.matterId);
  const rows = await deps.db
    .select()
    .from(preservations)
    .where(eq(preservations.matterId, rawInput.matterId))
    .orderBy(asc(preservations.expiryDate));

  // Derive days-to-expiry at read so the UI shows lapsed/near-expiry state
  // correctly even if the EXPIRED scan (system job) hasn't run yet.
  const todayMs = deps.clock.now().getTime();
  return rows.map((r) => ({
    ...r,
    daysToExpiry: Math.ceil((r.expiryDate.getTime() - todayMs) / 86400000),
  }));
}

/**
 * System job (no auth — cron entry point, DOMAIN-SPEC §9.2): mark non-lifted
 * preservations whose expiry has passed as EXPIRED. Reminder notifications for
 * the [30,15,7,3,1] window land with the dashboard/notification work.
 */
export async function scanPreservationExpiry(deps: Deps): Promise<{ expired: number }> {
  const now = deps.clock.now();
  const updated = await deps.db
    .update(preservations)
    .set({ status: "EXPIRED" })
    .where(
      and(inArray(preservations.status, ["ACTIVE", "RENEWED"]), lt(preservations.expiryDate, now)),
    )
    .returning({ id: preservations.id });
  return { expired: updated.length };
}
