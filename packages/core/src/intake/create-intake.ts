/**
 * Use case: register an intake (收案登记).
 *
 * Reference implementation that establishes the core-layer pattern for the
 * whole rewrite. Business rules per DOMAIN-SPEC §5.1. This is a P0 skeleton —
 * conflict-check linkage, party/contract handling, and the real auto-title
 * rule arrive in P1+.
 */
import { z } from "zod";
import { intakes } from "@lawlink/db";
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

  const row: Intake = {
    id: deps.ids.newId(),
    // Placeholder auto-title — real rule: `{委托方} 与 {对方} {案由}纠纷` (DOMAIN-SPEC §5.1).
    title: input.title ?? `${input.clientName} 收案`,
    category: input.category,
    status: "INTAKE",
    claimAmount: input.claimAmount ?? null,
    clientName: input.clientName,
    createdById: auth.userId,
    createdAt: deps.clock.now(),
  };

  await deps.db.insert(intakes).values(row);
  return row;
}
