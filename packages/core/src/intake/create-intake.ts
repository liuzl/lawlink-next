/**
 * Use case: register an intake (收案登记) — DOMAIN-SPEC §5.1.
 *
 * Stores the intake plus its parties (client + optional opposing party) in one
 * transaction. Parties feed the conflict-check corpus and are carried over to
 * the Matter on conversion.
 */
import { z } from "zod";
import { intakes, parties } from "@lawlink/db";
import type { AuthContext, Deps, IntakeStatus } from "../types.js";

export const CreateIntakeInput = z.object({
  /** Optional — when omitted, a title is generated (DOMAIN-SPEC §5.1). */
  title: z.string().min(1).max(200).optional(),
  category: z.enum([
    "CIVIL_COMMERCIAL",
    "CRIMINAL",
    "ADMINISTRATIVE",
    "NON_LITIGATION",
    "LEGAL_COUNSEL",
    "SPECIAL_PROJECT",
  ]),
  clientName: z.string().min(1).max(200),
  clientIdNumber: z.string().min(1).max(64).optional(),
  opposingName: z.string().min(1).max(200).optional(),
  opposingIdNumber: z.string().min(1).max(64).optional(),
  /** Decimal stored as string end-to-end (DOMAIN-SPEC §8; SQLite has no decimal). */
  claimAmount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "金额格式应为最多两位小数")
    .optional(),
});

export type CreateIntakeInput = z.infer<typeof CreateIntakeInput>;

export interface Intake {
  id: string;
  title: string;
  category: CreateIntakeInput["category"];
  status: IntakeStatus;
  claimAmount: string | null;
  clientName: string;
  createdById: string;
  createdAt: Date;
}

/** Any authenticated role may submit an intake (DOMAIN-SPEC §5.1). */
export async function createIntake(
  deps: Deps,
  auth: AuthContext,
  rawInput: unknown,
): Promise<Intake> {
  const input = CreateIntakeInput.parse(rawInput);
  const now = deps.clock.now();

  const intake: Intake = {
    id: deps.ids.newId(),
    // Placeholder auto-title; real rule `{委托方} 与 {对方} {案由}纠纷` (DOMAIN-SPEC §5.1).
    title:
      input.title ??
      (input.opposingName
        ? `${input.clientName} 与 ${input.opposingName}`
        : `${input.clientName} 收案`),
    category: input.category,
    status: "INTAKE",
    claimAmount: input.claimAmount ?? null,
    clientName: input.clientName,
    createdById: auth.userId,
    createdAt: now,
  };

  const partyRows = [
    {
      id: deps.ids.newId(),
      intakeId: intake.id,
      matterId: null,
      role: "CLIENT_PARTY",
      name: input.clientName,
      idNumber: input.clientIdNumber ?? null,
      createdAt: now,
    },
  ];
  if (input.opposingName) {
    partyRows.push({
      id: deps.ids.newId(),
      intakeId: intake.id,
      matterId: null,
      role: "OPPOSING_PARTY",
      name: input.opposingName,
      idNumber: input.opposingIdNumber ?? null,
      createdAt: now,
    });
  }

  await deps.db.transaction(async (tx) => {
    await tx.insert(intakes).values(intake);
    await tx.insert(parties).values(partyRows);
  });

  await deps.audit.record(auth, {
    action: "INTAKE_CREATE",
    targetType: "Intake",
    targetId: intake.id,
    detail: { category: intake.category, parties: partyRows.length },
  });
  return intake;
}
